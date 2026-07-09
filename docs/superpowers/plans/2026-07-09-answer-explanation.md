# 정답/오답 화면 AI 추가 해설 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/study` 채점 결과 패널에서 사용자가 claude/codex/antigravity 중 엔진을 선택해 호출하면, 정답 근거와 모든 오답 선지(MCQ)/오답 후보(CLOZE)가 왜 틀렸는지까지 포함한 AI 해설을 동기 호출로 받아 문제+엔진 단위로 캐싱한다.

**Architecture:** 기존 AI 생성 기능의 CLI 어댑터(`buildEngineCommand`, `runEngine`)를 재사용하되, 잡+폴링 대신 요청-응답 1회로 끝나는 동기 흐름으로 구현한다. `runEngine`은 디렉터리를 직접 받도록 리팩터링해 `GenerationJob`과 `Question`의 id 네임스페이스 충돌을 없앤다.

**Tech Stack:** Next.js(App Router) + Prisma(MariaDB) + zod + vitest. CLI 엔진: claude / codex / antigravity.

**Spec:** `docs/superpowers/specs/2026-07-09-answer-explanation-design.md`

## Global Constraints

- `master` 브랜치에서 직접 작업 (브랜치·워크트리 생성 금지)
- 커밋 메시지는 한국어, conventional-commit 타입 접두사는 영어 (`feat:`, `fix:`, `test:`, `chore:`, `docs:`). 태스크당 1커밋
- 자동 테스트는 `src/core/`만 (프로젝트 규약: 서비스 계층·화면은 수동 검증). 테스트 실행: `npx vitest run <파일>`
- `src/core/`는 순수 TS — Prisma·Next·Node 전용 API import 금지 (`node:` 모듈 포함)
- Route Handler는 얇게: zod 파싱 → 서비스 호출 → JSON 응답
- 화면은 `src/lib/api-client.ts`의 `api` 객체만 사용
- 사용자 피드백 문구에 이모지 유지 (🤖/✅/❌)
- `.env`, `generation_output/`은 git 미추적 유지

---

### Task 1: Prisma 스키마 추가 + 마이그레이션

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Produces: `AnswerExplanation` 모델 — Task 5(서비스)가 Prisma 클라이언트로 사용

- [ ] **Step 1: 모델 추가**

`prisma/schema.prisma`의 `Question` 모델에 역방향 관계 한 줄 추가:

```prisma
model Question {
  ...
  answerExplanations AnswerExplanation[]
  ...
}
```

파일 끝에 새 모델 추가:

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

- [ ] **Step 2: 마이그레이션 실행**

Run: `npx prisma migrate dev --name add_answer_explanation`
Expected: 마이그레이션 SQL 생성·적용, Prisma 클라이언트 재생성. 오류 없이 종료.

- [ ] **Step 3: 커밋**

```bash
git add prisma/
git commit -m "feat: AnswerExplanation 모델 추가"
```

---

### Task 2: run-engine 리팩터링 (jobId → dir 파라미터화)

**Files:**
- Modify: `src/server/generation/run-engine.ts`
- Modify: `src/server/generation/generation-service.ts`

**Interfaces:**
- Produces: `runEngine(engine, prompt, dir: string, filePrefix?: string)` — Task 5가 새 디렉터리로 호출
- Consumes 변경 없음: `buildEngineCommand`, `jobOutputDir`(그대로 export 유지)

- [ ] **Step 1: runEngine 시그니처 변경**

`run-engine.ts`에서 `runEngine(engine, prompt, jobId: number, filePrefix = "")` 내부의 `const dir = jobOutputDir(jobId);` 줄을 제거하고, 세 번째 파라미터를 `dir: string`으로 받도록 변경한다. `jobOutputDir` 함수 자체는 그대로 export 유지(호출자가 필요시 사용).

- [ ] **Step 2: 호출부 수정**

`generation-service.ts`의 두 호출부를 수정:

```ts
// 변경 전: runEngine(job.engine, prompt, jobId)
const run = await runEngine(job.engine, prompt, jobOutputDir(jobId));

// 변경 전: runEngine(job.verifyEngine, verifyPrompt, jobId, "verify-")
const verifyRun = await runEngine(job.verifyEngine, verifyPrompt, jobOutputDir(jobId), "verify-");
```

