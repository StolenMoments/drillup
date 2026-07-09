# 정답/오답 화면 AI 추가 해설 설계

날짜: 2026-07-09

상태: 승인됨

## 1. 목표

`/study` 채점 결과 화면에는 문제 등록 시 저장된 고정 `explanation`(한두 문장)만 표시된다. 정답이 왜 맞는지는 다루지만, MCQ의 각 오답 선지나 CLOZE의 각 distractor가 왜 틀렸는지는 설명하지 않는다. 사용자가 결과 패널에서 원하는 AI CLI 엔진(claude code / codex / antigravity)을 선택해 호출하면, 정답 근거와 모든 오답 선지/후보가 왜 틀렸는지까지 포함한 풍부한 해설을 받을 수 있게 한다.

기존 AI 문제 생성 기능(`docs/superpowers/specs/2026-07-08-ai-generation-design.md`)에서 검증된 CLI 어댑터(`src/core/engine-command.ts`, `src/server/generation/run-engine.ts`)를 재사용한다. 다만 "여러 문제를 생성하는 잡(job) + 폴링" 대신, "문제 하나당 해설 1건을 동기 호출로 받는" 단순한 흐름으로 만든다.

핵심 결정 사항:

- **엔진 선택**: 처음 호출부터 사용자가 3개(Claude/Codex/Antigravity) 중 원하는 엔진을 골라 받는다. 기본으로 자동 호출되는 엔진은 없다. 이후 다른 엔진도 추가로 선택해 여러 결과를 누적해서 볼 수 있다.
- **호출 시점**: 채점 결과 패널의 버튼을 눌렀을 때만 호출 (자동 호출 없음).
- **캐싱**: 문제+엔진 단위로 DB에 저장해 재사용. 같은 문제를 SRS로 다시 풀 때 재호출하지 않는다.
- **실행 방식**: 잡+폴링 구조 없이 **동기 호출** — 버튼 클릭 → API가 CLI 종료까지 기다렸다가 결과를 바로 응답. 해설 1건은 보통 수십 초 내로 끝나 기존 생성 잡 폴링보다 단순하다.
- **적용 범위**: MCQ, CLOZE 모두 지원.

## 2. 아키텍처와 데이터 흐름

```
ResultPanel의 엔진별 버튼(Claude/Codex/Antigravity 중 선택)
  │ POST /api/questions/{id}/explain { engine }
  ▼
Route Handler (얇게: zod 파싱 → 서비스 호출)
  │ getAnswerExplanation(questionId, engine)
  ▼
explanation-service.ts
  ① AnswerExplanation 테이블에서 (questionId, engine) 캐시 조회 → 있으면 즉시 반환 (cached:true)
  ② 없으면: Question 조회 → buildAnswerExplanationPrompt(type, payload, resultPath)
  ③ runEngine(engine, prompt, dir) — 기존 generation 인프라 재사용, CLI 종료까지 await
  ④ result.json 읽기 → extractJsonObject → parseExplanationJson
  ⑤ 성공 시 AnswerExplanation에 저장(cached:false) 후 반환 / 실패 시 502 ServiceError
  ▼
프론트: 응답을 해당 엔진 블록으로 렌더링. 다른 엔진 버튼을 추가로 눌러 결과를 누적 표시
```

설계 원칙 유지(플랜 00-overview의 Global Constraints):

- 서비스 로직은 `src/server/`, 프롬프트/파싱은 `src/core/`(순수 TS)
- Route Handler는 얇게 (zod 파싱 → 서비스 호출 → JSON 응답)
- 화면은 `src/lib/api-client.ts`의 `api` 객체만 사용

### Prisma 스키마 추가 (기존 모델 변경 없음, `GenerationEngine` enum 재사용)

```prisma
model AnswerExplanation {
  id         Int              @id @default(autoincrement())
  questionId Int              @map("question_id")
  engine     GenerationEngine
  content    String           @db.Text
  createdAt  DateTime         @default(now()) @map("created_at")
  question   Question         @relation(fields: [questionId], references: [id], onDelete: Cascade)

  @@unique([questionId, engine])
  @@map("answer_explanation")
}
```

`Question` 모델에는 `answerExplanations AnswerExplanation[]` 역방향 관계만 추가된다.

