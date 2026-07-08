# AI 문제 생성 (CLI non-interactive) 설계

날짜: 2026-07-08
상태: 승인됨

## 1. 목표

기존 `/import`의 수동 흐름(프롬프트 복사 → 외부 LLM에 붙여넣기 → JSON 응답을 다시 붙여넣기)을 자동화한다. 웹 화면에서 주제와 추가 지시를 입력하면, 서버가 로컬에 설치된 CLI 에이전트(claude code / codex / antigravity)를 non-interactive 모드로 실행해 JSON 규격 응답을 받고, 기존 검증·미리보기·저장 파이프라인으로 DB에 넣는다.

핵심 결정 사항:

- **저장 방식**: 미리보기 후 사람이 확인하고 저장 (자동 저장 없음)
- **실행 방식**: 잡 생성 + 폴링 (동기 대기·스트리밍 아님)
- **잡 저장소**: 기존 MariaDB에 Prisma 모델(`GenerationJob`) 추가 — 인메모리 상태 없음
- **프롬프트 입력**: 주제 선택 + 추가 지시만 자유 입력, 최종 프롬프트는 서버가 기존 템플릿과 조합
- **엔진 선택**: 화면에서 라디오로 선택 (claude 기본값)
- **UI 위치**: 새 페이지 `/generate` (기존 `/import`는 유지)
- **CLI 호출 파라미터**: `D:\work\GREED\backend\routers\jobs.py`에서 실전 검증된 방식을 그대로 사용

## 2. 아키텍처와 데이터 흐름

```
/generate 페이지
  │ ① POST /api/generate { topicId, engine, instructions }
  ▼
Route Handler (얇게: zod 파싱 → 서비스 호출)
  │ ② generation_job 행 생성 (status=RUNNING) → { job } 202 응답
  │ ③ void runJob(jobId) — 백그라운드 실행 (await 안 함)
  ▼
CLI 어댑터 (claude / codex / antigravity)
  │ ④ 최종 프롬프트 = buildGenerationPrompt(주제명) + 사용자 추가 지시
  │    + 파일 저장 지시(result.json 경로)
  ▼
자식 프로세스 종료 시: result.json 읽기 → JSON 추출 → parseImportJson 검증
  │ 성공 → status=SUCCEEDED, 항목별 검증 결과 저장
  │ 실패 → status=FAILED, 오류 메시지 + 원문 저장
  ▼
프론트: ⑤ GET /api/generate/{id} 3초 간격 폴링
  → SUCCEEDED면 미리보기 렌더링 → 사용자가 선택·확인 → ⑥ 기존 POST /api/import로 저장
```

설계 원칙 유지(플랜 00-overview의 Global Constraints):

- 실행·잡 로직은 `src/server/generation/` (서비스 계층, Next import 금지)
- 프롬프트 조립은 `src/core/prompt-template.ts` 확장 (순수 TS)
- Route Handler는 얇게 (zod 파싱 → 서비스 호출 → JSON 응답)
- 화면은 `src/lib/api-client.ts`의 `api` 객체만 사용
- 저장은 새 API 없이 기존 `POST /api/import` 재사용 — DB 삽입 경로 단일 유지

### Prisma 스키마 추가 (기존 모델 변경 없음)

```prisma
enum GenerationEngine {
  CLAUDE
  CODEX
  ANTIGRAVITY
}

enum GenerationStatus {
  RUNNING
  SUCCEEDED
  FAILED
}

model GenerationJob {
  id           Int              @id @default(autoincrement())
  topicId      Int              @map("topic_id")
  engine       GenerationEngine
  instructions String           @db.Text
  status       GenerationStatus @default(RUNNING)
  result       Json?            // 항목별 검증 결과 (ImportItemResult[] 구조)
  errorMessage String?          @map("error_message") @db.Text
  rawOutput    String?          @map("raw_output") @db.MediumText
  createdAt    DateTime         @default(now()) @map("created_at")
  finishedAt   DateTime?        @map("finished_at")
  topic        Topic            @relation(fields: [topicId], references: [id], onDelete: Cascade)

  @@map("generation_job")
}
```

`Topic` 모델에는 `generationJobs GenerationJob[]` 역방향 관계만 추가된다.

## 3. CLI 어댑터 (`src/server/generation/`)

GREED `jobs.py`에서 검증된 호출 파라미터를 그대로 사용한다.

### 엔진별 커맨드

