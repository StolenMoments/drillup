# 생성 작업 검증·진단 강화 설계

## 목표

AI 생성 작업에서 모델 응답이 애플리케이션 스키마와 다를 때 실제 원인을 보존하고, 작업 상태와 사용자 화면이 결과의 유효성을 정확히 나타내도록 한다. 키워드 개수는 제한하지 않으며, AI 호출별 프롬프트·원본 응답·오류를 작업이 삭제될 때까지 DB에 보존한다.

## 배경

서버의 generation job 44, 45, 47, 48을 조사하면서 다음 문제가 확인됐다.

- job 44와 45는 정답 선지의 `misconception`이 빈 문자열이라 blueprint 파싱 단계에서 실패했다. `misconception`은 오답이 유도하는 오개념을 설명하는 필드인데 정답에도 비어 있지 않은 값을 요구하고 있었다.
- job 47과 48은 생성 문항의 키워드가 각각 6~7개여서 최대 5개 제한을 초과했다.
- 유효하지 않은 생성 문항을 `{ type: "invalid" }`로 바꿔 재검증하면서 최초의 키워드 오류가 `type은 "mcq" 또는 "cloze"여야 합니다`라는 2차 오류로 덮였다.
- 모든 문항이 무효인데도 job이 `SUCCEEDED`로 끝났다.
- `generation_job.raw_output`은 일부 단계의 응답만 담을 수 있다. blueprint, blueprint 수정, 문항 생성, 검증, 문항 수정, 재검증의 실행 내역을 호출별로 추적할 수 없다.
- 서버의 `generation_output/jobs/<id>` 파일은 조사 시점에 남아 있지 않았다. 파일은 진단 데이터의 유일한 저장소로 사용할 수 없다.

## 핵심 결정

### 1. 진단 데이터는 DB를 기준 저장소로 사용한다

파일보다 DB 저장을 선택한다.

- job 상세 API와 UI에서 별도의 파일 접근 API 없이 조회할 수 있다.
- 배포 경로, 현재 작업 디렉터리, 파일 정리 여부에 영향을 받지 않는다.
- job과 외래 키로 연결하고 job 삭제 시 함께 삭제할 수 있다.
- AI 호출 단계별 정렬, 실패 단계 탐색, 실행 시간 계산이 쉽다.

기존 `generation_output` 파일 기록은 로컬 조사 편의를 위해 유지할 수 있지만 best-effort 보조 산출물로 취급한다. 제품이 보여주는 진단 정보와 장애 분석의 기준은 DB 기록이다.

### 2. 키워드 개수 제한을 모든 경로에서 제거한다

다음 경로의 최대 5개 제한을 모두 제거한다.

- 수동 JSON 임포트
- 신규 문제 AI 생성
- 키워드 일괄 부여
- 단일 문제 AI 키워드 추천

키워드는 배열 길이와 관계없이 허용하되 다음 검증은 유지한다.

- 빈 문자열 금지
- 키워드 하나당 최대 50자
- trim 및 대소문자를 고려한 기존 정규화
- 정규화 후 중복 제거

프롬프트의 `1~3개`, `최대 5개` 같은 개수 지시는 제거하고, 문제의 핵심 개념만 짧은 명사구로 중복 없이 작성하도록 지시한다.

### 3. `misconception`은 오답에만 필수다

blueprint choice의 의미를 다음과 같이 정리한다.

- `correct: false`: 비어 있지 않은 `misconception` 필수
- `correct: true`: `misconception` 생략, `null`, 빈 문자열 허용

파싱 결과에서는 정답의 생략·빈 값을 `null`로 정규화한다. 구조적 난이도 평가도 오답의 `misconception`만 검사한다. 프롬프트의 출력 예시와 규칙 역시 이 계약을 명시한다.

### 4. 최초 검증 오류를 보존한다

`parseImportJson()`이 반환한 `ImportItemResult`를 그대로 생성 결과 검증에 전달한다. 이미 실패한 항목을 가짜 `{ type: "invalid" }` 문항으로 바꾸지 않는다.

생성 전용 추가 검증은 `ok: true`인 문항에만 적용하고, 기존 실패 항목은 원래 `errors`와 `index`를 유지한다. 따라서 `keywords`, `answer_indices`, `choice_explanations` 등 실제 실패 경로와 메시지가 job 결과와 화면에 남는다.

### 5. job 상태는 유효 결과를 반영한다

