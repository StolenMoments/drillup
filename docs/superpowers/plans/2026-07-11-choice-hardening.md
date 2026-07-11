# 선지 난이도 올리기 (Choice Hardening) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 학습 화면 채점 후 결과 패널에서 AI 엔진을 호출해 MCQ 오답 선지를 더 어려운 오답으로 교체한 미리보기를 받고, 사용자가 승인하면 문제에 적용한다.

**Architecture:** 기존 AI 해설(explain) 기능과 동일한 패턴 — ResultPanel 엔진 버튼 → API 라우트 → 서비스가 프롬프트 빌드 후 `runEngine`으로 CLI 엔진 실행 → 결과 JSON을 core의 순수 함수로 파싱·기계 검증 → 미리보기 반환(DB 저장 없음). 적용은 기존 `PATCH /api/questions/[id]` 재사용. `updateQuestion`은 payload 변경 시 캐시된 AI 해설을 삭제하도록 개선.

**Tech Stack:** Next.js 16 (App Router), TypeScript, Prisma 7, zod 4, vitest 4.

**Spec:** `docs/superpowers/specs/2026-07-11-choice-hardening-design.md`

## Global Constraints

- `master` 브랜치에서 직접 작업한다. feature branch / worktree를 만들지 않는다.
- 커밋 메시지는 한국어, conventional-commit 타입 접두사는 영어(`feat:`, `fix:`, `test:` 등). 태스크당 커밋 1개.
- 사용자 대상 UI 문구에는 가벼운 이모지를 유지한다 (✅/❌/🎉/🎯 등).
- 이 프로젝트의 Next.js는 훈련 데이터와 다를 수 있다. 라우트/컴포넌트 작성 전 `node_modules/next/dist/docs/`의 해당 가이드를 확인하되, 이 계획의 코드는 기존 코드베이스 패턴(예: `src/app/api/questions/[id]/explain/route.ts`)을 그대로 따르므로 그 패턴을 우선한다.
- 테스트 실행: `npm test` (vitest run). 린트: `npm run lint`.
- 엔진 출력 JSON은 stdout이 아닌 result 파일로 저장시키는 것이 이 코드베이스의 관례다 (프롬프트의 "결과 저장" 섹션).
- zod의 `z.string().trim()`은 검증이 아니라 **변환**(트림)이다. 파싱 결과 문자열은 트림된 상태이므로 원본과 비교할 때 원본 쪽에 `.trim()`을 적용해 비교한다.

---

### Task 1: `parseHardenJson` — 엔진 출력 파싱 + 기계 검증 (core)

**Files:**
- Create: `src/core/harden-schema.ts`
- Test: `src/core/harden-schema.test.ts`

**Interfaces:**
- Consumes: `mcqPayloadSchema` (`src/core/import-schema.ts`), `mcqAnswerIndices`, `McqPayload` (`src/core/types.ts`)
- Produces: `parseHardenJson(rawText: string, original: McqPayload): HardenParseResult` — Task 4의 서비스가 사용. `HardenParseResult`는 `{ ok: true; comment: string; payload: McqPayload }` 또는 `{ ok: false; fatal: string }` (기존 `revision-schema.ts` 관례와 동일한 형태).

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/harden-schema.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import type { McqPayload } from "./types";
import { parseHardenJson } from "./harden-schema";

const original: McqPayload = {
  question: "S3 버킷을 퍼블릭 접근으로부터 보호하는 가장 좋은 방법은?",
  choices: ["퍼블릭 액세스 차단 활성화", "오답 A", "오답 B", "오답 C"],
  answer_indices: [0],
  choice_explanations: ["근거 1", "근거 2", "근거 3", "근거 4"],
};

function revisedJson(overrides: Record<string, unknown> = {}, comment = "오답을 교체했습니다"): string {
  return JSON.stringify({
    comment,
    revised: {
      question: original.question,
      choices: ["퍼블릭 액세스 차단 활성화", "버킷 정책으로 s3:GetObject를 모든 주체에 허용", "오답 B", "오답 C"],
      answer_indices: [0],
      choice_explanations: ["근거 1", "새 근거 2", "근거 3", "근거 4"],
      ...overrides,
    },
  });
}

