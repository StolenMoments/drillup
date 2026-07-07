# drillup 구현 계획 2/5 — 도메인 코어 (채점 · SRS · import 검증)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 프레임워크 무관 순수 TS 도메인 모듈(`src/core/`)을 TDD로 구현한다: 문제 타입, 채점, SRS 엔진, LLM import JSON 검증, 프롬프트 템플릿.

**Architecture:** `src/core/`는 zod 외 어떤 외부 의존성도 없다. 이후 플랜의 서비스 계층과 화면이 이 모듈을 소비하며, 백엔드 분리 시 그대로 이식된다.

**Tech Stack:** TypeScript, zod, vitest

## Global Constraints

`00-overview.md`의 Global Constraints를 반드시 먼저 읽고 준수할 것. 선행 조건: 플랜 1 완료.

---

### Task 1: 문제 타입 정의 + 채점 로직 (TDD)

**Files:**
- Create: `src/core/types.ts`
- Create: `src/core/grading.ts`
- Test: `src/core/grading.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `type QuestionType = "MCQ" | "CLOZE"`
  - `interface McqPayload { question: string; choices: string[]; answer_index: number }`
  - `interface ClozeBlank { id: number; answer: string }`
  - `interface ClozePayload { text: string; blanks: ClozeBlank[]; distractors: string[] }`
  - `interface McqAnswer { selected_index: number }`
  - `interface ClozeAnswer { filled: Record<string, string> }` — 키는 blank id의 문자열
  - `gradeMcq(payload: McqPayload, answer: McqAnswer): boolean`
  - `gradeCloze(payload: ClozePayload, answer: ClozeAnswer): boolean`

- [ ] **Step 1: 타입 정의 작성**

`src/core/types.ts`:

```ts
export type QuestionType = "MCQ" | "CLOZE";

/** 객관식 payload — DB question.payload 및 import JSON과 동일 형식(snake_case) */
export interface McqPayload {
  question: string;
  choices: string[]; // 정확히 4개
  answer_index: number; // 0~3
}

export interface ClozeBlank {
  id: number;
  answer: string;
}

/** 빈칸 payload — text에 {{1}}, {{2}} 형식 자리표시자 */
export interface ClozePayload {
  text: string;
  blanks: ClozeBlank[];
  distractors: string[];
}

export type QuestionPayload = McqPayload | ClozePayload;
```

- [ ] **Step 2: 실패하는 테스트 작성**

`src/core/grading.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { gradeCloze, gradeMcq } from "./grading";
import type { ClozePayload, McqPayload } from "./types";

const mcq: McqPayload = {
  question: "1+1은?",
  choices: ["1", "2", "3", "4"],
  answer_index: 1,
};

const cloze: ClozePayload = {
  text: "TCP는 {{1}} 지향이며 {{2}} 핸드셰이크를 사용한다.",
  blanks: [
    { id: 1, answer: "연결" },
    { id: 2, answer: "3-way" },
  ],
  distractors: ["비연결", "4-way"],
};

describe("gradeMcq", () => {
  it("정답 인덱스를 고르면 true", () => {
    expect(gradeMcq(mcq, { selected_index: 1 })).toBe(true);
  });
  it("오답 인덱스를 고르면 false", () => {
    expect(gradeMcq(mcq, { selected_index: 0 })).toBe(false);
  });
});

describe("gradeCloze", () => {
  it("모든 빈칸이 정답이면 true", () => {
    expect(gradeCloze(cloze, { filled: { "1": "연결", "2": "3-way" } })).toBe(true);
  });
  it("정답 비교는 양끝 공백을 무시한다", () => {
    expect(gradeCloze(cloze, { filled: { "1": " 연결 ", "2": "3-way" } })).toBe(true);
  });
  it("하나라도 틀리면 false", () => {
    expect(gradeCloze(cloze, { filled: { "1": "연결", "2": "4-way" } })).toBe(false);
  });
  it("빈칸이 비어 있으면 false", () => {
    expect(gradeCloze(cloze, { filled: { "1": "연결" } })).toBe(false);
  });
});
```

- [ ] **Step 3: 테스트 실패 확인**

```bash
npx vitest run src/core/grading.test.ts
```

Expected: FAIL — `Cannot find module './grading'`.

- [ ] **Step 4: 채점 구현**

`src/core/grading.ts`:

```ts
import type { ClozePayload, McqPayload } from "./types";

