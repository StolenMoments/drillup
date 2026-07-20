# 문제 핵심 내용 AI 추출 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 학습 중인 문제에서 노트에 적을 만한 핵심 포인트를 AI가 추출해 미리보기로 보여주고, 사용자가 확인 후 주제 노트에 추가할 수 있게 한다.

**Architecture:** 기존 `getAnswerExplanation`(explain)과 동일한 **동기 엔진 호출** 패턴을 따른다. DB 테이블도 잡도 추가하지 않는다. Core에 프롬프트 빌더를 추가하고, 결과 파싱은 기존 `parseNoteTidyResult`를 `allowEmpty` 옵션으로 확장해 재사용한다. 서버는 문제 + 현재 주제 노트를 프롬프트에 넣어 엔진을 호출하고 추출된 마크다운을 그대로 반환한다. UI는 기존 `NotePanel`에 "✨ AI 추출" 흐름을 추가한다.

**Tech Stack:** Next.js 16 App Router, TypeScript strict, Prisma + MariaDB, zod v4, vitest + @testing-library/react, react-markdown

## Global Constraints

- 설계 스펙: `docs/superpowers/specs/2026-07-20-note-extract-design.md`
- `master`에서 직접 작업한다. feature branch·worktree를 만들지 않는다.
- 작업 시작 전 `git pull`.
- 커밋 메시지는 한국어, 타입 프리픽스만 영어(`feat:`, `fix:`, `test:`, `chore:`, `docs:`). **태스크당 커밋 1개.**
- 사용자 노출 문구의 이모지를 유지한다 (`✅`/`❌`/`🎉`/`✨`/`🤖`).
- 프론트엔드에서 `fetch`를 직접 호출하지 않는다. 반드시 `src/lib/api-client.ts`의 `api.*`를 경유한다.
- Core(`src/core/`)만 vitest 자동 테스트 대상이다. 서버 라우트는 curl 수동 검증(프로젝트 컨벤션). 컴포넌트는 기존 `NotePanel.test.tsx` 관례를 따라 테스트한다.
- 기존 `parseNoteTidyResult` 호출부(`src/server/note-tidy-runner.ts`)의 동작은 바뀌면 안 된다.
- 각 태스크 끝에서 `npx tsc --noEmit`이 통과해야 한다.

---

## File Structure

| 파일 | 책임 | 태스크 |
|---|---|---|
| `src/core/note-tidy-result.ts` | `{note: string}` JSON 파싱. `allowEmpty` 옵션 추가 | 1 |
| `src/core/note-extract-prompt.ts` | 추출 프롬프트 문자열 생성 (순수 함수) | 2 |
| `src/server/note-extract-service.ts` | 문제·노트 조회 → 엔진 호출 → 파싱 → DTO | 3 |
| `src/app/api/questions/[id]/note-extract/route.ts` | thin Route Handler | 3 |
| `src/lib/api-types.ts` | `NoteExtractDto` 추가 | 3 |
| `src/lib/api-client.ts` | `api.notes.extract` 추가 | 4 |
| `src/components/NotePanel.tsx` | `questionId` prop + 추출 UI 흐름 | 4 |
| `src/app/study/page.tsx` | `NotePanel`에 `questionId` 전달 | 4 |

---

### Task 1: `parseNoteTidyResult`에 `allowEmpty` 옵션 추가

현재 파서는 빈 note를 항상 실패로 처리한다. 추출에서는 "기존 노트에 없는 새 포인트가 없음"이 정상 결과이므로 빈 문자열을 허용해야 한다. tidy 호출부는 기본값(`false`)으로 동작이 유지된다.