- [ ] **Step 3: 타입 검사**

```bash
npx tsc --noEmit
```

Expected: 오류 없음. 관련 vitest(있다면 `run-engine`/`engine-command` 테스트)도 함께 실행해 회귀 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/server/generation/
git commit -m "refactor: runEngine이 jobId 대신 출력 디렉터리를 직접 받도록 변경"
```

---

### Task 3: 프롬프트 템플릿 + JSON 파서 + vitest

**Files:**
- Modify: `src/core/prompt-template.ts`
- Create: `src/core/explanation-schema.ts`
- Create/Modify: `src/core/prompt-template.test.ts`, `src/core/explanation-schema.test.ts`

**Interfaces:**
- Consumes: `McqPayload`, `ClozePayload`(`src/core/types.ts`)
- Produces:
  - `buildAnswerExplanationPrompt(type: "MCQ" | "CLOZE", payload: McqPayload | ClozePayload, resultPath: string): string`
  - `parseExplanationJson(rawText: string): { ok: true; explanation: string } | { ok: false; fatal: string }`

- [ ] **Step 1: buildAnswerExplanationPrompt 작성**

`src/core/prompt-template.ts`에 추가. MCQ는 질문+전체 보기(정답 표시 포함)를 나열해 정답 근거와 각 오답 보기가 왜 틀렸는지 설명하도록, CLOZE는 본문+빈칸 정답+distractors를 나열해 각 빈칸 근거와 각 distractor가 왜 안 맞는지 설명하도록 지시한다. 기존 `buildCliGenerationPrompt`/`buildCliVerifyPrompt`와 동일한 "결과 저장" 규칙(stdout 금지, `resultPath`에 UTF-8 JSON `{ "explanation": "..." }`만 저장, 코드펜스 금지)을 포함한다.

- [ ] **Step 2: explanation-schema.ts 작성**

`src/core/import-schema.ts`의 `parseImportJson`과 동일한 스타일로 작성:

```ts
import { z } from "zod";

const explanationSchema = z.object({
  explanation: z.string().trim().min(1, "explanation은 비어 있으면 안 됩니다"),
});

export type ExplanationParseResult =
  | { ok: true; explanation: string }
  | { ok: false; fatal: string };

export function parseExplanationJson(rawText: string): ExplanationParseResult {
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    return { ok: false, fatal: "올바른 JSON이 아닙니다" };
  }
  const parsed = explanationSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, fatal: "explanation 필드가 없거나 형식이 올바르지 않습니다" };
  }
  return { ok: true, explanation: parsed.data.explanation };
}
```

- [ ] **Step 3: vitest 작성**

`prompt-template.test.ts`에 케이스 추가: MCQ/CLOZE 각각에 대해 결과 문자열에 정답 표시, 오답/distractor 목록, `resultPath`가 포함되는지 확인.

`explanation-schema.test.ts` 신규: 정상 JSON, 빈 문자열 explanation, JSON 아님, `explanation` 필드 없음 케이스.

Run: `npx vitest run src/core/prompt-template.test.ts src/core/explanation-schema.test.ts`
Expected: 모두 통과.

- [ ] **Step 4: 커밋**

```bash
git add src/core/
git commit -m "feat: 답안 해설 프롬프트 빌더와 JSON 파서 추가"
```

---

### Task 4: explanation-service.ts 작성

**Files:**
- Create: `src/server/explanation-service.ts`

**Interfaces:**
- Consumes: `prisma`(`src/server/db.ts`), `ServiceError`(`src/server/errors.ts`), `runEngine`(Task 2), `buildAnswerExplanationPrompt`/`parseExplanationJson`(Task 3), `extractJsonObject`(`src/core/json-extract.ts`)
- Produces: `getAnswerExplanation(questionId: number, engine: GenerationEngine): Promise<{ engine: GenerationEngine; content: string; cached: boolean }>` — Task 6(Route Handler)이 호출

- [ ] **Step 1: 서비스 작성**

```ts
import path from "node:path";
import { GenerationEngine } from "@prisma/client";
import { buildAnswerExplanationPrompt } from "@/core/prompt-template";
import { parseExplanationJson } from "@/core/explanation-schema";
import { extractJsonObject } from "@/core/json-extract";
import type { ClozePayload, McqPayload } from "@/core/types";
import { prisma } from "./db";
import { ServiceError } from "./errors";
import { runEngine } from "./generation/run-engine";

