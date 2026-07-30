# 공통 Job 통합 설계

## 목표

현재 GenerationJob, ChoiceHardeningJob, NoteTidyJob, AnswerExplanationJob은 서로 다른
상태, 실행 소유권, 재시도 방식과 ID 공간을 사용한다. 이 설계는 하나의 전역 Job
수명주기로 통합하되, 기존 REST URL, { job: ... } wrapper, 사용자 화면 흐름은 유지한다.

| Job.type | 대상 | 상세 모델 | 레거시 원천 |
| --- | --- | --- | --- |
| QUESTION_GENERATION | Topic | QuestionGenerationJobData | GenerationJob(kind=QUESTION) |
| KEYWORD_TAGGING | Topic | KeywordTaggingJobData | GenerationJob(kind=KEYWORD_TAG) |
| GENERATION_ITEM_REVISION | 부모 Job | GenerationItemRevisionJobData | GenerationItemRevision |
| CHOICE_HARDENING | Question | ChoiceHardeningJobData | ChoiceHardeningJob |
| NOTE_TIDY | Topic | NoteTidyJobData | NoteTidyJob |
| ANSWER_EXPLANATION | Question | AnswerExplanationJobData | AnswerExplanationJob + AnswerExplanation |

레거시 테이블은 새 스키마를 추가하는 때에는 유지한다. 확장, 백필, 새 코드 전환,
제거 순서를 지켜 이전 앱과 새 앱이 전환 중 같은 DB를 안전하게 읽도록 한다.

## 현행 조사 결과

prisma/schema.prisma에는 네 Job 테이블, GenerationItemRevision, AnswerExplanation,
GenerationRunLog가 있다. 생성만 RUNNING -> VERIFYING -> SUCCEEDED | FAILED를
사용하고 나머지는 RUNNING -> SUCCEEDED | FAILED다. 생성은 generation-service의
void runJob으로 실행하지만, 선지 강화, 노트 정리, 해설은 Route Handler after()에서
각 runner를 시작한다. 각각 startedAt, attempt, status만으로 실행 소유권을 판단한다.

그 결과 완료 행을 RUNNING으로 되돌리는 재실행, Job ID namespace 충돌, id: 0 해설
cache-hit, 해설 삭제 기반 무효화, 생성 외 AI 실행의 진단 로그 부재가 생긴다.

## 공통 데이터 모델

### Job

Job은 전역 auto-increment id를 갖고 아래 필드를 가진다.

    id, type, status, engine,
    topicId | questionId | parentJobId,
    retryOfJobId, runToken, errorMessage,
    createdAt, startedAt, heartbeatAt, finishedAt

JobStatus는 PENDING, RUNNING, SUCCEEDED, FAILED만 사용한다. 생성의 설계표, 검증,
수선 진행도는 Job status가 아니라 QuestionGenerationJobData.stage에 둔다.

GenerationJob ID는 새 Job ID로 그대로 보존한다. 그 밖의 레거시 Job은 migration이
읽은 maxGenerationId에 table ordinal과 legacy id를 더한 결정적 ID로 옮긴다.
새 auto-increment는 이관된 모든 ID보다 크게 설정한다. 따라서 기존
/api/generate/{id} 링크가 유지되고, 같은 migration을 재검증해도 ID가 변하지 않는다.

MariaDB CHECK와 서비스의 assertJobTarget(type, target)은 다음 대상 조합을 함께
강제한다.

| type | topicId | questionId | parentJobId |
| --- | --- | --- | --- |
| QUESTION_GENERATION, KEYWORD_TAGGING, NOTE_TIDY | NOT NULL | NULL | NULL |
| CHOICE_HARDENING, ANSWER_EXPLANATION | NULL | NOT NULL | NULL |
| GENERATION_ITEM_REVISION | NULL | NULL | NOT NULL |

retryOfJobId는 같은 type과 대상의 종료 Job만 가리킨다. parentJobId는
QUESTION_GENERATION Job만 가리키며 revision의 itemIndex는 부모 결과의 유효 item이다.
이 행 간 제약은 서비스 트랜잭션과 backfill verification SQL이 확인한다. 대상, 부모,
재시도 FK는 cascade로 연결한다.

### 상세 행과 실행 로그

모든 상세 모델은 jobId를 primary key로 사용하고 Job과 cascade 1:1 관계를 맺는다.
createPendingJob은 Job과 정확히 하나의 상세를 같은 transaction에서 생성한다.