**Files:**
- Modify: `src/core/note-tidy-result.ts`
- Test: `src/core/note-tidy-result.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces: `parseNoteTidyResult(rawText: string, options?: { allowEmpty?: boolean }): NoteTidyParseResult`
  - `NoteTidyParseResult = { ok: true; note: string } | { ok: false; fatal: string }`

- [ ] **Step 1: 기존 테스트 파일을 확인한다**

Run: `npx vitest run src/core/note-tidy-result.test.ts`
Expected: PASS (기존 테스트 전부 통과 — 변경 전 baseline)

테스트 파일이 없으면 이 단계는 건너뛰고 Step 2에서 새로 만든다.

- [ ] **Step 2: 실패하는 테스트를 추가한다**

`src/core/note-tidy-result.test.ts`에 아래 describe 블록을 **추가**한다 (파일이 없으면 상단에 `import { describe, expect, it } from "vitest";`와 `import { parseNoteTidyResult } from "./note-tidy-result";`를 넣고 새로 만든다).

```typescript
describe("parseNoteTidyResult - allowEmpty", () => {
  it("기본값에서는 빈 note를 실패로 처리한다", () => {
    const result = parseNoteTidyResult('{"note":"   "}');
    expect(result).toEqual({ ok: false, fatal: "정리된 노트가 비어 있습니다" });
  });

  it("allowEmpty가 true면 빈 note를 빈 문자열 성공으로 처리한다", () => {
    const result = parseNoteTidyResult('{"note":"   "}', { allowEmpty: true });
    expect(result).toEqual({ ok: true, note: "" });
  });

  it("allowEmpty가 true여도 note 필드가 없으면 실패한다", () => {
    const result = parseNoteTidyResult('{"other":"x"}', { allowEmpty: true });
    expect(result).toEqual({ ok: false, fatal: "note 필드가 필요합니다" });
  });

  it("allowEmpty가 true여도 JSON이 아니면 실패한다", () => {
    const result = parseNoteTidyResult("not json", { allowEmpty: true });
    expect(result).toEqual({ ok: false, fatal: "올바른 JSON이 아닙니다" });
  });

  it("내용이 있으면 옵션과 무관하게 trim해서 반환한다", () => {
    expect(parseNoteTidyResult('{"note":"  - 항목  "}')).toEqual({
      ok: true,
      note: "- 항목",
    });
    expect(
      parseNoteTidyResult('{"note":"  - 항목  "}', { allowEmpty: true }),
    ).toEqual({ ok: true, note: "- 항목" });
  });
});
```

- [ ] **Step 3: 테스트를 실행해 실패를 확인한다**

Run: `npx vitest run src/core/note-tidy-result.test.ts`
Expected: FAIL — "allowEmpty가 true면 빈 note를 빈 문자열 성공으로 처리한다"가
`{ ok: false, fatal: "정리된 노트가 비어 있습니다" }`를 받아 실패한다.
(두 번째 인자를 무시하므로 나머지 allowEmpty 케이스는 우연히 통과할 수 있다.)

- [ ] **Step 4: 최소 구현을 작성한다**

`src/core/note-tidy-result.ts`를 아래로 교체한다.

```typescript
import { z } from "zod";

const noteTidySchema = z.object({ note: z.string() });

export type NoteTidyParseResult =
  | { ok: true; note: string }
  | { ok: false; fatal: string };

export interface NoteTidyParseOptions {
  /** 빈 note를 정상 결과(빈 문자열)로 받을지 여부. 기본 false. */
  allowEmpty?: boolean;
}

export function parseNoteTidyResult(
  rawText: string,
  options: NoteTidyParseOptions = {},
): NoteTidyParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return { ok: false, fatal: "올바른 JSON이 아닙니다" };
  }
  const parsed = noteTidySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fatal: "note 필드가 필요합니다" };
  }
  const note = parsed.data.note.trim();
  if (note.length === 0 && !options.allowEmpty) {
    return { ok: false, fatal: "정리된 노트가 비어 있습니다" };
  }
  return { ok: true, note };
}
```

- [ ] **Step 5: 테스트를 실행해 통과를 확인한다**

Run: `npx vitest run src/core/note-tidy-result.test.ts`
Expected: PASS (신규 5개 포함 전부)

- [ ] **Step 6: 기존 호출부 회귀를 확인한다**

Run: `npx vitest run`
Expected: PASS (전체 스위트)

Run: `npx tsc --noEmit`
Expected: 출력 없음 (에러 0)

- [ ] **Step 7: 커밋**

```bash
git add src/core/note-tidy-result.ts src/core/note-tidy-result.test.ts
git commit -m "feat: 노트 결과 파서에 빈 결과 허용 옵션 추가"
```

---

### Task 2: 추출 프롬프트 빌더 (`buildNoteExtractPrompt`)

문제 내용(문항·선택지·정답·해설)과 현재 주제 노트를 받아, 기존 노트에 없는 새 포인트만 마크다운 bullet으로 추출하도록 지시하는 프롬프트를 만든다. 순수 함수라 vitest로 완전히 검증 가능하다.

**Files:**
- Create: `src/core/note-extract-prompt.ts`
- Test: `src/core/note-extract-prompt.test.ts`

**Interfaces:**
- Consumes: `McqPayload`, `ClozePayload`, `QuestionType`, `mcqAnswerIndices` from `@/core/types`
- Produces:
  ```typescript
  buildNoteExtractPrompt(
    type: QuestionType,
    payload: McqPayload | ClozePayload,
    explanation: string | null,
    currentNote: string,
    resultPath: string,
  ): string
  ```

- [ ] **Step 1: 실패하는 테스트를 작성한다**

`src/core/note-extract-prompt.test.ts` 생성:

```typescript
import { describe, expect, it } from "vitest";
import type { ClozePayload, McqPayload } from "./types";
import { buildNoteExtractPrompt } from "./note-extract-prompt";