export interface McqAnswer {
  selected_index: number;
}

/** filled의 키는 blank id의 문자열 표현 (예: { "1": "연결" }) */
export interface ClozeAnswer {
  filled: Record<string, string>;
}

export function gradeMcq(payload: McqPayload, answer: McqAnswer): boolean {
  return answer.selected_index === payload.answer_index;
}

export function gradeCloze(payload: ClozePayload, answer: ClozeAnswer): boolean {
  return payload.blanks.every(
    (blank) =>
      (answer.filled[String(blank.id)] ?? "").trim() === blank.answer.trim(),
  );
}
```

- [ ] **Step 5: 테스트 통과 확인**

```bash
npx vitest run src/core/grading.test.ts
```

Expected: 6 passed.

- [ ] **Step 6: 커밋**

```bash
git add src/core/types.ts src/core/grading.ts src/core/grading.test.ts
git commit -m "feat: 문제 payload 타입 및 MCQ/CLOZE 채점 로직"
```

---

### Task 2: SRS 엔진 (TDD)

**Files:**
- Create: `src/core/srs.ts`
- Test: `src/core/srs.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `interface SrsSnapshot { easeFactor: number; intervalDays: number; repetitions: number; lapses: number }`
  - `interface SrsUpdate extends SrsSnapshot { dueInDays: number }` — `dueInDays === 0`이면 due_at을 변경하지 말 것(오답)
  - `const INITIAL_SRS: SrsSnapshot` — `{ easeFactor: 2.5, intervalDays: 0, repetitions: 0, lapses: 0 }`
  - `const MIN_EASE_FACTOR = 1.3`
  - `applyAnswer(state: SrsSnapshot, isCorrect: boolean): SrsUpdate`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/srs.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { INITIAL_SRS, MIN_EASE_FACTOR, applyAnswer } from "./srs";

describe("applyAnswer — 정답", () => {
  it("첫 정답: interval 1일, repetitions 1", () => {
    const next = applyAnswer(INITIAL_SRS, true);
    expect(next).toEqual({
      easeFactor: 2.5,
      intervalDays: 1,
      repetitions: 1,
      lapses: 0,
      dueInDays: 1,
    });
  });

  it("두 번째 정답: interval 3일", () => {
    const next = applyAnswer(
      { easeFactor: 2.5, intervalDays: 1, repetitions: 1, lapses: 0 },
      true,
    );
    expect(next.intervalDays).toBe(3);
    expect(next.repetitions).toBe(2);
    expect(next.dueInDays).toBe(3);
  });

  it("세 번째부터: interval = round(interval × EF), EF 유지", () => {
    const next = applyAnswer(
      { easeFactor: 2.5, intervalDays: 3, repetitions: 2, lapses: 0 },
      true,
    );
    expect(next.intervalDays).toBe(8); // round(3 × 2.5) = 8
    expect(next.easeFactor).toBe(2.5);
    expect(next.repetitions).toBe(3);
  });
});