| 상세 | 저장하는 도메인 데이터 |
| --- | --- |
| QuestionGenerationJobData | verifyEngine, instructions, referenceFiles, correctAnswerCount, choiceCount, sourceQuestionIds, stage, items, verifyWarning, approvedAt, savedCount |
| KeywordTaggingJobData | 대상 요약, 태그 결과, approvedAt, savedCount |
| GenerationItemRevisionJobData | itemIndex, instructions, verdict, comment, proposedQuestion, selectedAt |
| ChoiceHardeningJobData | sourceHash, sourcePayload, verifyEngine, preview, appliedAt, autoApplied, dismissedAt |
| NoteTidyJobData | sourceHash, preview, appliedAt, dismissedAt |
| AnswerExplanationJobData | sourceHash, content, choiceExplanations, factualConcern, invalidatedAt |

JobRunLog는 모든 Job의 1:N 실행 기록이다. 기존 GenerationRunLog의 stage, itemIndex,
attempt, engine, model, prompt, response, stdoutTail, stderrTail, errorMessage,
exitCode, timedOut, startedAt, finishedAt, durationMs를 보존하고 jobId로 연결한다.
prompt/response는 MEDIUMTEXT, stdout/stderr는 마지막 8,000자다.

로그 persistence는 best-effort다. 로그 write 실패는 본 작업 성공/실패를 덮지 않는다.
반대로 상세 결과 저장과 Job SUCCEEDED 종료는 한 transaction이며, 결과 저장 실패는
fenced FAILED 종료가 된다.

## 상태 전이와 동시성

    create                 claim                  terminal
    PENDING -------------> RUNNING -------------> SUCCEEDED
                                  |-------------> FAILED

    SUCCEEDED 또는 FAILED -- retry --> 새 PENDING Job(retryOfJobId=원본)

1. 대상 행을 잠그고 active 정책을 검사한 뒤 PENDING Job과 상세를 원자 생성한다.
2. runner는 status=PENDING 조건 update로 RUNNING, UUID runToken, startedAt,
   heartbeatAt을 기록한다. update count가 1인 runner만 실행한다.
3. 실행 중 30초마다 id, RUNNING, runToken이 모두 맞는 조건으로 heartbeatAt을
   갱신한다. count가 0이면 fencing을 잃었으므로 결과를 저장하지 않고 종료한다.
4. 성공/실패 update도 runToken을 조건으로 한다. 성공은 detail 결과와 SUCCEEDED,
   finishedAt을 한 transaction으로 쓴다.
5. heartbeatAt(없으면 startedAt, 다시 없으면 createdAt)이
   2 * generationTimeoutMs() + 60,000ms보다 오래된 RUNNING Job은 FAILED로 복구한다.
   RUNNING JobRunLog도 FAILED로 닫고 runToken을 지운다. 늦은 runner는 token
   fencing 때문에 복구된 행을 되살릴 수 없다.
6. force와 retry는 attempt 증가나 기존 행 reset이 아니라 retryOfJobId가 있는 새
   Job을 만든다.

QUESTION_GENERATION과 KEYWORD_TAGGING은 같은 Topic에서 PENDING/RUNNING이
동시에 존재할 수 없다. Topic SELECT FOR UPDATE 뒤 검사한다. NOTE_TIDY는 같은
Topic의 RUNNING 또는 미처리 SUCCEEDED 초안도 하나만 허용한다. CHOICE_HARDENING과
ANSWER_EXPLANATION은 Question을 잠그고 같은 source hash/engine의 active Job을
반환한다.

## 타입별 계약

### 생성, 키워드 태깅, 항목 재검증

/api/generate, /api/generate/{id}, /api/generate/keyword-tag, approve, diagnostics,
item revision URL과 { job } wrapper를 유지한다. Generation DTO는 kind를 type으로
바꾸고, type은 QUESTION_GENERATION 또는 KEYWORD_TAGGING이다. 도메인 진행도는
stage를 별도 제공한다.

item revision은 parentJobId가 생성 Job인 새 child Job이다. 같은 item을 다시
수정해도 이전 결과를 덮지 않으며, 가장 최근 selectedAt의 성공 revision만 approve에
적용한다. 부모 승인 뒤 revision 생성/선택 변경은 409이다.

### 선지 강화

MCQ만 허용하며 sourceHash/sourcePayload/preview는 상세에 고정한다. apply는
Question과 Job을 잠그고 현재 payload hash를 비교한다. 바뀌었으면
CHOICE_HARDENING_SOURCE_CHANGED 409이다. apply/dismiss는 idempotent이고, 폐기된
결과 apply나 반영된 결과 dismiss는 409이다.