| 엔진 | 커맨드 | 프롬프트 전달 |
|---|---|---|
| claude | `claude.exe --dangerously-skip-permissions --model sonnet -p` | stdin |
| codex | `codex.exe exec --yolo -` | stdin |
| antigravity | `agy.exe --dangerously-skip-permissions -p "<프롬프트 파일을 읽고 지시를 따르라>" --model "Gemini 3.1 Pro (High)"` | 프롬프트 파일 경로를 `-p` 인자로 지시 |

### Windows 실행 파일 직접 호출 (GREED의 교훈)

- `claude.cmd` 배치 래퍼는 exit code를 전달하지 않고 배치 잡음이 stdout에 섞임 → `~/.local/bin/claude.exe`, `~/AppData/Roaming/npm/node_modules/@anthropic-ai/claude-code/bin/claude.exe` 순으로 탐색, 없으면 `claude.cmd` 폴백
- `codex.cmd`는 stdin을 내부 프로세스로 전달하지 않음 → npm 글로벌 레이아웃의 `codex.exe`(`@openai/codex-win32-{x64,arm64}/vendor/.../codex.exe`) 탐색, 없으면 `codex.cmd` 폴백
- antigravity는 `%LOCALAPPDATA%\agy\bin\agy.exe` 탐색, 없으면 `agy.exe` 폴백

### 파일 기반 출력

stdout 캡처 대신, 프롬프트에 "결과 JSON을 stdout에 출력하지 말고 지정 경로에 UTF-8 파일로만 저장하라"는 지시를 추가한다. `--yolo`/`--dangerously-skip-permissions`는 이 파일 쓰기를 위해 필요하다.

잡별 출력 디렉터리 (`.gitignore`에 추가):

```
generation_output/jobs/<jobId>/
  prompt.md      # 조립된 최종 프롬프트 (agy는 이 파일 경로를 -p로 받음)
  result.json    # 모델이 저장하는 결과 JSON
  stdout.log     # 진단용
  stderr.log     # 진단용
```

### 실행기 동작 (GREED 대비 단순화)

GREED는 FastAPI 요청 프로세스와 분리하기 위해 파이썬 래퍼 + pid/exit_code 파일 + 조회 시 finalize를 썼지만, drillup은 Next.js 서버가 상주 프로세스이므로 **Node `child_process.spawn`으로 실행한 자식을 백그라운드 async 함수가 직접 await** 한다.

- `spawn(command, args, { shell: false })`, claude/codex는 프롬프트를 stdin으로 주입
- stdout/stderr는 로그 파일에 기록
- 타임아웃: 기본 10분, 환경변수 `GENERATION_TIMEOUT_MS`로 조정 — 초과 시 프로세스 kill 후 FAILED
- 종료 후 `result.json` 읽기 → 관용적 JSON 추출(코드펜스·앞뒤 잡담 제거: 첫 `{`부터 마지막 `}`까지 절단 시도 → 실패 시 원문 그대로) → `parseImportJson` 검증
- 실패 시 `error_message`에 exit code와 stdout/stderr 꼬리(각 1200자) 포함

### 잡 서비스 (`generation-service.ts`)

- `createJob(topicId, engine, instructions)` — 주제 존재 확인, 같은 주제 RUNNING 잡 존재 시 409 거부, 잡 행 INSERT, `void runJob(jobId)` 시작, 잡 반환
- `runJob(jobId)` — 프롬프트 조립 → 어댑터 실행 → 검증 → SUCCEEDED/FAILED UPDATE
- `getJob(jobId)` — 조회. `RUNNING`이면서 `created_at`이 타임아웃을 넘긴 잡은 FAILED("시간 초과 또는 서버 재시작으로 중단")로 정리 후 반환 (서버 재시작 고아 잡 안전망)
- **부분 성공 허용**: JSON 파싱이 되고 `questions` 배열이 있으면, 일부 항목만 검증 통과해도 SUCCEEDED로 두고 항목별 ok/오류를 `result`에 저장

## 4. API 설계

엔드포인트 2개 추가. 저장은 기존 `POST /api/import` 재사용.

### ① `POST /api/generate` — 잡 생성

```
요청: { topicId: number, engine: "CLAUDE" | "CODEX" | "ANTIGRAVITY", instructions: string }
응답: 202 { job: GenerationJobDto }
오류: 400 VALIDATION / 404 TOPIC_NOT_FOUND / 409 JOB_ALREADY_RUNNING
```

### ② `GET /api/generate/[id]` — 잡 조회 (폴링용)