const mcq: McqPayload = {
  question: "정적 웹사이트를 가장 저렴하게 호스팅하는 방법은?",
  choices: ["S3 정적 웹사이트 호스팅", "EC2 t3.micro", "Lightsail", "ECS Fargate"],
  answer_indices: [0],
};

const cloze: ClozePayload = {
  text: "___1___은 객체 스토리지이고 ___2___는 블록 스토리지다.",
  blanks: [
    { id: 1, answer: "S3" },
    { id: 2, answer: "EBS" },
  ],
  distractors: ["EFS", "Glacier"],
};

describe("buildNoteExtractPrompt - MCQ", () => {
  const prompt = buildNoteExtractPrompt(
    "MCQ",
    mcq,
    "S3는 정적 콘텐츠를 서버 없이 제공한다.",
    "## 스토리지\n- EBS: 블록 스토리지",
    "D:/out/result.json",
  );

  it("문항과 보기를 포함한다", () => {
    expect(prompt).toContain("정적 웹사이트를 가장 저렴하게 호스팅하는 방법은?");
    expect(prompt).toContain("S3 정적 웹사이트 호스팅");
    expect(prompt).toContain("ECS Fargate");
  });

  it("정답을 보기 텍스트로 표기한다", () => {
    expect(prompt).toContain('정답: "S3 정적 웹사이트 호스팅"');
  });

  it("해설을 포함한다", () => {
    expect(prompt).toContain("S3는 정적 콘텐츠를 서버 없이 제공한다.");
  });

  it("기존 노트를 포함하고 중복 제외를 지시한다", () => {
    expect(prompt).toContain("- EBS: 블록 스토리지");
    expect(prompt).toContain("이미 있는 내용은 절대 다시 추출하지 마세요");
  });

  it("새 포인트가 없으면 빈 문자열을 반환하도록 지시한다", () => {
    expect(prompt).toContain('"note": ""');
  });

  it("출력 형식과 결과 저장 경로를 지시한다", () => {
    expect(prompt).toContain('"note"');
    expect(prompt).toContain("D:/out/result.json");
    expect(prompt).toContain("stdout에 출력하지 마세요");
  });
});

describe("buildNoteExtractPrompt - CLOZE", () => {
  const prompt = buildNoteExtractPrompt(
    "CLOZE",
    cloze,
    null,
    "",
    "D:/out/result.json",
  );

  it("본문과 빈칸 정답을 포함한다", () => {
    expect(prompt).toContain("___1___은 객체 스토리지이고");
    expect(prompt).toContain("1번 = S3");
    expect(prompt).toContain("2번 = EBS");
  });

  it("해설이 없으면 없음으로 표기한다", () => {
    expect(prompt).toContain("(해설 없음)");
  });

  it("기존 노트가 비어 있으면 비어 있음을 표기한다", () => {
    expect(prompt).toContain("(아직 노트가 비어 있습니다)");
  });
});
```

- [ ] **Step 2: 테스트를 실행해 실패를 확인한다**

Run: `npx vitest run src/core/note-extract-prompt.test.ts`
Expected: FAIL — `Failed to resolve import "./note-extract-prompt"`

- [ ] **Step 3: 구현을 작성한다**

`src/core/note-extract-prompt.ts` 생성:

```typescript
import {
  mcqAnswerIndices,
  type ClozePayload,
  type McqPayload,
  type QuestionType,
} from "./types";

function mcqSection(payload: McqPayload): string {
  const correctText = mcqAnswerIndices(payload)
    .map((index) => payload.choices[index])
    .join(", ");
  const choiceLines = payload.choices.map((choice) => `- ${choice}`).join("\n");
  return `## 문제 (객관식)

질문: ${payload.question}

보기:
${choiceLines}

정답: "${correctText}"`;
}

function clozeSection(payload: ClozePayload): string {
  const answers = payload.blanks
    .map((blank) => `${blank.id}번 = ${blank.answer}`)
    .join(", ");
  return `## 문제 (빈칸 채우기)

본문: ${payload.text}

정답: ${answers}
오답 후보(distractors): ${payload.distractors.join(", ")}`;
}