## 3. 기존 코드 리팩터링 — id 네임스페이스 충돌 방지

`src/server/generation/run-engine.ts`의 `runEngine(engine, prompt, jobId: number, filePrefix)`는 내부에서 `jobOutputDir(jobId)`로 `generation_output/jobs/<jobId>/` 경로를 계산한다. 이 기능은 `GenerationJob.id`와 무관한 `Question.id`를 사용하므로, 같은 숫자를 그대로 넘기면 서로 다른 두 테이블의 auto-increment id가 우연히 같을 때(예: `GenerationJob #5`와 `Question #5`) 출력 디렉터리가 충돌해 파일을 서로 덮어쓸 수 있다.

대응: `runEngine` 시그니처를 `runEngine(engine, prompt, dir: string, filePrefix = "")`로 바꿔 디렉터리 계산을 호출자에게 위임한다. `jobOutputDir(jobId)`는 그대로 export 유지하고, `generation-service.ts`의 두 호출부는 `runEngine(job.engine, prompt, jobOutputDir(jobId))` 형태로 명시적으로 전달하도록 수정한다. 동작 변화 없는 순수 리팩터링이다.

## 4. CLI 어댑터 재사용

엔진별 실행 파일 탐색·spawn·stdin 전달·타임아웃·파일 기반 출력은 기존 `buildEngineCommand`(`src/core/engine-command.ts`)와 `runEngine`(리팩터링 후)을 그대로 사용한다. 새 기능 전용 출력 디렉터리:

```
generation_output/explanations/<questionId>-<engine 소문자>/
  prompt.md
  result.json
  stdout.log
  stderr.log
```

타임아웃은 기존 `GENERATION_TIMEOUT_MS`(기본 10분)를 안전장치로 그대로 재사용한다. 별도 env 변수를 추가하지 않는다(YAGNI) — 해설 1건은 통상 수십 초 내 종료될 것으로 예상된다.

## 5. 프롬프트 (`src/core/prompt-template.ts`)

`buildAnswerExplanationPrompt(type: "MCQ" | "CLOZE", payload: McqPayload | ClozePayload, resultPath: string): string` 추가.

- MCQ: 질문 + 전체 보기(정답 표시 포함)를 나열하고, 정답 근거를 먼저 설명한 뒤 각 오답 보기가 왜 틀렸는지 각각 설명하도록 지시.
- CLOZE: 본문(`{{n}}` 포함) + 각 빈칸 정답 + distractors 목록을 나열하고, 각 빈칸 정답 근거와 각 distractor가 왜 그 자리에 맞지 않는지 각각 설명하도록 지시.
- 공통: 한국어, 마크다운 기호 없이 평문/줄바꿈만 사용, 기존 `buildCliGenerationPrompt`/`buildCliVerifyPrompt`와 동일한 "결과 저장" 규칙(stdout 금지, `resultPath`에 UTF-8 JSON `{ "explanation": "..." }`만 저장, 코드펜스·군더더기 문장 금지).

## 6. JSON 파싱 (`src/core/explanation-schema.ts`, 신규)

`parseImportJson`(`src/core/import-schema.ts`)과 동일한 스타일:

```ts
export type ExplanationParseResult =
  | { ok: true; explanation: string }
  | { ok: false; fatal: string };

export function parseExplanationJson(rawText: string): ExplanationParseResult;
```

zod로 `{ explanation: string(비어있지 않음) }` 검증.

## 7. 서비스 (`src/server/explanation-service.ts`, 신규)

```ts
export async function getAnswerExplanation(
  questionId: number,
  engine: GenerationEngine,
): Promise<{ engine: GenerationEngine; content: string; cached: boolean }>
```

- Question 조회(없으면 404 `ServiceError`).
- `prisma.answerExplanation.findUnique({ where: { questionId_engine: { questionId, engine } } })` → 있으면 `{ ..., cached: true }` 즉시 반환.
- 없으면 `dir = path.resolve("generation_output", "explanations", \`${questionId}-${engine.toLowerCase()}\`)`, `buildAnswerExplanationPrompt` + `runEngine(engine, prompt, dir)` 호출.
- 실패(`run.ok === false`) → `ServiceError("EXPLANATION_FAILED", run.failureReason, 502)`.
- 성공 → `extractJsonObject` + `parseExplanationJson`; 파싱 실패 시 `ServiceError("EXPLANATION_PARSE_ERROR", ..., 502)`.
- 성공 파싱 → `prisma.answerExplanation.create(...)` 후 `{ engine, content, cached: false }` 반환.