- 모든 문항이 유효: `SUCCEEDED`
- 일부 문항만 유효: `SUCCEEDED`, 무효 항목을 결과에 포함하고 화면에 경고 표시
- 유효 문항 0개: `FAILED`, 문항별 최초 오류를 `error_message`에 요약하고 전체 결과와 원본 응답은 보존
- 엔진 실행, 타임아웃, JSON 파싱, blueprint 검증 실패: `FAILED`, 실패한 호출 기록과 원본 응답 보존
- 검증 엔진만 실패하고 생성 문항은 유효: 기존 정책대로 `SUCCEEDED`와 `verify_warning`을 사용하되 검증 호출 실패 기록을 진단 화면에 표시

## AI 실행 기록 모델

`GenerationRunLog` 모델을 추가하고 `GenerationJob`과 1:N으로 연결한다. 테이블명은 `generation_run_log`로 한다.

필드는 다음과 같다.

```text
id                 Int, primary key
generationJobId    Int, generation_job.id foreign key, cascade delete
stage              GenerationRunStage
itemIndex           Int?, 문항 단위 수정 실행일 때 사용
attempt             Int, 같은 단계의 재시도 번호, 기본값 1
engine              GenerationEngine
model               String?, 명시적으로 선택된 모델
status              GenerationRunStatus
prompt              MediumText
response            MediumText?
stdoutTail          Text?
stderrTail          Text?
errorMessage        Text?
exitCode            Int?
timedOut            Boolean, 기본값 false
startedAt           DateTime
finishedAt          DateTime?
durationMs          Int?
```

`GenerationRunStage`는 다음 값을 가진다.

```text
BLUEPRINT
BLUEPRINT_REPAIR
GENERATION
VERIFY
ITEM_REPAIR
REPAIR_VERIFY
MANUAL_ITEM_REVISION
KEYWORD_TAG
KEYWORD_SUGGESTION
```

`GenerationRunStatus`는 `RUNNING`, `SUCCEEDED`, `FAILED`를 사용한다.

프롬프트와 AI 원본 응답은 잘리지 않아야 하므로 MariaDB `MEDIUMTEXT`로 저장한다. stdout과 stderr는 응답 본문과 중복되거나 매우 커질 수 있으므로 마지막 8,000자만 저장한다.

## 실행 흐름

AI 엔진 호출을 공통 추적 함수로 감싼다.

```text
1. 엔진 실행 전 GenerationRunLog(RUNNING) 생성
2. runEngine 실행
3. 종료 코드, 타임아웃, stdout/stderr tail, 원본 response 저장
4. JSON 파싱 및 도메인 검증
5. 성공하면 SUCCEEDED로 종료
6. 엔진·파싱·검증 오류가 발생하면 실제 오류와 함께 FAILED로 종료
```

프로세스가 예상치 못한 예외를 던져도 호출 기록을 `FAILED`로 닫는 `try/catch` 경계를 둔다. 서버 프로세스가 강제 종료되어 기록이 `RUNNING`에 남은 경우 기존 orphan 판정 시 job과 함께 해당 실행 기록도 `FAILED`로 변경한다.

`runEngine()`은 다음 진단 정보를 호출자에게 반환하도록 확장한다.

- 원본 결과 파일 내용
- stdout tail
- stderr tail
- 종료 코드
- 타임아웃 여부
- 실행 시간

서비스 계층은 파싱·스키마 오류를 실행 기록의 `errorMessage`에 추가한 뒤 상태를 확정한다. 엔진이 정상 종료했더라도 응답 파싱이나 도메인 검증이 실패했다면 해당 실행 기록은 `FAILED`다.

## API와 화면

`GenerationJobDto`에 `runLogs`를 추가하지 않고 진단 전용 API를 사용한다. 일반 job polling 응답이 대형 프롬프트와 응답 때문에 무거워지는 것을 막기 위함이다.

```text
GET /api/generate/{id}/diagnostics
```

응답은 실행 기록의 메타데이터와 원문을 포함하며 `startedAt` 오름차순으로 정렬한다. 로그인 세션이 있어야 하며 해당 개인 애플리케이션의 기존 인증 규칙을 따른다.

job 상세 화면에는 접힌 `진단 기록` 영역을 추가한다.