export function buildNoteExtractPrompt(
  type: QuestionType,
  payload: McqPayload | ClozePayload,
  explanation: string | null,
  currentNote: string,
  resultPath: string,
): string {
  const questionSection =
    type === "MCQ"
      ? mcqSection(payload as McqPayload)
      : clozeSection(payload as ClozePayload);
  const explanationText = explanation?.trim() || "(해설 없음)";
  const noteText = currentNote.trim() || "(아직 노트가 비어 있습니다)";

  return `당신은 자격증 학습 노트 작성을 돕는 전문가입니다. 아래 문제에서 시험 대비에 가치 있는 핵심 내용을 뽑아, 사용자의 기존 노트에 덧붙일 항목만 작성하세요.

${questionSection}

## 해설

${explanationText}

## 사용자의 현재 노트

\`\`\`markdown
${noteText}
\`\`\`

## 추출 규칙 (반드시 준수)

- 서비스 간 관계, 서비스의 핵심 기능, 선택 기준처럼 다음에 비슷한 문제를 만났을 때 도움이 될 내용만 뽑으세요.
- 현재 노트에 이미 있는 내용은 절대 다시 추출하지 마세요. 표현만 다른 같은 내용도 중복으로 봅니다.
- 이 문제에만 해당하는 지엽적인 사실(문항 번호, 특정 수치 예시 등)은 넣지 마세요.
- 문제와 해설에 근거한 내용만 쓰고, 근거 없는 새로운 사실을 지어내지 마세요.
- 마크다운 목록(\`- \`) 형태로, 항목당 한 줄로 간결하게 쓰세요. 필요하면 \`## 소제목\`으로 묶어도 됩니다.
- 한국어로 쓰고, 서비스명 등 고유명사는 원문 표기 그대로 두세요.
- 기존 노트에 없는 새로운 항목이 하나도 없다면, note에 빈 문자열("")을 넣으세요.

## 출력 형식

다른 설명 없이 아래 구조의 JSON만 작성하세요.

{
  "note": "- 추출한 항목\\n- 또 다른 항목"
}

새로 추가할 내용이 없을 때:

{
  "note": ""
}

## 결과 저장 (반드시 준수)

- 결과 JSON을 stdout에 출력하지 마세요.
- 결과 JSON은 다음 경로에 UTF-8 텍스트 파일로만 저장하세요: ${resultPath}
- 파일 내용은 위 출력 형식의 JSON만 포함해야 하며, 코드 펜스나 설명 문장을 추가하지 마세요.
`;
}
```

- [ ] **Step 4: 테스트를 실행해 통과를 확인한다**

Run: `npx vitest run src/core/note-extract-prompt.test.ts`
Expected: PASS — 1 file, 9 tests

- [ ] **Step 5: 타입·린트를 확인한다**

Run: `npx tsc --noEmit`
Expected: 출력 없음

Run: `npx eslint src/core/note-extract-prompt.ts src/core/note-extract-prompt.test.ts`
Expected: 출력 없음

- [ ] **Step 6: 커밋**

```bash
git add src/core/note-extract-prompt.ts src/core/note-extract-prompt.test.ts
git commit -m "feat: 문제 핵심 내용 추출 프롬프트 빌더 추가"
```

---

### Task 3: 추출 서비스와 API 라우트

문제를 조회하고 해당 주제의 노트를 읽어 프롬프트를 만든 뒤 엔진을 동기 호출한다. explain 서비스와 같은 구조지만 **캐시하지 않는다** (기존 노트가 계속 바뀌므로 매번 새로 추출).

**Files:**
- Create: `src/server/note-extract-service.ts`
- Create: `src/app/api/questions/[id]/note-extract/route.ts`
- Modify: `src/lib/api-types.ts` (파일 끝에 추가)

**Interfaces:**
- Consumes:
  - `buildNoteExtractPrompt(type, payload, explanation, currentNote, resultPath)` (Task 2)
  - `parseNoteTidyResult(rawText, { allowEmpty: true })` (Task 1)
  - 기존: `runEngine(engine, prompt, dir)` from `@/server/generation/run-engine`,
    `extractJsonObject(text)` from `@/core/json-extract`,
    `ServiceError(code, message, status)` from `@/server/errors`,
    `jsonOk`, `handleApiError`, `parseBody`, `parseIdParam` from `@/server/http`
- Produces:
  - `extractNoteFromQuestion(questionId: number, engine: GenerationEngine): Promise<NoteExtractDto>`
  - `NoteExtractDto = { engine: GenerationEngineDto; extracted: string }`
  - `POST /api/questions/[id]/note-extract`

- [ ] **Step 1: DTO를 추가한다**

`src/lib/api-types.ts` 맨 끝에 추가:

```typescript
export interface NoteExtractDto {
  engine: GenerationEngineDto;
  /** 기존 노트에 없는 새 항목만 담긴 마크다운. 새 내용이 없으면 빈 문자열. */
  extracted: string;
}
```

- [ ] **Step 2: 서비스를 작성한다**

`src/server/note-extract-service.ts` 생성:

```typescript
import path from "node:path";
import type { GenerationEngine } from "@prisma/client";
import { extractJsonObject } from "@/core/json-extract";
import { buildNoteExtractPrompt } from "@/core/note-extract-prompt";
import { parseNoteTidyResult } from "@/core/note-tidy-result";
import type { ClozePayload, McqPayload } from "@/core/types";
import type { NoteExtractDto } from "@/lib/api-types";
import { prisma } from "./db";
import { ServiceError } from "./errors";
import { runEngine } from "./generation/run-engine";