attempt 저장/DTO를 제거한다. force/재시도는 새 Job 계보다. 선지 강화 반영은
AnswerExplanation을 삭제하지 않고 같은 Question의 유효 해설 detail에
invalidatedAt을 기록한다.

### 노트 정리

TopicNote의 SHA-256을 sourceHash로 저장한다. runner 시작 직전과 apply에서 모두
검사한다. 원본이 바뀌면 결과를 적용하지 않고 FAILED 또는
NOTE_TIDY_SOURCE_CHANGED 409을 낸다. 패널 재진입은 글로벌 Job ID를 받아 기존
polling을 재개한다.

### 해설

Question payload와 explanation의 안정 직렬화 hash가 같고 invalidatedAt이 null인
SUCCEEDED Job은 cache hit다. cache hit도 실제 Job을 { job }으로 반환하므로 id: 0
센티널은 사라진다. Question PATCH와 선지 강화 apply는 invalidatedAt만 기록하고,
다음 요청은 retryOfJobId가 있는 새 Job을 만든다.

## API와 Route Handler

Next.js 16 Route Handler는 Web Request/Response API를 쓰고 동적 params는 Promise다.
각 route.ts는 parseBody/parseIdParam, 서비스 호출, jsonOk/handleApiError만 수행한다.
after()는 새 PENDING Job ID를 runner에 전달할 뿐 claim을 대체하지 않는다.

새 범용 polling URL은 만들지 않는다. 기존 URL과 api-client method가 공통 Job DTO를
소비한다. UI는 api-client 외 fetch를 하지 않는다. prompt/response는 polling DTO에
넣지 않고 /api/generate/{id}/diagnostics의 runs 응답으로 lazy-load한다.

## 확장, 백필, 검증, 롤백

1. 확장 migration은 새 enum/table/FK/CHECK/index만 추가하고 legacy는 유지한다.
2. backfill은 Job과 한 상세를 transaction으로 만든다. GenerationJob은 ID를 보존하고
   GenerationRunLog를 옮긴다. rawOutput은 LEGACY_OUTPUT JobRunLog.response로
   보존한다. legacy RUNNING과 미완료 log는 사유가 있는 FAILED로 닫는다.
   AnswerExplanation cache는 hash-bearing SUCCEEDED Job/detail로 materialize한다.
3. scripts/verify-common-job-backfill.sql은 type별 count, Job-detail 1:1, target
   truth table, 고아 FK, generation ID, 종료 시각, terminal 아래 RUNNING log,
   legacy RUNNING 처리, explanation cache hash를 0 bad rows로 증명한다.
4. 새 코드가 새 schema만 write한 뒤 모든 legacy code reference가 0일 때 제거한다.

코드 결함은 forward fix한다. 스키마/데이터 손상은 앱을 재개하지 않고 managed DB
snapshot 복원 후 이전 commit 재배포로 복구한다. legacy 제거 뒤에는 down migration이
아니라 snapshot 복원이 rollback이다.

## 운영 DB 통합테스트 안전장치

운영 write는 기본 off다. 다음을 모두 만족할 때만 허용한다.

- JOB_IT_ALLOW_PRODUCTION_WRITE=YES_I_UNDERSTAND
- CLI --confirm-db가 실제 DB_NAME과 일치
- contract migration 적용
- active 운영 Job 0
- 기존 __drillup_job_it__ prefix Topic 0

첫 write 전에 generation_output/integration-tests/{runId}/ledger.json을 atomic하게
만든다. ledger에는 정확한 Topic ID, Job ID, output directory만 기록하며 secret,
cookie, prompt, AI 원문 response는 금지한다. success/failure/finally 모두 ledger의
정확한 Topic ID만 삭제하며 prefix bulk delete는 금지한다. cascade 후 test Topic,
Question, Job, detail, log가 0이고 non-test 행 수가 불변임을 검사한다.
AUTO_INCREMENT gap은 허용한다.

poll은 3초다. 한 호출 timeout은 GENERATION_TIMEOUT_MS + 2분, 문제 생성 전체는
max(30분, 4 * GENERATION_TIMEOUT_MS)다. AI 실패는 한 번만 새 Job으로 retry하고
retryOfJobId를 검증한다. 두 번째 실패는 전체 실패다. report는 Job
ID/type/status/duration/log count/retry/cleanup만 쓴다.