- 최초 화면에서는 단계, 엔진, 상태, 실행 시간, 오류 요약만 표시
- 사용자가 영역을 펼칠 때 진단 API 호출
- 각 실행에서 프롬프트, 원본 응답, stdout tail, stderr tail을 개별적으로 펼칠 수 있음
- 원문 복사 버튼 제공
- 실패한 실행과 문항 검증 오류를 먼저 식별할 수 있는 색상과 문구 사용
- 일부 문항만 무효인 `SUCCEEDED` job에는 `일부 문항 생성 실패` 경고 표시
- 사용자 피드백 문구의 기존 가벼운 이모지 사용 규칙 유지

## 기존 필드와 파일의 처리

- `generation_job.raw_output`은 기존 API와 과거 데이터 호환을 위해 유지한다.
- 새 호출부터는 `GenerationRunLog.response`가 원본 응답의 기준이다.
- `generation_output`의 prompt/result/stdout/stderr 파일 생성은 즉시 제거하지 않는다. DB 저장 실패 시 이를 대체 저장소로 승격하지 않으며 로그에 DB 기록 실패를 남긴다.
- job 삭제 시 `GenerationRunLog`는 외래 키 cascade로 삭제되고 기존 출력 디렉터리도 현재처럼 best-effort로 삭제한다.
- 별도의 기간 만료 작업은 만들지 않는다. 진단 기록은 job이 삭제될 때까지 보존한다.

## 오류 처리 원칙

- 사용자용 `error_message`에는 첫 번째 핵심 오류와 실패 항목 수를 간결하게 표시한다.
- 진단 기록에는 전체 스키마 경로와 오류 목록을 보존한다.
- AI 원본 응답 저장 실패가 원래 생성 결과를 덮지 않도록, 기록 저장 오류와 생성 오류를 구분해 서버 로그에 남긴다.
- 프롬프트나 응답을 애플리케이션 일반 로그에 다시 출력하지 않는다. DB 진단 API를 통해서만 조회한다.
- `.env`, 프로세스 환경 변수, CLI 인증 토큰은 저장하지 않는다.

## 테스트 전략

### 키워드

- 6개 이상의 키워드가 수동 임포트 스키마를 통과한다.
- 6개 이상의 키워드가 일괄 태깅 및 단일 문제 추천 파서를 통과한다.
- 빈 문자열과 50자 초과 키워드는 계속 실패한다.
- 중복 키워드는 정규화 후 하나로 합쳐진다.

### Blueprint

- 정답 choice의 생략·`null`·빈 `misconception`이 통과하고 `null`로 정규화된다.
- 오답 choice의 생략·`null`·빈 `misconception`은 실패한다.
- 구조적 난이도 평가는 오답의 오개념만 필수로 검사한다.

### 생성 파이프라인

- 최초 문항 오류가 `{ type: "invalid" }` 오류로 덮이지 않는다.
- 일부 문항만 무효면 유효 문항과 원래 오류 항목이 함께 보존된다.
- 모든 문항이 무효면 job이 `FAILED`가 된다.
- 검증 엔진만 실패하면 생성 결과는 유지되고 `verify_warning`과 실패 실행 기록이 남는다.

### 실행 기록

- 엔진 성공, 프로세스 실패, 타임아웃, JSON 파싱 실패, 스키마 실패 각각에 대해 실행 기록의 상태와 필드가 정확히 저장된다.
- 같은 단계의 재시도는 `attempt`로 구분된다.
- 문항별 수정은 `itemIndex`로 구분된다.
- job 삭제 시 실행 기록이 함께 삭제된다.
- 진단 API가 인증, 정렬, 404를 기존 API 규약대로 처리한다.

### 회귀 검증

- `npm test`
- `npx tsc --noEmit`
- `npm run lint`
- `npm run build`
- 서버에서 의도적으로 스키마 오류 응답을 만든 뒤 job 상세의 진단 기록에서 프롬프트, 원본 응답, 실제 오류 경로가 확인되는지 수동 검증

## 범위 제외

- 과거 job의 단계별 실행 기록 역산
- 진단 기록 자동 만료 및 아카이빙
- 프롬프트·응답 내용 검색
- 실패 job 자동 재실행
- AI 응답을 정상 형태로 임의 보정하는 범용 복구 로직

자동 재시도나 관대한 보정 대신, 먼저 의미에 맞는 스키마와 정확한 상태·진단 정보를 보장한다. 이후 반복되는 외부 엔진 형식 오류가 확인되면 해당 단계에 한정된 재시도를 별도 설계한다.