export async function extractNoteFromQuestion(
  questionId: number,
  engine: GenerationEngine,
): Promise<NoteExtractDto> {
  const question = await prisma.question.findUnique({
    where: { id: questionId },
  });
  if (!question) {
    throw new ServiceError("NOT_FOUND", "문제를 찾을 수 없습니다", 404);
  }

  const note = await prisma.topicNote.findUnique({
    where: { topicId: question.topicId },
  });

  const dir = path.resolve(
    "generation_output",
    "note-extracts",
    `${questionId}-${engine.toLowerCase()}`,
  );
  const prompt = buildNoteExtractPrompt(
    question.type,
    question.payload as unknown as McqPayload | ClozePayload,
    question.explanation,
    note?.content ?? "",
    path.join(dir, "result.json"),
  );

  const run = await runEngine(engine, prompt, dir);
  if (!run.ok) {
    throw new ServiceError("NOTE_EXTRACT_FAILED", run.failureReason, 502);
  }

  const parsed = parseNoteTidyResult(extractJsonObject(run.resultText), {
    allowEmpty: true,
  });
  if (!parsed.ok) {
    throw new ServiceError("NOTE_EXTRACT_PARSE_ERROR", parsed.fatal, 502);
  }

  return { engine, extracted: parsed.note };
}
```

- [ ] **Step 3: 라우트를 작성한다**

`src/app/api/questions/[id]/note-extract/route.ts` 생성:

```typescript
import { z } from "zod";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";
import { extractNoteFromQuestion } from "@/server/note-extract-service";

const bodySchema = z.object({
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { engine } = await parseBody(req, bodySchema);
    return jsonOk(await extractNoteFromQuestion(parseIdParam(id), engine));
  } catch (e) {
    return handleApiError(e);
  }
}
```

- [ ] **Step 4: 타입·린트를 확인한다**

Run: `npx tsc --noEmit`
Expected: 출력 없음

Run: `npx eslint src/server/note-extract-service.ts "src/app/api/questions/[id]/note-extract/route.ts" src/lib/api-types.ts`
Expected: 출력 없음

Run: `npx vitest run`
Expected: PASS (회귀 없음)

- [ ] **Step 5: curl로 수동 검증한다**

개발 서버를 띄운다 (이미 떠 있으면 생략):

```powershell
npm run dev
```

인증 쿠키를 얻는다 (`$env:APP_PASSWORD`는 `.env`의 값 — 화면에 출력하지 말 것):

```powershell
curl.exe -s -c cookies.txt -X POST http://localhost:3000/api/auth/login `
  -H "Content-Type: application/json" `
  -d "{\"password\":\"$env:APP_PASSWORD\"}"
```

기존 문제 id 하나를 고른다 (topicId가 노트를 가진 주제면 중복 제외 동작까지 볼 수 있다):

```powershell
curl.exe -s -b cookies.txt "http://localhost:3000/api/questions?page=1"
```

**검증 1 — 정상 추출 (약 40초 소요):**

```powershell
curl.exe -s -b cookies.txt -X POST http://localhost:3000/api/questions/1/note-extract `
  -H "Content-Type: application/json" -d "{\"engine\":\"CLAUDE\"}"
```

Expected: `{"engine":"CLAUDE","extracted":"- ..."}` — `extracted`가 마크다운 목록 문자열
(기존 노트에 이미 다 있는 내용이면 `"extracted":""`도 정상)

**검증 2 — 없는 문제 id:**

```powershell
curl.exe -s -b cookies.txt -X POST http://localhost:3000/api/questions/999999/note-extract `
  -H "Content-Type: application/json" -d "{\"engine\":\"CLAUDE\"}"
```

Expected: HTTP 404, `{"error":{"code":"NOT_FOUND","message":"문제를 찾을 수 없습니다"}}`

**검증 3 — 잘못된 engine:**

```powershell
curl.exe -s -b cookies.txt -X POST http://localhost:3000/api/questions/1/note-extract `
  -H "Content-Type: application/json" -d "{\"engine\":\"GPT\"}"