export async function getAnswerExplanation(
  questionId: number,
  engine: GenerationEngine,
): Promise<{ engine: GenerationEngine; content: string; cached: boolean }> {
  const question = await prisma.question.findUnique({ where: { id: questionId } });
  if (!question) {
    throw new ServiceError("NOT_FOUND", "문제를 찾을 수 없습니다", 404);
  }

  const existing = await prisma.answerExplanation.findUnique({
    where: { questionId_engine: { questionId, engine } },
  });
  if (existing) {
    return { engine, content: existing.content, cached: true };
  }

  const dir = path.resolve(
    "generation_output",
    "explanations",
    `${questionId}-${engine.toLowerCase()}`,
  );
  const prompt = buildAnswerExplanationPrompt(
    question.type,
    question.payload as unknown as McqPayload | ClozePayload,
    path.join(dir, "result.json"),
  );

  const run = await runEngine(engine, prompt, dir);
  if (!run.ok) {
    throw new ServiceError("EXPLANATION_FAILED", run.failureReason, 502);
  }

  const parsed = parseExplanationJson(extractJsonObject(run.resultText));
  if (!parsed.ok) {
    throw new ServiceError("EXPLANATION_PARSE_ERROR", parsed.fatal, 502);
  }

  await prisma.answerExplanation.create({
    data: { questionId, engine, content: parsed.explanation },
  });

  return { engine, content: parsed.explanation, cached: false };
}
```

주의: `runEngine`의 `resultPath`는 `dir` 내부에 `result.json`으로 고정되어 있으므로(파일 접두사 없을 때), 프롬프트에 넣는 `resultPath` 문자열도 `path.join(dir, "result.json")`으로 정확히 일치시켜야 한다(Task 2에서 확인한 `run-engine.ts`의 `resultPath = path.join(dir, \`${filePrefix}result.json\`)` 로직 참고).

- [ ] **Step 2: 타입 검사**

```bash
npx tsc --noEmit
```

Expected: 오류 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/server/explanation-service.ts
git commit -m "feat: 답안 해설 서비스(캐시 조회 및 CLI 호출) 추가"
```

---

### Task 5: API route + DTO + api-client

**Files:**
- Create: `src/app/api/questions/[id]/explain/route.ts`
- Modify: `src/lib/api-types.ts`
- Modify: `src/lib/api-client.ts`

**Interfaces:**
- Consumes: `getAnswerExplanation`(Task 4), `handleApiError`/`jsonOk`/`parseBody`(`src/server/http.ts`)
- Produces:
  - `POST /api/questions/{id}/explain` `{ engine }` → `AnswerExplanationDto`
  - `api.questions.explain(id, engine)` — Task 6이 화면에서 사용

- [ ] **Step 1: DTO 추가**

`src/lib/api-types.ts`에 추가:

```ts
export interface AnswerExplanationDto {
  engine: GenerationEngineDto;
  content: string;
  cached: boolean;
}
```

- [ ] **Step 2: Route Handler 작성**

`src/app/api/questions/[id]/explain/route.ts`:

```ts
import { z } from "zod";
import { GenerationEngine } from "@prisma/client";
import { handleApiError, jsonOk, parseBody } from "@/server/http";
import { getAnswerExplanation } from "@/server/explanation-service";

const bodySchema = z.object({
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
});

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const { engine } = await parseBody(req, bodySchema);
    const result = await getAnswerExplanation(
      Number(id),
      engine as GenerationEngine,
    );
    return jsonOk(result);
  } catch (e) {
    return handleApiError(e);
  }
}
```

(기존 `src/app/api/questions/[id]/route.ts`의 params 처리 방식을 확인해 Next.js 버전에 맞는 시그니처로 맞출 것.)

- [ ] **Step 3: api-client 추가**

`src/lib/api-client.ts`의 `questions` 네임스페이스에 추가:

```ts
explain: (id: number, engine: GenerationEngineDto) =>
  request<AnswerExplanationDto>(`/api/questions/${id}/explain`, {
    method: "POST",
    body: JSON.stringify({ engine }),
  }),