describe("parseHardenJson", () => {
  it("정답과 구조가 유지된 수정본을 통과시킨다", () => {
    const result = parseHardenJson(revisedJson(), original);
    expect(result).toMatchObject({ ok: true, comment: "오답을 교체했습니다" });
    if (result.ok) {
      expect(result.payload.choices[1]).toBe("버킷 정책으로 s3:GetObject를 모든 주체에 허용");
    }
  });

  it("JSON이 아니면 실패한다", () => {
    expect(parseHardenJson("not json", original)).toEqual({
      ok: false,
      fatal: "올바른 JSON이 아닙니다",
    });
  });

  it("comment가 없으면 실패한다", () => {
    const raw = JSON.parse(revisedJson()) as Record<string, unknown>;
    delete raw.comment;
    expect(parseHardenJson(JSON.stringify(raw), original)).toEqual({
      ok: false,
      fatal: "comment와 revised가 필요합니다",
    });
  });

  it("revised가 MCQ payload 형식이 아니면 실패한다", () => {
    expect(
      parseHardenJson(JSON.stringify({ comment: "c", revised: { question: "q" } }), original),
    ).toEqual({ ok: false, fatal: "revised가 MCQ payload 형식에 맞지 않습니다" });
  });

  it("answer_indices나 choice_explanations가 없으면 실패한다", () => {
    // answer_index(레거시)만 있으면 mcqPayloadSchema는 통과하지만 이 기능에서는 거부한다
    const raw = JSON.parse(revisedJson()) as { revised: Record<string, unknown> };
    delete raw.revised.answer_indices;
    raw.revised.answer_index = 0;
    expect(parseHardenJson(JSON.stringify(raw), original)).toEqual({
      ok: false,
      fatal: "revised에는 answer_indices와 choice_explanations가 필요합니다",
    });
  });

  it("질문 텍스트가 바뀌면 실패한다", () => {
    expect(
      parseHardenJson(revisedJson({ question: "다른 질문?" }), original),
    ).toEqual({ ok: false, fatal: "질문 텍스트가 변경되었습니다" });
  });

  it("선지 개수가 바뀌면 실패한다", () => {
    expect(
      parseHardenJson(
        revisedJson({
          choices: ["퍼블릭 액세스 차단 활성화", "새 오답 1", "새 오답 2", "오답 C", "오답 D"],
          choice_explanations: ["1", "2", "3", "4", "5"],
        }),
        original,
      ),
    ).toEqual({ ok: false, fatal: "선지 개수가 변경되었습니다" });
  });

  it("answer_indices가 바뀌면 실패한다", () => {
    expect(
      parseHardenJson(revisedJson({ answer_indices: [1] }), original),
    ).toEqual({ ok: false, fatal: "answer_indices가 변경되었습니다" });
  });

  it("정답 선지 텍스트가 바뀌면 실패한다", () => {
    expect(
      parseHardenJson(
        revisedJson({
          choices: ["퍼블릭 액세스 차단을 켠다", "새 오답 1", "오답 B", "오답 C"],
        }),
        original,
      ),
    ).toEqual({ ok: false, fatal: "정답 선지가 변경되었습니다" });
  });

  it("오답 선지가 하나도 바뀌지 않으면 실패한다", () => {
    expect(
      parseHardenJson(
        revisedJson({ choices: [...original.choices] }),
        original,
      ),
    ).toEqual({ ok: false, fatal: "오답 선지가 하나도 변경되지 않았습니다" });
  });

  it("레거시 answer_index 원본도 처리한다", () => {
    const legacy: McqPayload = {
      question: original.question,
      choices: [...original.choices],
      answer_index: 0,
    };
    expect(parseHardenJson(revisedJson(), legacy)).toMatchObject({ ok: true });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test -- src/core/harden-schema.test.ts`
Expected: FAIL — `harden-schema` 모듈이 없어 import 에러.

- [ ] **Step 3: 최소 구현 작성**

`src/core/harden-schema.ts`:

```typescript
import { z } from "zod";
import { mcqPayloadSchema } from "./import-schema";
import { mcqAnswerIndices, type McqPayload } from "./types";

const hardenSchema = z.object({
  comment: z.string().trim().min(1),
  revised: z.unknown(),
});

export type HardenParseResult =
  | { ok: true; comment: string; payload: McqPayload }
  | { ok: false; fatal: string };

function sameIndexSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((value, i) => value === sortedB[i]);
}

export function parseHardenJson(
  rawText: string,
  original: McqPayload,
): HardenParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return { ok: false, fatal: "올바른 JSON이 아닙니다" };
  }
  const outer = hardenSchema.safeParse(raw);
  if (!outer.success) {
    return { ok: false, fatal: "comment와 revised가 필요합니다" };
  }
  const revised = mcqPayloadSchema.safeParse(outer.data.revised);
  if (!revised.success) {
    return { ok: false, fatal: "revised가 MCQ payload 형식에 맞지 않습니다" };
  }
  const payload = revised.data;
  if (!payload.answer_indices || !payload.choice_explanations) {
    return {
      ok: false,
      fatal: "revised에는 answer_indices와 choice_explanations가 필요합니다",
    };
  }
  if (payload.question !== original.question.trim()) {
    return { ok: false, fatal: "질문 텍스트가 변경되었습니다" };
  }
  if (payload.choices.length !== original.choices.length) {
    return { ok: false, fatal: "선지 개수가 변경되었습니다" };
  }
  const answerIndices = mcqAnswerIndices(original);
  if (!sameIndexSet(payload.answer_indices, answerIndices)) {
    return { ok: false, fatal: "answer_indices가 변경되었습니다" };
  }
  const correctChanged = answerIndices.some(
    (index) => payload.choices[index] !== original.choices[index].trim(),
  );
  if (correctChanged) {
    return { ok: false, fatal: "정답 선지가 변경되었습니다" };
  }
  const distractorChanged = payload.choices.some(
    (choice, index) =>
      !answerIndices.includes(index) &&
      choice !== original.choices[index].trim(),
  );
  if (!distractorChanged) {
    return { ok: false, fatal: "오답 선지가 하나도 변경되지 않았습니다" };
  }
  return { ok: true, comment: outer.data.comment, payload };
}
```

참고: 선지 중복 금지, `choice_explanations` 개수 = 선지 개수, 4~6개 범위는 `mcqPayloadSchema`(`refineMcq`)가 이미 검증하므로 여기서 반복하지 않는다 (DRY).

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- src/core/harden-schema.test.ts`
Expected: PASS (11 tests)

- [ ] **Step 5: 전체 테스트 + 커밋**

Run: `npm test`
Expected: 전체 PASS

```bash
git add src/core/harden-schema.ts src/core/harden-schema.test.ts
git commit -m "feat: 선지 강화 결과 파싱 및 정답 불변 검증 추가"
```

---

### Task 2: `buildChoiceHardeningPrompt` — 프롬프트 빌더

**Files:**
- Modify: `src/core/prompt-template.ts` (파일 끝에 함수 추가)
- Test: `src/core/prompt-template.test.ts` (describe 블록 추가)

**Interfaces:**
- Consumes: 같은 파일의 `EXAM_MCQ_RULES`, `webVerificationSection`, `mcqAnswerIndices`, `McqPayload` (이미 import되어 있음)
- Produces: `buildChoiceHardeningPrompt(topicName: string, payload: McqPayload, resultPath: string): string` — Task 4의 서비스가 사용

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/prompt-template.test.ts`에 아래 describe 블록을 추가 (기존 import에 `buildChoiceHardeningPrompt` 추가):

```typescript
describe("buildChoiceHardeningPrompt", () => {
  const payload = {
    question: "S3 버킷 보호 방법은?",
    choices: ["정답 선지", "쉬운 오답 1", "쉬운 오답 2", "쉬운 오답 3"],
    answer_indices: [0],
  };

  it("불변 조건과 원본 문제를 포함한다", () => {
    const prompt = buildChoiceHardeningPrompt(
      "AWS SAA",
      payload,
      "C:\\out\\result.json",
    );
    expect(prompt).toContain("불변 조건");
    expect(prompt).toContain("S3 버킷 보호 방법은?");
    expect(prompt).toContain("정답 선지");
    expect(prompt).toContain("오답 선지만");
    expect(prompt).toContain("C:\\out\\result.json");
  });

  it("레거시 answer_index를 answer_indices로 정규화해 보여준다", () => {
    const prompt = buildChoiceHardeningPrompt(
      "AWS SAA",
      { question: "q?", choices: ["a", "b", "c", "d"], answer_index: 2 },
      "/tmp/result.json",
    );
    expect(prompt).toContain('"answer_indices": [\n    2\n  ]');
  });

  it("시험 스타일 오답 규칙을 재사용한다", () => {
    const prompt = buildChoiceHardeningPrompt("AWS SAA", payload, "/tmp/r.json");
    expect(prompt).toContain("Mandatory exam-style MCQ contract");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test -- src/core/prompt-template.test.ts`
Expected: FAIL — `buildChoiceHardeningPrompt` export가 없음.

- [ ] **Step 3: 구현 작성**

`src/core/prompt-template.ts` 파일 끝에 추가:

```typescript
export function buildChoiceHardeningPrompt(
  topicName: string,
  payload: McqPayload,
  resultPath: string,
): string {
  const target = {
    question: payload.question,
    choices: payload.choices,
    answer_indices: mcqAnswerIndices(payload),
  };
  return `당신은 학습 문제 개선 전문가입니다. 주제 "${topicName}"의 아래 객관식 문제는 오답 선지가 너무 쉬워 정답이 쉽게 드러납니다. 오답 선지만 더 어려운 오답으로 교체하세요.

${webVerificationSection("선지를 교체하기 전에")}## 대상 문제

\`\`\`json
${JSON.stringify(target, null, 2)}
\`\`\`

## 불변 조건 (반드시 준수)

- question 텍스트를 한 글자도 바꾸지 마세요.
- answer_indices 값과 그 위치의 정답 선지 텍스트를 한 글자도 바꾸지 마세요.
- 선지 개수를 바꾸지 마세요.
- 오답 선지만 교체할 수 있으며, 최소 1개는 반드시 교체하세요.
${EXAM_MCQ_RULES}
## 출력 형식

다른 설명 없이 아래 구조의 JSON만 작성하세요.

{
  "comment": "어떤 오답을 왜 교체했는지 간결한 한국어 설명",
  "revised": {
    "question": "원본과 동일한 질문",
    "choices": ["교체 반영된 전체 선지 배열"],
    "answer_indices": [0],
    "choice_explanations": ["선지별 판단 근거 (선지 수와 동일한 개수)"]
  }
}

## 결과 저장 (반드시 준수)

- 결과 JSON을 stdout에 출력하지 마세요.
- 결과 JSON은 다음 경로에 UTF-8 텍스트 파일로만 저장하세요: ${resultPath}
- 파일 내용은 위 출력 형식의 JSON만 포함해야 하며, 코드 펜스나 설명 문장을 추가하지 마세요.
`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- src/core/prompt-template.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/core/prompt-template.ts src/core/prompt-template.test.ts
git commit -m "feat: 선지 난이도 강화 프롬프트 빌더 추가"
```

---

### Task 3: `updateQuestion` — payload 변경 시 해설 캐시 무효화

**Files:**
- Modify: `src/server/question-service.ts:145-176` (`updateQuestion`)
- Test: `src/server/question-service.test.ts`

**Interfaces:**
- Consumes: `prisma.$transaction`, `prisma.answerExplanation.deleteMany` (Prisma 모델 `AnswerExplanation`은 이미 존재 — explanation-service가 사용 중)
- Produces: `updateQuestion` 시그니처는 변경 없음. 동작만 추가: payload 갱신 시 해당 문제의 `AnswerExplanation` 행 전체 삭제.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/server/question-service.test.ts`의 `prismaMock`(4-11행)에 `answerExplanation`과 `$transaction`을 추가:

```typescript
const prismaMock = vi.hoisted(() => ({
  question: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  answerExplanation: {
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(async (operations: Promise<unknown>[]) =>
    Promise.all(operations),
  ),
}));
```

describe 블록 안에 테스트 추가 (기존 "validates edited payload..." 테스트 뒤):

```typescript
it("payload 갱신 시 캐시된 AI 해설을 삭제한다", async () => {
    prismaMock.question.findUnique.mockResolvedValue({
      id: 1,
      topicId: 1,
      type: "MCQ",
      payload: {
        question: "Question?",
        choices: ["A", "B", "C", "D"],
        answer_index: 0,
      },
      explanation: null,
    });
    prismaMock.question.update.mockResolvedValue({
      id: 1,
      topicId: 1,
      type: "MCQ",
      payload: {
        question: "Question?",
        choices: ["A", "B2", "C", "D"],
        answer_index: 0,
      },
      explanation: null,
      keywords: [],
    });

    const result = await updateQuestion(1, {
      payload: {
        question: "Question?",
        choices: ["A", "B2", "C", "D"],
        answer_index: 0,
      },
      explanation: null,
    });

    expect(prismaMock.answerExplanation.deleteMany).toHaveBeenCalledWith({
      where: { questionId: 1 },
    });
    expect(result).toMatchObject({ id: 1 });
  });
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npm test -- src/server/question-service.test.ts`
Expected: 새 테스트 FAIL — `deleteMany`가 호출되지 않음. (기존 테스트는 계속 PASS)

- [ ] **Step 3: 구현 수정**

`src/server/question-service.ts`의 `updateQuestion` 끝부분(167-175행)을 다음으로 교체:

```typescript
  const [, q] = await prisma.$transaction([
    prisma.answerExplanation.deleteMany({ where: { questionId: id } }),
    prisma.question.update({
      where: { id },
      data: {
        payload: parsed.data as Prisma.InputJsonValue,
        explanation: input.explanation,
      },
      include: KEYWORDS_INCLUDE,
    }),
  ]);
  return toDetailDto(q);
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npm test -- src/server/question-service.test.ts`
Expected: 전체 PASS

- [ ] **Step 5: 전체 테스트 + 커밋**

Run: `npm test`
Expected: 전체 PASS

```bash
git add src/server/question-service.ts src/server/question-service.test.ts
git commit -m "fix: 문제 payload 수정 시 캐시된 AI 해설 무효화"
```

---

### Task 4: 서비스 + API 라우트 + 클라이언트 타입

**Files:**
- Create: `src/server/choice-hardening-service.ts`
- Create: `src/app/api/questions/[id]/harden-choices/route.ts`
- Modify: `src/lib/api-types.ts` (DTO 추가)
- Modify: `src/lib/api-client.ts` (`api.questions`에 메서드 추가)

**Interfaces:**
- Consumes: Task 1의 `parseHardenJson`, Task 2의 `buildChoiceHardeningPrompt`, 기존 `runEngine(engine, prompt, dir)` (`src/server/generation/run-engine.ts`), `extractJsonObject` (`src/core/json-extract.ts`), `ServiceError` (`src/server/errors.ts`)
- Produces:
  - `hardenQuestionChoices(questionId: number, engine: GenerationEngine): Promise<HardenPreviewDto>`
  - `POST /api/questions/[id]/harden-choices` body `{ engine: "CLAUDE" | "CODEX" | "ANTIGRAVITY" }` → `HardenPreviewDto`
  - `api.questions.hardenChoices(id: number, engine: GenerationEngineDto): Promise<HardenPreviewDto>` — Task 5의 UI가 사용
  - `HardenPreviewDto { engine: GenerationEngineDto; comment: string; payload: HardenedMcqPayloadDto }`, `HardenedMcqPayloadDto { question: string; choices: string[]; answer_indices: number[]; choice_explanations: string[] }`

이 태스크는 CLI 엔진 실행을 감싸는 얇은 조립 코드로, 코드베이스 관례상 단위 테스트를 두지 않는다 (`explanation-service.ts`, `keyword-suggestion-service.ts`와 동일). 핵심 로직(파싱·검증·프롬프트)은 Task 1·2에서 테스트됨. 검증은 lint + 전체 테스트 + Task 5의 수동 스모크 테스트로 한다.

- [ ] **Step 1: 서비스 작성**

`src/server/choice-hardening-service.ts` (`keyword-suggestion-service.ts` 패턴):

```typescript
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { GenerationEngine } from "@prisma/client";
import { parseHardenJson } from "@/core/harden-schema";
import { extractJsonObject } from "@/core/json-extract";
import { buildChoiceHardeningPrompt } from "@/core/prompt-template";
import type { McqPayload } from "@/core/types";
import type { HardenPreviewDto } from "@/lib/api-types";
import { prisma } from "./db";
import { ServiceError } from "./errors";
import { runEngine } from "./generation/run-engine";

export async function hardenQuestionChoices(
  questionId: number,
  engine: GenerationEngine,
): Promise<HardenPreviewDto> {
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    include: { topic: { select: { name: true } } },
  });
  if (!question) {
    throw new ServiceError("NOT_FOUND", "문제를 찾을 수 없습니다", 404);
  }
  if (question.type !== "MCQ") {
    throw new ServiceError(
      "VALIDATION",
      "MCQ 문제만 선지 난이도를 올릴 수 있습니다",
      400,
    );
  }

  const original = question.payload as unknown as McqPayload;
  const dir = path.resolve(
    "generation_output",
    "harden",
    `${questionId}-${engine.toLowerCase()}-${randomUUID()}`,
  );
  const prompt = buildChoiceHardeningPrompt(
    question.topic.name,
    original,
    path.join(dir, "result.json"),
  );

  const run = await runEngine(engine, prompt, dir);
  if (!run.ok) {
    throw new ServiceError("HARDEN_FAILED", run.failureReason, 502);
  }

  const parsed = parseHardenJson(extractJsonObject(run.resultText), original);
  if (!parsed.ok) {
    throw new ServiceError("HARDEN_PARSE_ERROR", parsed.fatal, 502);
  }

  return {
    engine,
    comment: parsed.comment,
    payload: {
      question: parsed.payload.question,
      choices: parsed.payload.choices,
      answer_indices: parsed.payload.answer_indices ?? [],
      choice_explanations: parsed.payload.choice_explanations ?? [],
    },
  };
}
```

- [ ] **Step 2: API 라우트 작성**

`src/app/api/questions/[id]/harden-choices/route.ts` (explain 라우트와 동일 구조):

```typescript
import { z } from "zod";
import { hardenQuestionChoices } from "@/server/choice-hardening-service";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";

const bodySchema = z.object({
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { engine } = await parseBody(req, bodySchema);
    return jsonOk(await hardenQuestionChoices(parseIdParam(id), engine));
  } catch (e) {
    return handleApiError(e);
  }
}
```

- [ ] **Step 3: DTO 추가**

`src/lib/api-types.ts`의 `AnswerExplanationDto` 정의 근처(124행 부근)에 추가:

```typescript
export interface HardenedMcqPayloadDto {
  question: string;
  choices: string[];
  answer_indices: number[];
  choice_explanations: string[];
}

export interface HardenPreviewDto {
  engine: GenerationEngineDto;
  comment: string;
  payload: HardenedMcqPayloadDto;
}
```

- [ ] **Step 4: api-client 메서드 추가**

`src/lib/api-client.ts`의 `api.questions.explain` 아래에 추가하고, 상단 type import 목록에 `HardenPreviewDto`를 추가:

```typescript
    hardenChoices: (id: number, engine: GenerationEngineDto) =>
      request<HardenPreviewDto>(`/api/questions/${id}/harden-choices`, {
        method: "POST",
        body: JSON.stringify({ engine }),
      }),
```

- [ ] **Step 5: 린트 + 전체 테스트 + 커밋**

Run: `npm run lint && npm test`
Expected: 에러 없음, 전체 테스트 PASS

```bash
git add src/server/choice-hardening-service.ts "src/app/api/questions/[id]/harden-choices/route.ts" src/lib/api-types.ts src/lib/api-client.ts
git commit -m "feat: 선지 난이도 강화 API 및 서비스 추가"
```

---

### Task 5: ResultPanel UI — 미리보기 + 적용

**Files:**
- Modify: `src/components/ResultPanel.tsx`

**Interfaces:**
- Consumes: Task 4의 `api.questions.hardenChoices`, `HardenPreviewDto`, `HardenedMcqPayloadDto`; 기존 `api.questions.get`, `api.questions.update`
- Produces: UI만. 다른 코드가 의존하지 않음.

**동작 요약:**
- MCQ 문제일 때만 "🎯 선지 난이도 올리기" 섹션 노출 (AI 해설 섹션 아래).
- 상태 머신: `idle → loading → preview → (applying) → applied / error`. 미리보기 상태에서 다른 엔진 재요청 가능, 마지막 미리보기만 유지.
- 미리보기: comment + 선지 비교. 정답 선지는 "✅ 유지", 교체된 오답은 기존 텍스트(취소선) → 새 텍스트.
- 적용: 현재 explanation을 잃지 않도록 `api.questions.get`으로 상세를 먼저 조회한 뒤 `api.questions.update(id, { payload, explanation: detail.explanation })` 호출.
- 화면의 선지는 셔플되어 있으므로(`original_index`), 비교는 원본 payload 순서(index i ↔ `question.choices.find(c => c.original_index === i)`) 기준으로 한다.

- [ ] **Step 1: 상태 타입과 핸들러 추가**

`src/components/ResultPanel.tsx`에서:

import 수정 — `api` import는 이미 있음. type import에 `HardenPreviewDto` 추가:

```typescript
import type {
  ChoiceExplanationDto,
  GenerationEngineDto,
  HardenPreviewDto,
  ReviewResultDto,
  StudyQuestionDto,
} from "@/lib/api-types";
```

`EngineState` 정의 아래에 추가:

```typescript
type HardenState =
  | { status: "idle" }
  | { status: "loading"; engine: GenerationEngineDto }
  | { status: "preview"; preview: HardenPreviewDto; applying: boolean }
  | { status: "applied" }
  | { status: "error"; message: string };
```

`ResultPanel` 컴포넌트 본문(기존 `engineStates` useState 아래)에 추가:

```typescript
  const [harden, setHarden] = useState<HardenState>({ status: "idle" });

  async function requestHarden(engine: GenerationEngineDto) {
    setHarden({ status: "loading", engine });
    try {
      const preview = await api.questions.hardenChoices(question.id, engine);
      setHarden({ status: "preview", preview, applying: false });
    } catch (err) {
      setHarden({
        status: "error",
        message: err instanceof Error ? err.message : "요청 실패",
      });
    }
  }

  async function applyHarden() {
    if (harden.status !== "preview" || harden.applying) return;
    setHarden({ ...harden, applying: true });
    try {
      const detail = await api.questions.get(question.id);
      await api.questions.update(question.id, {
        payload: harden.preview.payload,
        explanation: detail.explanation,
      });
      setHarden({ status: "applied" });
    } catch (err) {
      setHarden({
        status: "error",
        message: err instanceof Error ? err.message : "적용 실패",
      });
    }
  }
```

- [ ] **Step 2: 섹션 JSX 추가**

기존 "🤖 AI 해설 받기" 섹션 `</div>` 닫힌 직후, "다음 문제" 버튼 앞에 추가:

```tsx
      {question.type === "MCQ" && (
        <div className="space-y-2 border-t border-[color:var(--border)] pt-3">
          <p className="section-title">🎯 선지 난이도 올리기</p>
          {harden.status !== "applied" && (
            <div className="flex flex-wrap gap-2">
              {ENGINES.map(({ value }) => (
                <button
                  key={value}
                  onClick={() => requestHarden(value)}
                  disabled={
                    harden.status === "loading" ||
                    (harden.status === "preview" && harden.applying)
                  }
                  className="btn btn-secondary text-sm"
                >
                  {harden.status === "loading" && harden.engine === value
                    ? "수정본 받는 중..."
                    : `${engineLabel(value)}로 올리기`}
                </button>
              ))}
            </div>
          )}
          {harden.status === "error" && (
            <p className="text-[color:var(--danger)]">
              ❌ 수정본을 가져오지 못했습니다: {harden.message}
            </p>
          )}
          {harden.status === "preview" && (
            <div className="surface surface-pad space-y-2">
              <p className="chip">{engineLabel(harden.preview.engine)}</p>
              <p className="text-[color:var(--muted)]">
                {harden.preview.comment}
              </p>
              <ul className="space-y-2 text-sm">
                {harden.preview.payload.choices.map((newText, i) => {
                  const oldText = question.choices.find(
                    (choice) => choice.original_index === i,
                  )?.text;
                  const isAnswer =
                    harden.preview.payload.answer_indices.includes(i);
                  if (isAnswer) {
                    return (
                      <li key={i}>
                        <span className="font-medium text-[color:var(--text)]">
                          {newText}
                        </span>{" "}
                        <span className="chip">정답 유지 ✅</span>
                      </li>
                    );
                  }
                  if (oldText === newText) {
                    return (
                      <li key={i} className="text-[color:var(--muted)]">
                        {newText}
                      </li>
                    );
                  }
                  return (
                    <li key={i} className="space-y-1">
                      <p className="text-[color:var(--muted)] line-through">
                        {oldText}
                      </p>
                      <p className="font-medium text-[color:var(--text)]">
                        → {newText}
                      </p>
                    </li>
                  );
                })}
              </ul>
              <button
                onClick={applyHarden}
                disabled={harden.applying}
                className="btn btn-primary text-sm"
              >
                {harden.applying ? "적용 중..." : "✅ 적용하기"}
              </button>
            </div>
          )}
          {harden.status === "applied" && (
            <p className="text-[color:var(--success)]">
              적용됨 — 다음 학습부터 새 선지가 나옵니다 🎉
            </p>
          )}
        </div>
      )}
```

참고: `btn btn-primary`는 `src/app/globals.css`에 정의된 기존 클래스다 (McqCard 제출 버튼 등에서 사용 중).

- [ ] **Step 3: 린트 + 전체 테스트**

Run: `npm run lint && npm test`
Expected: 에러 없음, 전체 테스트 PASS

- [ ] **Step 4: 수동 스모크 테스트**

1. `npm run dev` 실행 후 로그인 → `/study?mode=practice` 이동.
2. MCQ 문제 하나를 풀어 채점 → 결과 패널에 "🎯 선지 난이도 올리기" 섹션이 보이는지 확인.
3. "Claude로 올리기" 클릭 → 로딩 후 미리보기(comment + 정답 유지 ✅ + 교체 오답 취소선→새 텍스트)가 뜨는지 확인.
4. "✅ 적용하기" 클릭 → "적용됨 — 다음 학습부터 새 선지가 나옵니다 🎉" 확인.
5. `/questions`에서 해당 문제 상세를 열어 선지가 교체됐는지, 정답 선지는 그대로인지 확인.
6. CLOZE 문제 채점 후에는 섹션이 보이지 않는지 확인.

Expected: 위 전부 통과. 3번에서 엔진 실패 시 ❌ 에러 메시지가 표시되고 재시도 가능해야 한다.

- [ ] **Step 5: 빌드 확인 + 커밋**

Run: `npm run build`
Expected: 빌드 성공

```bash
git add src/components/ResultPanel.tsx
git commit -m "feat: 학습 결과 패널에 선지 난이도 올리기 UI 추가"
```