```

Expected: HTTP 400, `{"error":{"code":"VALIDATION",...}}`

검증이 끝나면 `cookies.txt`를 삭제한다: `Remove-Item cookies.txt`

- [ ] **Step 6: 커밋**

```bash
git add src/server/note-extract-service.ts "src/app/api/questions/[id]/note-extract/route.ts" src/lib/api-types.ts
git commit -m "feat: 문제 핵심 내용 추출 서비스와 API 라우트 추가"
```

---

### Task 4: NotePanel 추출 UI

`NotePanel`에 `questionId` prop을 추가하고, "✨ AI 추출" 버튼 → 로딩 → 초안 미리보기 → "노트에 추가"(append 저장) / "닫기"(폐기) 흐름을 구현한다.

**Files:**
- Modify: `src/lib/api-client.ts` (`notes` 섹션에 `extract` 추가)
- Modify: `src/components/NotePanel.tsx`
- Modify: `src/app/study/page.tsx:198-204`
- Test: `src/components/NotePanel.test.tsx` (테스트 추가 + 기존 렌더 헬퍼 수정)

**Interfaces:**
- Consumes: `NoteExtractDto` (Task 3), `POST /api/questions/[id]/note-extract` (Task 3)
- Produces:
  - `api.notes.extract(questionId: number, engine: GenerationEngineDto): Promise<NoteExtractDto>`
  - `<NotePanel topicId={number} questionId={number} onClose={() => void} />`

**동작 규칙 (구현 시 반드시 지킬 것):**
- 추출은 `mode === "view"`이고 정리 초안(`pendingDraft`)이 없을 때만 노출한다.
- 엔진 select는 기존 AI 정리와 공유한다 (별도 select를 만들지 않는다).
- 추출 버튼은 빈 노트에서도 활성이다 (AI 정리 버튼과 다르다).
- 추출 초안이 있으면 노트 본문 아래에 별도 블록으로 보여준다.
- "노트에 추가"는 기존 내용이 있으면 `기존\n\n추출`, 없으면 `추출`로 합쳐 `api.notes.save`를 호출한다.
- 저장 실패 시 추출 초안을 유지해 재시도할 수 있게 한다.
- `extracted`가 빈 문자열이면 초안 블록 대신 "추가할 새 내용이 없습니다" 안내를 보여준다.
- 기존 topic 변경 안전장치(`topicGenerationRef`)를 추출 흐름에도 동일하게 적용한다.

- [ ] **Step 1: api-client에 extract를 추가한다**

`src/lib/api-client.ts`의 import 목록에 `NoteExtractDto`를 추가한다 (알파벳 순서상 `KeywordSuggestionDto` 다음):

```typescript
  NoteExtractDto,
  NoteTidyJobDto,
```

`notes` 섹션의 `get` 앞에 추가한다:

```typescript
    extract: (questionId: number, engine: GenerationEngineDto) =>
      request<NoteExtractDto>(`/api/questions/${questionId}/note-extract`, {
        method: "POST",
        body: JSON.stringify({ engine }),
      }),
```

- [ ] **Step 2: 실패하는 테스트를 작성한다**

`src/components/NotePanel.test.tsx`를 수정한다.

(a) `notesApiMock`에 `extract`를 추가한다:

```typescript
const notesApiMock = vi.hoisted(() => ({
  applyTidy: vi.fn(),
  dismissTidy: vi.fn(),
  extract: vi.fn(),
  get: vi.fn(),
  save: vi.fn(),
  tidy: vi.fn(),
  tidyJob: vi.fn(),
}));
```

(b) `renderPanel` 헬퍼에 `questionId`를 넘긴다:

```typescript
async function renderPanel() {
  await act(async () => {
    render(<NotePanel topicId={3} questionId={42} onClose={vi.fn()} />);
  });
}
```

(c) 파일 안의 나머지 `render(<NotePanel topicId={3} onClose={vi.fn()} />)`와
`rerender(<NotePanel topicId={4} onClose={vi.fn()} />)` 호출에도 모두
`questionId={42}`(topicId 4인 경우 `questionId={43}`)를 추가한다.
해당 위치: "이전 topic의 늦은 polling 응답..." 테스트, "topic 변경 시 이전 UI와 draft를..." 테스트.

(d) 파일 맨 아래 `describe("NotePanel", ...)` 블록 안에 아래 테스트 4개를 추가한다:

```typescript
  it("AI 추출 결과를 미리보기로 보여주고 노트 끝에 덧붙여 저장한다", async () => {
    notesApiMock.get.mockResolvedValue(note("## 기존\n\n- 이미 아는 것"));
    notesApiMock.extract.mockResolvedValue({
      engine: "CLAUDE",
      extracted: "- S3는 객체 스토리지",
    });
    notesApiMock.save.mockImplementation((_topicId: number, content: string) =>
      Promise.resolve(note(content)),
    );
    await renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "AI 추출" }));
    });

    expect(notesApiMock.extract).toHaveBeenCalledWith(42, "CLAUDE");
    expect(screen.getByText("S3는 객체 스토리지")).toBeVisible();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "노트에 추가" }));
    });

    expect(notesApiMock.save).toHaveBeenCalledWith(
      3,
      "## 기존\n\n- 이미 아는 것\n\n- S3는 객체 스토리지",
    );
    expect(screen.getByText("노트에 추가했습니다 ✅")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "노트에 추가" }),
    ).not.toBeInTheDocument();
  });

  it("빈 노트에서는 추출 결과를 그대로 저장한다", async () => {
    notesApiMock.get.mockResolvedValue(note());
    notesApiMock.extract.mockResolvedValue({
      engine: "CLAUDE",
      extracted: "- 첫 항목",
    });
    notesApiMock.save.mockImplementation((_topicId: number, content: string) =>
      Promise.resolve(note(content)),
    );
    await renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "AI 추출" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "노트에 추가" }));
    });

    expect(notesApiMock.save).toHaveBeenCalledWith(3, "- 첫 항목");
  });

  it("추출할 새 내용이 없으면 안내만 보여준다", async () => {
    notesApiMock.get.mockResolvedValue(note("## 기존\n\n- 이미 아는 것"));
    notesApiMock.extract.mockResolvedValue({
      engine: "CLAUDE",
      extracted: "",
    });
    await renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "AI 추출" }));
    });

    expect(screen.getByRole("status")).toHaveTextContent(
      "추가할 새 내용이 없습니다",
    );
    expect(
      screen.queryByRole("button", { name: "노트에 추가" }),
    ).not.toBeInTheDocument();
  });

  it("추출 저장에 실패하면 오류를 알리고 초안을 유지한다", async () => {
    notesApiMock.get.mockResolvedValue(note("기존 내용"));
    notesApiMock.extract.mockResolvedValue({
      engine: "CLAUDE",
      extracted: "- 지켜야 할 초안",
    });
    notesApiMock.save.mockRejectedValue(new Error("저장 서버 오류"));
    await renderPanel();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "AI 추출" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "노트에 추가" }));
    });

    expect(screen.getByRole("alert")).toHaveTextContent("저장 서버 오류");
    expect(screen.getByText("지켜야 할 초안")).toBeVisible();
    expect(screen.getByRole("button", { name: "노트에 추가" })).toBeEnabled();
  });