```

- [ ] **Step 4: 타입 검사 및 수동 확인**

```bash
npx tsc --noEmit
```

`npm run dev` 상태에서:

```bash
curl.exe -s -b cookies.txt -H "Content-Type: application/json" -d "{\"engine\":\"CLAUDE\"}" http://localhost:3000/api/questions/1/explain
```

Expected: `{ "engine": "CLAUDE", "content": "...", "cached": false }`. 같은 요청 재호출 시 `"cached": true`.

- [ ] **Step 5: 커밋**

```bash
git add src/app/api/questions/ src/lib/
git commit -m "feat: 답안 해설 API와 클라이언트 함수 추가"
```

---

### Task 6: ResultPanel UI 추가 및 수동 검증

**Files:**
- Modify: `src/components/ResultPanel.tsx`

**Interfaces:**
- Consumes: `api.questions.explain`(Task 5), `AnswerExplanationDto`

- [ ] **Step 1: UI 작성**

`question.explanation` 문단 아래에 섹션 추가. 컴포넌트 내부 state로 엔진별 상태 관리(`idle | loading | done | error`)와 응답 `content`를 보관한다:

```tsx
const ENGINES: { value: GenerationEngineDto; label: string }[] = [
  { value: "CLAUDE", label: "Claude로 해설받기" },
  { value: "CODEX", label: "Codex로 해설받기" },
  { value: "ANTIGRAVITY", label: "Antigravity로 해설받기" },
];

const [engineStates, setEngineStates] = useState<
  Record<GenerationEngineDto, { status: "idle" | "loading" | "done" | "error"; content?: string; error?: string }>
>({ CLAUDE: { status: "idle" }, CODEX: { status: "idle" }, ANTIGRAVITY: { status: "idle" } });

async function requestExplanation(engine: GenerationEngineDto) {
  setEngineStates((s) => ({ ...s, [engine]: { status: "loading" } }));
  try {
    const res = await api.questions.explain(question.id, engine);
    setEngineStates((s) => ({ ...s, [engine]: { status: "done", content: res.content } }));
  } catch (err) {
    setEngineStates((s) => ({
      ...s,
      [engine]: { status: "error", error: err instanceof Error ? err.message : "요청 실패" },
    }));
  }
}
```

버튼 목록(각 버튼은 `status === "loading"`이면 비활성화 + "불러오는 중..." 표시, `status === "done"`이면 비활성화 + 완료 표시)과, `done`/`error` 상태인 엔진들에 대해 아래에 블록을 순서대로 렌더링(🤖 라벨 + `whitespace-pre-wrap`으로 content, 또는 "❌ 해설을 가져오지 못했습니다: {error}" + 재시도 버튼).

- [ ] **Step 2: 타입 검사 및 빌드**

```bash
npx tsc --noEmit
npm run lint
npm run build
```

Expected: 오류 없음.

- [ ] **Step 3: 브라우저 수동 검증**

`npm run dev`, `/study?mode=practice`에서:

1. MCQ 문제를 풀고 결과 패널에서 "Claude로 해설받기" 클릭 → 로딩 표시 → 정답 근거 + 각 오답 보기 설명이 포함된 해설 표시
2. 이어서 "Codex로 해설받기" 클릭 → Claude 해설 아래에 Codex 해설이 추가로 쌓여 표시되는지 확인
3. CLOZE 문제에서도 동일하게 확인 (빈칸 정답 근거 + distractor 설명)
4. 같은 문제를 다시 풀 때(연습 모드 재출제 또는 SRS) 같은 엔진 버튼을 누르면 CLI 재호출 없이 즉시 표시되는지(체감상 즉시 응답) 확인

- [ ] **Step 4: 커밋**

```bash
git add src/components/ResultPanel.tsx
git commit -m "feat: 결과 패널에 AI 추가 해설 버튼 추가"
```