describe("applyAnswer — 오답", () => {
  it("repetitions/interval 리셋, EF -0.2, lapses +1, dueInDays 0", () => {
    const next = applyAnswer(
      { easeFactor: 2.5, intervalDays: 8, repetitions: 3, lapses: 0 },
      false,
    );
    expect(next).toEqual({
      easeFactor: 2.3,
      intervalDays: 0,
      repetitions: 0,
      lapses: 1,
      dueInDays: 0,
    });
  });

  it("EF는 1.3 아래로 내려가지 않는다", () => {
    const next = applyAnswer(
      { easeFactor: 1.4, intervalDays: 1, repetitions: 1, lapses: 5 },
      false,
    );
    expect(next.easeFactor).toBe(MIN_EASE_FACTOR);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/core/srs.test.ts
```

Expected: FAIL — `Cannot find module './srs'`.

- [ ] **Step 3: SRS 엔진 구현**

`src/core/srs.ts`:

```ts
export interface SrsSnapshot {
  easeFactor: number;
  intervalDays: number;
  repetitions: number;
  lapses: number;
}

/** dueInDays === 0 이면 호출부는 due_at을 변경하지 않는다(오답 → 당일 재출제 유지) */
export interface SrsUpdate extends SrsSnapshot {
  dueInDays: number;
}

export const INITIAL_SRS: SrsSnapshot = {
  easeFactor: 2.5,
  intervalDays: 0,
  repetitions: 0,
  lapses: 0,
};

export const MIN_EASE_FACTOR = 1.3;

export function applyAnswer(state: SrsSnapshot, isCorrect: boolean): SrsUpdate {
  if (isCorrect) {
    const repetitions = state.repetitions + 1;
    const intervalDays =
      repetitions === 1
        ? 1
        : repetitions === 2
          ? 3
          : Math.round(state.intervalDays * state.easeFactor);
    return {
      easeFactor: state.easeFactor,
      intervalDays,
      repetitions,
      lapses: state.lapses,
      dueInDays: intervalDays,
    };
  }
  return {
    easeFactor: Math.max(
      MIN_EASE_FACTOR,
      Math.round((state.easeFactor - 0.2) * 100) / 100,
    ),
    intervalDays: 0,
    repetitions: 0,
    lapses: state.lapses + 1,
    dueInDays: 0,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/core/srs.test.ts
```

Expected: 5 passed.

- [ ] **Step 5: 커밋**

```bash
git add src/core/srs.ts src/core/srs.test.ts
git commit -m "feat: SM-2 단순화 SRS 엔진(applyAnswer)"
```

---

### Task 3: import JSON 검증 (TDD)

**Files:**
- Create: `src/core/import-schema.ts`
- Test: `src/core/import-schema.test.ts`

**Interfaces:**
- Consumes: `src/core/types.ts`의 payload 타입 (형식 일치 유지)
- Produces:
  - `mcqPayloadSchema`, `clozePayloadSchema` — payload 단독 zod 스키마 (플랜 3의 문제 수정 API가 재사용)
  - `importMcqSchema`, `importClozeSchema` — `type` 판별자 + `explanation?` 포함
  - `type ImportQuestion = z.infer<typeof importMcqSchema> | z.infer<typeof importClozeSchema>`
  - `type ImportItemResult = { index: number; ok: true; question: ImportQuestion } | { index: number; ok: false; errors: string[] }`
  - `type ImportParseResult = { ok: true; items: ImportItemResult[] } | { ok: false; fatal: string }`
  - `validateImportQuestions(questions: unknown[]): ImportItemResult[]` — 이미 파싱된 배열 검증 (플랜 3의 import API가 사용)
  - `parseImportJson(rawText: string): ImportParseResult` — JSON 텍스트 검증 (가져오기 화면이 사용)

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/import-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseImportJson } from "./import-schema";

const validMcq = {
  type: "mcq",
  question: "1+1은?",
  choices: ["1", "2", "3", "4"],
  answer_index: 1,
  explanation: "산수",
};

const validCloze = {
  type: "cloze",
  text: "TCP는 {{1}} 지향이며 {{2}} 핸드셰이크를 사용한다.",
  blanks: [
    { id: 1, answer: "연결" },
    { id: 2, answer: "3-way" },
  ],
  distractors: ["비연결"],
};

function parseOne(question: unknown) {
  return parseImportJson(JSON.stringify({ questions: [question] }));
}

describe("parseImportJson — 치명적 오류", () => {
  it("JSON이 아니면 fatal", () => {
    const r = parseImportJson("not json");
    expect(r.ok).toBe(false);
  });
  it("questions 배열이 없거나 비어 있으면 fatal", () => {
    expect(parseImportJson(JSON.stringify({})).ok).toBe(false);
    expect(parseImportJson(JSON.stringify({ questions: [] })).ok).toBe(false);
  });
});

describe("parseImportJson — MCQ", () => {
  it("유효한 문제는 ok", () => {
    const r = parseOne(validMcq);
    if (!r.ok) throw new Error("expected ok");
    expect(r.items[0].ok).toBe(true);
  });
  it("보기가 4개가 아니면 오류", () => {
    const r = parseOne({ ...validMcq, choices: ["1", "2", "3"] });
    if (!r.ok) throw new Error("expected ok");
    expect(r.items[0].ok).toBe(false);
  });
  it("answer_index 범위 밖이면 오류", () => {
    const r = parseOne({ ...validMcq, answer_index: 4 });
    if (!r.ok) throw new Error("expected ok");
    expect(r.items[0].ok).toBe(false);
  });
  it("보기 중복이면 오류", () => {
    const r = parseOne({ ...validMcq, choices: ["1", "1", "3", "4"] });
    if (!r.ok) throw new Error("expected ok");
    expect(r.items[0].ok).toBe(false);
  });
});

describe("parseImportJson — CLOZE", () => {
  it("유효한 문제는 ok", () => {
    const r = parseOne(validCloze);
    if (!r.ok) throw new Error("expected ok");
    expect(r.items[0].ok).toBe(true);
  });
  it("text의 자리표시자와 blanks id가 불일치하면 오류", () => {
    const r = parseOne({
      ...validCloze,
      blanks: [{ id: 1, answer: "연결" }], // {{2}}가 text에 남음
    });
    if (!r.ok) throw new Error("expected ok");
    expect(r.items[0].ok).toBe(false);
  });
  it("distractors가 비어 있으면 오류", () => {
    const r = parseOne({ ...validCloze, distractors: [] });
    if (!r.ok) throw new Error("expected ok");
    expect(r.items[0].ok).toBe(false);
  });
  it("단어은행(정답+오답)에 중복이 있으면 오류", () => {
    const r = parseOne({ ...validCloze, distractors: ["연결"] });
    if (!r.ok) throw new Error("expected ok");
    expect(r.items[0].ok).toBe(false);
  });
});

describe("parseImportJson — 혼합", () => {
  it("유효/무효가 섞이면 인덱스별로 결과가 나뉜다", () => {
    const r = parseImportJson(
      JSON.stringify({
        questions: [validMcq, { type: "unknown" }, validCloze],
      }),
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.items.map((i) => i.ok)).toEqual([true, false, true]);
    expect(r.items[1].ok === false && r.items[1].errors.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/core/import-schema.test.ts
```

Expected: FAIL — `Cannot find module './import-schema'`.

- [ ] **Step 3: 스키마 및 파서 구현**

`src/core/import-schema.ts`:

```ts
import { z } from "zod";

const nonBlank = z.string().trim().min(1, "빈 문자열은 허용되지 않습니다");

const PLACEHOLDER_RE = /\{\{(\d+)\}\}/g;

// ---- MCQ ----

const mcqBase = z.object({
  question: nonBlank,
  choices: z.array(nonBlank).length(4, "보기는 정확히 4개여야 합니다"),
  answer_index: z
    .number()
    .int()
    .min(0, "answer_index는 0~3이어야 합니다")
    .max(3, "answer_index는 0~3이어야 합니다"),
});

function refineMcq(q: z.infer<typeof mcqBase>, ctx: z.RefinementCtx) {
  if (new Set(q.choices.map((c) => c.trim())).size !== q.choices.length) {
    ctx.addIssue({
      code: "custom",
      path: ["choices"],
      message: "보기에 중복이 있습니다",
    });
  }
}

// ---- CLOZE ----

const clozeBase = z.object({
  text: nonBlank,
  blanks: z
    .array(z.object({ id: z.number().int().positive(), answer: nonBlank }))
    .min(1, "빈칸이 1개 이상 필요합니다"),
  distractors: z.array(nonBlank).min(1, "오답 단어가 1개 이상 필요합니다"),
});

function refineCloze(q: z.infer<typeof clozeBase>, ctx: z.RefinementCtx) {
  const textIds = new Set(
    [...q.text.matchAll(PLACEHOLDER_RE)].map((m) => Number(m[1])),
  );
  const blankIds = q.blanks.map((b) => b.id);
  if (new Set(blankIds).size !== blankIds.length) {
    ctx.addIssue({
      code: "custom",
      path: ["blanks"],
      message: "blanks의 id가 중복됩니다",
    });
  }
  const sameSize = textIds.size === new Set(blankIds).size;
  const allMatch = blankIds.every((id) => textIds.has(id));
  if (!sameSize || !allMatch) {
    ctx.addIssue({
      code: "custom",
      path: ["text"],
      message: "text의 {{n}} 자리표시자와 blanks의 id 집합이 일치해야 합니다",
    });
  }
  const words = [
    ...q.blanks.map((b) => b.answer.trim()),
    ...q.distractors.map((d) => d.trim()),
  ];
  if (new Set(words).size !== words.length) {
    ctx.addIssue({
      code: "custom",
      path: ["distractors"],
      message: "단어은행(정답+오답)에 중복 단어가 있습니다",
    });
  }
}

// ---- 공개 스키마 ----

/** payload 단독 스키마 — 문제 수정 API에서 재사용 */
export const mcqPayloadSchema = mcqBase.superRefine(refineMcq);
export const clozePayloadSchema = clozeBase.superRefine(refineCloze);

export const importMcqSchema = mcqBase
  .extend({ type: z.literal("mcq"), explanation: z.string().optional() })
  .superRefine(refineMcq);

export const importClozeSchema = clozeBase
  .extend({ type: z.literal("cloze"), explanation: z.string().optional() })
  .superRefine(refineCloze);

export type ImportQuestion =
  | z.infer<typeof importMcqSchema>
  | z.infer<typeof importClozeSchema>;

export type ImportItemResult =
  | { index: number; ok: true; question: ImportQuestion }
  | { index: number; ok: false; errors: string[] };

export type ImportParseResult =
  | { ok: true; items: ImportItemResult[] }
  | { ok: false; fatal: string };

/** 이미 파싱된 문제 배열을 문제 단위(index)로 검증한다. import API의 서버측 재검증에도 사용. */
export function validateImportQuestions(
  questions: unknown[],
): ImportItemResult[] {
  return questions.map((raw, index) => {
    const type = (raw as { type?: unknown })?.type;
    const schema =
      type === "mcq"
        ? importMcqSchema
        : type === "cloze"
          ? importClozeSchema
          : null;
    if (!schema) {
      return {
        index,
        ok: false as const,
        errors: ['type은 "mcq" 또는 "cloze"여야 합니다'],
      };
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      return {
        index,
        ok: false as const,
        errors: parsed.error.issues.map(
          (i) => `${i.path.join(".")}: ${i.message}`,
        ),
      };
    }
    return { index, ok: true as const, question: parsed.data };
  });
}

/**
 * LLM이 출력한 JSON 텍스트를 검증한다.
 * 문서 전체가 깨졌으면 fatal, 아니면 문제 단위(index)로 ok/errors를 돌려준다.
 */
export function parseImportJson(rawText: string): ImportParseResult {
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    return { ok: false, fatal: "올바른 JSON이 아닙니다" };
  }
  const questions = (data as { questions?: unknown })?.questions;
  if (!Array.isArray(questions) || questions.length === 0) {
    return {
      ok: false,
      fatal: "최상위에 questions 배열이 있어야 하며 비어 있으면 안 됩니다",
    };
  }
  return { ok: true, items: validateImportQuestions(questions) };
}
```

참고: `importMcqSchema.safeParse`와 `importClozeSchema.safeParse`를 type 값으로 분기하는 이유 — `superRefine`이 적용된 스키마는 `z.discriminatedUnion`에 넣을 수 없다(zod 제약).

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/core/import-schema.test.ts
```

Expected: 11 passed.

- [ ] **Step 5: 커밋**

```bash
git add src/core/import-schema.ts src/core/import-schema.test.ts
git commit -m "feat: LLM import JSON zod 검증(parseImportJson)"
```

---

### Task 4: 프롬프트 템플릿 + 셔플 유틸

**Files:**
- Create: `src/core/prompt-template.ts`
- Create: `src/core/random.ts`
- Test: `src/core/random.test.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `buildGenerationPrompt(topicName: string): string` — LLM에 붙여넣을 완성 프롬프트
  - `shuffle<T>(items: readonly T[]): T[]` — 원본 불변, Fisher–Yates

- [ ] **Step 1: 셔플 실패 테스트 작성**

`src/core/random.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { shuffle } from "./random";

describe("shuffle", () => {
  it("원본 배열을 변경하지 않고 같은 원소를 반환한다", () => {
    const input = [1, 2, 3, 4, 5];
    const copy = [...input];
    const result = shuffle(input);
    expect(input).toEqual(copy);
    expect([...result].sort()).toEqual([...input].sort());
    expect(result).toHaveLength(input.length);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

```bash
npx vitest run src/core/random.test.ts
```

Expected: FAIL — `Cannot find module './random'`.

- [ ] **Step 3: 셔플 구현**

`src/core/random.ts`:

```ts
/** Fisher–Yates. 원본을 변경하지 않는다. */
export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
```

- [ ] **Step 4: 테스트 통과 확인**

```bash
npx vitest run src/core/random.test.ts
```

Expected: 1 passed.

- [ ] **Step 5: 프롬프트 템플릿 구현**

`src/core/prompt-template.ts` (테스트 불필요 — 상수 문자열 조립):

```ts
/**
 * 가져오기 화면의 "프롬프트 복사" 버튼이 사용하는 LLM 프롬프트.
 * 사용자는 이 프롬프트 뒤에 범위/난이도/개수 등의 지시를 덧붙여 사용한다.
 */
export function buildGenerationPrompt(topicName: string): string {
  return `당신은 학습용 문제 출제 전문가입니다. 주제 "${topicName}"에 대한 학습 문제를 생성해 주세요.

## 출력 형식 (반드시 준수)

다른 설명 없이 아래 구조의 JSON만 출력하세요. 코드 펜스(\`\`\`)도 쓰지 마세요.

{
  "questions": [
    {
      "type": "mcq",
      "question": "질문 텍스트",
      "choices": ["보기1", "보기2", "보기3", "보기4"],
      "answer_index": 0,
      "explanation": "정답에 대한 간결한 해설"
    },
    {
      "type": "cloze",
      "text": "핵심 개념을 설명하는 문장. 중요한 단어 자리에 {{1}}, {{2}} 형태의 빈칸을 둔다.",
      "blanks": [
        { "id": 1, "answer": "빈칸1의 정답 단어" },
        { "id": 2, "answer": "빈칸2의 정답 단어" }
      ],
      "distractors": ["그럴듯한 오답 단어1", "오답 단어2"],
      "explanation": "해설"
    }
  ]
}

## 규칙

- mcq: choices는 정확히 4개, 중복 금지, answer_index는 0~3.
- cloze: text의 {{n}} 자리표시자와 blanks의 id가 정확히 일치해야 함. distractors는 1개 이상이며 정답 단어와 겹치면 안 됨. 빈칸은 문장의 핵심 개념 단어에 뚫을 것.
- explanation은 한두 문장으로 간결하게.
- 두 유형(mcq, cloze)을 섞어서 출제할 것.

## 추가 지시

(여기에 범위, 난이도, 문제 수 등을 적어 주세요)
`;
}
```

- [ ] **Step 6: 전체 core 테스트 확인**

```bash
npm test
```

Expected: session/grading/srs/import-schema/random 테스트 전부 passed.

- [ ] **Step 7: 커밋**

```bash
git add src/core/prompt-template.ts src/core/random.ts src/core/random.test.ts
git commit -m "feat: LLM 프롬프트 템플릿 및 셔플 유틸"
```