```

- [ ] **Step 3: 테스트를 실행해 실패를 확인한다**

Run: `npx vitest run src/components/NotePanel.test.tsx`
Expected: FAIL — 신규 4개가 `Unable to find an accessible element with the role "button" and name "AI 추출"`로 실패.
(TypeScript는 아직 `questionId` prop을 모르므로 `npx tsc --noEmit`도 에러를 낸다 — 정상.)

- [ ] **Step 4: NotePanel을 구현한다**

`src/components/NotePanel.tsx`를 아래와 같이 수정한다.

(a) import에 `NoteExtractDto`를 추가:

```typescript
import type {
  GenerationEngineDto,
  NoteExtractDto,
  NoteTidyJobDto,
  TopicNoteDto,
} from "@/lib/api-types";
```

(b) props 인터페이스:

```typescript
interface NotePanelProps {
  topicId: number;
  questionId: number;
  onClose: () => void;
}
```

(c) `NotePanelContent` 시그니처와 상태 추가 (`comparing` 선언 바로 아래):

```typescript
function NotePanelContent({ topicId, questionId, onClose }: NotePanelProps) {
```

```typescript
  const [extracting, setExtracting] = useState(false);
  const [extractResult, setExtractResult] = useState<NoteExtractDto | null>(
    null,
  );
  const [appending, setAppending] = useState(false);
```

(d) `dismissTidy` 함수 다음에 추출 핸들러 2개를 추가:

```typescript
  async function runExtract() {
    const topicGeneration = topicGenerationRef.current;
    setExtracting(true);
    setError("");
    setFeedback("");
    setExtractResult(null);
    try {
      const result = await api.notes.extract(questionId, engine);
      if (topicGenerationRef.current !== topicGeneration) return;
      setExtractResult(result);
    } catch (extractError) {
      if (topicGenerationRef.current !== topicGeneration) return;
      setError(errorMessage(extractError, "AI 추출에 실패했습니다"));
    } finally {
      if (topicGenerationRef.current === topicGeneration) {
        setExtracting(false);
      }
    }
  }

  async function appendExtract() {
    if (!note || !extractResult || extractResult.extracted.length === 0) return;
    const topicGeneration = topicGenerationRef.current;
    const base = note.content.trimEnd();
    const merged = base
      ? `${base}\n\n${extractResult.extracted}`
      : extractResult.extracted;
    setAppending(true);
    setError("");
    try {
      const saved = await api.notes.save(topicId, merged);
      if (topicGenerationRef.current !== topicGeneration) return;
      setNote(saved);
      setExtractResult(null);
      setFeedback("노트에 추가했습니다 ✅");
    } catch (appendError) {
      if (topicGenerationRef.current !== topicGeneration) return;
      setError(errorMessage(appendError, "노트 추가에 실패했습니다"));
    } finally {
      if (topicGenerationRef.current === topicGeneration) {
        setAppending(false);
      }
    }
  }
```

(e) view 모드 버튼 영역: `AI 정리` 버튼 바로 뒤(같은 `<>` 프래그먼트 안, `</>` 앞)에 추출 버튼을 추가:

```typescript
                    <button
                      type="button"
                      onClick={() => void runExtract()}
                      disabled={extracting}
                      className="btn btn-secondary text-sm"
                    >
                      {extracting ? (
                        "AI 추출 중..."
                      ) : (
                        <>
                          <span aria-hidden="true">✨ </span>
                          AI 추출
                        </>
                      )}
                    </button>
```

(f) view 모드 블록의 닫는 `</>` 직전(버튼 `div` 다음)에 추출 결과 블록을 추가:

```typescript
              {extractResult !== null && extractResult.extracted.length === 0 && (
                <p role="status" aria-live="polite" className="muted text-sm">
                  추가할 새 내용이 없습니다. 이미 노트에 정리되어 있어요.
                </p>
              )}
              {extractResult !== null && extractResult.extracted.length > 0 && (
                <div className="grid gap-2 border-t border-[color:var(--border)] pt-3">
                  <span role="status" aria-live="polite" className="chip justify-self-start">
                    ✨ 추출 초안
                  </span>
                  <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--bg-soft)] p-3">
                    <Markdown content={extractResult.extracted} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => void appendExtract()}
                      disabled={appending}
                      className="btn btn-primary text-sm"
                    >
                      {appending ? "추가 중..." : "노트에 추가"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setExtractResult(null)}
                      disabled={appending}
                      className="btn btn-secondary text-sm"
                    >
                      닫기
                    </button>
                  </div>
                </div>
              )}