```
응답: 200 { job: GenerationJobDto }
오류: 404 JOB_NOT_FOUND
```

### DTO (`src/lib/api-types.ts`)

```ts
export type GenerationEngineDto = "CLAUDE" | "CODEX" | "ANTIGRAVITY";
export type GenerationStatusDto = "RUNNING" | "SUCCEEDED" | "FAILED";

export interface GenerationJobDto {
  id: number;
  topicId: number;
  engine: GenerationEngineDto;
  status: GenerationStatusDto;
  items: Array<
    | { index: number; ok: true; question: unknown }
    | { index: number; ok: false; errors: string[] }
  > | null; // SUCCEEDED일 때만 채움
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
}
```

- `instructions`·`rawOutput`은 DTO에서 제외 — 화면에 불필요. 실패 진단은 `errorMessage`의 stdout/stderr 꼬리로 충분하고, 원문 전체는 DB `raw_output` 컬럼과 `generation_output/jobs/<id>/` 파일로 남는다.
- api-client에 `api.generate.create(input)`, `api.generate.get(id)` 추가 — 화면은 이 두 함수만 사용.
- 저장 단계: 미리보기에서 선택한 유효 문제만 기존 `api.import.submit(topicId, questions)`으로 전송. `/api/import`는 전 항목 유효를 요구하므로 유효 항목만 보내면 그대로 동작.

## 5. 화면 (`/generate`)

기존 `/import`의 단계식 레이아웃을 따른다.

1. **주제 선택** — `/import`와 동일한 셀렉트 + 새 주제 추가
2. **엔진·추가 지시** — 엔진 라디오(claude 기본값), 추가 지시 textarea(범위·난이도·문제 수 등, 빈 값 허용)
3. **생성 시작** — `api.generate.create()` → RUNNING 동안 버튼 비활성 + "생성 중... (경과 N초)" 표시, 3초 간격 폴링
4. **미리보기 및 저장** — SUCCEEDED 시 `/import` 4단계와 동일한 카드 UI(정답 강조, 항목별 체크박스, 오류 항목은 빨간 카드). 저장 → "✅ N개 문제를 저장했습니다"
5. **실패 시** — ❌ + `errorMessage` 표시, "다시 시도" 버튼(같은 입력으로 새 잡 생성)

리팩터링 1건: `/import`의 `QuestionPreview` 컴포넌트를 `src/components/QuestionPreview.tsx`로 추출해 두 페이지가 공유한다(동작 변화 없음). 내비게이션(layout)에 "AI 생성" 링크 추가.

의도적 단순화(YAGNI): 페이지를 벗어나면 진행 중 잡의 결과 확인 UI는 없다(잡 자체는 DB에 남음). 필요해지면 최근 잡 목록 조회를 추가한다.

## 6. 오류 처리

| 상황 | 처리 |
|---|---|
| 실행 파일 못 찾음 / spawn 실패 | 즉시 FAILED, "N 엔진 실행 파일을 찾을 수 없습니다" |
| 타임아웃(기본 10분) | 프로세스 kill → FAILED |
| `result.json` 미생성 & 프로세스 종료 | FAILED, exit code + stdout/stderr 꼬리 포함 |
| JSON 파싱 불가 / `questions` 배열 없음 | FAILED, 원문 앞부분 포함 |
| 일부 항목만 검증 통과 | SUCCEEDED + 항목별 ok/오류(`items`) |
| 같은 주제 RUNNING 잡 존재 | 409 JOB_ALREADY_RUNNING, "이미 생성 중인 작업이 있습니다" |
| 서버 재시작 고아 잡 | 조회 시점 타임아웃 판정으로 FAILED 정리 |

## 7. 테스트

vitest, core 단위 테스트만 자동화(프로젝트 규약: 서비스 계층은 수동 검증).

- `prompt-template.test.ts` — CLI용 프롬프트 조립: 주제명·추가 지시·파일 저장 지시(경로) 포함 여부
- JSON 관용 추출 유틸 테스트 — 코드펜스 제거, 앞뒤 잡담 제거, 순수 JSON 통과, 추출 불가 케이스
- 엔진 커맨드 빌더 테스트 — args 배열 구성(실행 파일 존재 확인 함수를 주입해 경로 탐색 로직도 테스트)

수동 검증: 실제 엔진 1개(claude)로 잡 생성 → 폴링 → 미리보기 → 저장까지 curl + 브라우저 확인.