## 8. API 설계

엔드포인트 1개 추가.

### `POST /api/questions/{id}/explain`

```
요청: { engine: "CLAUDE" | "CODEX" | "ANTIGRAVITY" }
응답: 200 { engine, content, cached }
오류: 400 VALIDATION / 404 NOT_FOUND / 502 EXPLANATION_FAILED / EXPLANATION_PARSE_ERROR
```

엔진은 매 호출마다 요청 본문에 명시된다(서비스에 "기본 엔진" 개념 없음) — 어떤 엔진을 먼저 부를지는 전적으로 프론트(사용자 선택)가 결정한다.

### DTO (`src/lib/api-types.ts`)

```ts
export interface AnswerExplanationDto {
  engine: GenerationEngineDto;
  content: string;
  cached: boolean;
}
```

api-client에 `api.questions.explain(id, engine)` 추가 — 화면은 이 함수만 사용.

## 9. 화면 (`src/components/ResultPanel.tsx`)

`question.explanation` 표시 문단 아래에 섹션 추가. `ResultPanel`은 문제마다 새로 마운트되므로(부모가 `result`를 `null`로 바꾸면 언마운트) 내부 state로 충분하다.

- 초기: "🤖 AI 해설 받기" 아래 엔진 3개 버튼을 처음부터 나란히 노출 — "Claude로 해설받기" / "Codex로 해설받기" / "Antigravity로 해설받기". 기본으로 미리 눌려있거나 자동 호출되는 엔진은 없다.
- 클릭 → 해당 버튼 로딩 표시(`disabled` + "불러오는 중...") → `api.questions.explain(question.id, engine)` → 성공 시 그 버튼을 완료 상태로 바꾸고, 버튼 목록 아래에 엔진 라벨 + `content`(줄바꿈 보존, `whitespace-pre-wrap`) 블록을 추가로 쌓아 표시.
- 나머지 엔진 버튼은 계속 눌러서 추가로 받을 수 있다(여러 엔진 결과 동시 누적 표시 가능).
- 실패 시 해당 엔진 버튼을 다시 활성화하고 그 아래 "❌ 해설을 가져오지 못했습니다: {message}"를 표시해 재시도 가능하게 한다.
- 기존 UI 톤 유지(이모지 유지, 한국어 문구, 기존 버튼/색상 클래스 재사용).

## 10. 오류 처리

| 상황 | 처리 |
|---|---|
| 문제 없음 | 404 NOT_FOUND |
| 실행 파일 못 찾음 / spawn 실패 | 502 EXPLANATION_FAILED, "N 엔진 실행 파일을 찾을 수 없습니다" |
| 타임아웃(기본 10분) | 502 EXPLANATION_FAILED, 시간 초과 메시지 |
| `result.json` 미생성 & 프로세스 종료 | 502 EXPLANATION_FAILED, exit code + stdout/stderr 꼬리 포함 |
| JSON 파싱 불가 / `explanation` 필드 없음 | 502 EXPLANATION_PARSE_ERROR |
| 이미 캐시 존재 | 200, `cached: true`, CLI 재호출 없음 |

## 11. 테스트

vitest, core 단위 테스트만 자동화(프로젝트 규약: 서비스 계층은 수동 검증).

- `prompt-template.test.ts`에 `buildAnswerExplanationPrompt` 케이스 추가 — MCQ/CLOZE 각각 정답 표시·resultPath 지시 포함 여부
- `explanation-schema.test.ts` — 정상 JSON, 빈 문자열, JSON 아님, `explanation` 필드 없음 케이스

수동 검증: 실제 엔진으로 문제 1건 해설 요청 → 응답 확인 → Prisma Studio에서 `AnswerExplanation` 행 확인 → 같은 요청 재호출 시 `cached:true`이고 새 프롬프트 파일이 생기지 않는지 확인 → 브라우저에서 MCQ/CLOZE 각각 결과 패널에서 버튼 클릭까지 확인.