```

주의: `Markdown` 컴포넌트는 빈 문자열일 때 "아직 노트가 없습니다" 안내를 내므로, 위처럼
`extracted.length > 0`인 경우에만 렌더해야 한다.

(g) 편집 모드로 들어갈 때 추출 초안을 정리한다 — `startEdit` 안에 한 줄 추가:

```typescript
  function startEdit() {
    if (!note) return;
    setDraft(note.content);
    setMode("edit");
    setFeedback("");
    setError("");
    setExtractResult(null);
  }
```

- [ ] **Step 5: study 화면에서 questionId를 넘긴다**

`src/app/study/page.tsx`의 `NotePanel` 사용부를 수정한다:

```typescript
      {noteOpen && current && (
        <NotePanel
          key={current.topicId}
          topicId={current.topicId}
          questionId={current.id}
          onClose={() => setNoteOpen(false)}
        />
      )}
```

- [ ] **Step 6: 테스트를 실행해 통과를 확인한다**

Run: `npx vitest run src/components/NotePanel.test.tsx`
Expected: PASS — 1 file, 14 tests (기존 10 + 신규 4)

Run: `npx vitest run`
Expected: PASS (전체)

Run: `npx tsc --noEmit`
Expected: 출력 없음

Run: `npm run lint`
Expected: 통과

- [ ] **Step 7: 브라우저에서 수동 검증한다**

`npm run dev`로 서버를 띄우고 로그인한 뒤 `/study?mode=practice&topicId=<노트가 있는 주제>`로 이동한다.

1. 헤더의 `📝 노트` 버튼을 눌러 패널을 연다.
2. `✨ AI 추출` 버튼이 보이고, **빈 노트에서도 활성**인지 확인한다.
3. 클릭 → `AI 추출 중...`으로 바뀌고 버튼이 비활성인지 확인한다 (약 40초 소요).
4. 초안이 `✨ 추출 초안` 블록에 마크다운으로 렌더링되는지 확인한다.
5. `노트에 추가` → 노트 본문 끝에 항목이 붙고 `노트에 추가했습니다 ✅`가 뜨는지 확인한다.
6. 다시 추출 → `닫기`로 폐기하면 노트가 그대로인지 확인한다.
7. 이미 정리된 주제에서 추출해 `추가할 새 내용이 없습니다` 안내가 나오는 경우도 확인한다 (재현이 안 되면 미검증으로 보고).
8. 375×812와 1280×720에서 가로 스크롤이 없는지, 콘솔 에러가 0인지 확인한다.

- [ ] **Step 8: 커밋**

```bash
git add src/lib/api-client.ts src/components/NotePanel.tsx src/components/NotePanel.test.tsx src/app/study/page.tsx
git commit -m "feat: 노트 패널에 문제 핵심 내용 AI 추출 UI 추가"
```

---

## 완료 조건

- `npx vitest run` 전체 통과
- `npx tsc --noEmit` 에러 0
- `npm run lint` 통과
- 브라우저에서 추출 → 미리보기 → 노트 추가 흐름이 실제 엔진 호출로 동작
- 커밋 4개 (태스크당 1개)
