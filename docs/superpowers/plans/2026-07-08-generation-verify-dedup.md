# AI 생성 교차 검증 + 중복 방지 구현 플랜

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `/generate` 파이프라인에 (1) 생성 직후 다른 엔진 CLI로 자동 교차 검증, (2) 기존 문제 목록을 프롬프트에 포함한 중복 방지를 추가한다.

**Architecture:** 기존 `GenerationJob` 단일 잡을 2단계(`RUNNING → VERIFYING → SUCCEEDED/FAILED`)로 확장한다. 검증은 기존 `runEngine`을 파일 접두사만 바꿔 재사용하고, 검증 실패는 잡 실패가 아니라 전 항목 `unverified` + `verifyWarning`으로 처리한다. 중복 방지는 `createJob`에서 기존 문제를 요약해 생성 프롬프트에 넣는 프롬프트 예방만 한다.

**Tech Stack:** Next.js(App Router) + Prisma(MariaDB) + zod + vitest. CLI 엔진: claude / codex / antigravity.

**Spec:** `docs/superpowers/specs/2026-07-08-generation-verify-dedup-design.md`

## Global Constraints

- `master` 브랜치에서 직접 작업 (브랜치·워크트리 생성 금지)
- 커밋 메시지는 한국어, conventional-commit 타입 접두사는 영어 (`feat:`, `fix:`, `test:`, `chore:`, `docs:`). 태스크당 1커밋
- 자동 테스트는 `src/core/`만 (프로젝트 규약: 서비스 계층·화면은 수동 검증). 테스트 실행: `npx vitest run <파일>`
- `src/core/`는 순수 TS — Prisma·Next·Node 전용 API import 금지 (`node:` 모듈 포함)
- Route Handler는 얇게: zod 파싱 → 서비스 호출 → JSON 응답
- 화면은 `src/lib/api-client.ts`의 `api` 객체만 사용
- 사용자 피드백 문구에 이모지 유지 (✅/❌/⚠️)
- `.env`, `generation_output/`은 git 미추적 유지

---

### Task 1: Prisma 스키마 확장 + 마이그레이션

**Files:**
- Modify: `prisma/schema.prisma` (25행 `GenerationStatus` enum, 82행 `GenerationJob` 모델)

**Interfaces:**
- Produces: `GenerationStatus`에 `VERIFYING` 값, `GenerationJob.verifyEngine: GenerationEngine`, `GenerationJob.verifyWarning: String?` — Task 6이 Prisma 클라이언트로 사용

- [ ] **Step 1: enum과 모델 수정**

`prisma/schema.prisma`의 `GenerationStatus`에 `VERIFYING`을 추가한다 (RUNNING 다음 줄):

```prisma
enum GenerationStatus {
  RUNNING
  VERIFYING
  SUCCEEDED
  FAILED
}
```

`GenerationJob` 모델에 두 필드를 추가한다 (`instructions` 아래). 기존 행 백필을 위해 `verifyEngine`에 DB 기본값 `CLAUDE`를 둔다 (신규 잡은 항상 화면에서 값을 보내므로 기본값은 마이그레이션용일 뿐):

```prisma
model GenerationJob {
  id            Int              @id @default(autoincrement())
  topicId       Int              @map("topic_id")
  engine        GenerationEngine
  verifyEngine  GenerationEngine @default(CLAUDE) @map("verify_engine")
  instructions  String           @db.Text
  status        GenerationStatus @default(RUNNING)
  result        Json?
  errorMessage  String?          @map("error_message") @db.Text
  verifyWarning String?          @map("verify_warning") @db.Text
  rawOutput     String?          @map("raw_output") @db.MediumText
  createdAt     DateTime         @default(now()) @map("created_at")
  finishedAt    DateTime?        @map("finished_at")
  topic         Topic            @relation(fields: [topicId], references: [id], onDelete: Cascade)

  @@map("generation_job")
}
```

- [ ] **Step 2: 마이그레이션 실행**

Run: `npx prisma migrate dev --name add_generation_verify`
Expected: 마이그레이션 SQL 생성·적용, Prisma 클라이언트 재생성. 오류 없이 종료.

- [ ] **Step 3: 커밋**

```bash
git add prisma/
git commit -m "feat: GenerationJob에 검증 엔진·경고 컬럼과 VERIFYING 상태 추가"
```

---

### Task 2: core — 문제 요약 유틸 (`question-summary.ts`)

**Files:**
- Create: `src/core/question-summary.ts`
- Test: `src/core/question-summary.test.ts`

**Interfaces:**
- Consumes: `QuestionType`(`"MCQ" | "CLOZE"`) from `src/core/types.ts`
- Produces:
  - `summarizeQuestionPayload(type: QuestionType, payload: unknown): string` — mcq는 질문 텍스트, cloze는 `{{n}}`을 정답으로 채운 문장. 알 수 없는 payload면 `""`
  - `capSummaries(summaries: string[], maxChars?: number): { kept: string[]; truncated: boolean }` — 빈 문자열 제거, 합계 `maxChars`(기본 8000자) 초과 직전에서 절단

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/question-summary.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { capSummaries, summarizeQuestionPayload } from "./question-summary";

describe("summarizeQuestionPayload", () => {
  it("MCQ는 질문 텍스트를 반환한다", () => {
    expect(
      summarizeQuestionPayload("MCQ", {
        question: "리눅스 커널을 만든 사람은?",
        choices: ["a", "b", "c", "d"],
        answer_index: 0,
      }),
    ).toBe("리눅스 커널을 만든 사람은?");
  });

  it("CLOZE는 빈칸을 정답 단어로 채운 문장을 반환한다", () => {
    expect(
      summarizeQuestionPayload("CLOZE", {
        text: "{{1}}는 {{2}}년에 발표되었다.",
        blanks: [
          { id: 1, answer: "리눅스" },
          { id: 2, answer: "1991" },
        ],
        distractors: ["유닉스"],
      }),
    ).toBe("리눅스는 1991년에 발표되었다.");
  });

  it("blanks에 없는 자리표시자는 원문 그대로 둔다", () => {
    expect(
      summarizeQuestionPayload("CLOZE", {
        text: "{{1}}과 {{9}}",
        blanks: [{ id: 1, answer: "커널" }],
        distractors: ["셸"],
      }),
    ).toBe("커널과 {{9}}");
  });

  it("payload가 객체가 아니거나 형태가 다르면 빈 문자열을 반환한다", () => {
    expect(summarizeQuestionPayload("MCQ", null)).toBe("");
    expect(summarizeQuestionPayload("MCQ", "문자열")).toBe("");
    expect(summarizeQuestionPayload("MCQ", { question: 123 })).toBe("");
    expect(summarizeQuestionPayload("CLOZE", { blanks: [] })).toBe("");
  });
});

describe("capSummaries", () => {
  it("빈 문자열을 제거하고 순서를 유지한다", () => {
    expect(capSummaries(["a", "", "b"])).toEqual({
      kept: ["a", "b"],
      truncated: false,
    });
  });

  it("합계가 maxChars를 넘기 직전에서 절단하고 truncated를 표시한다", () => {
    expect(capSummaries(["12345", "67890", "abc"], 10)).toEqual({
      kept: ["12345", "67890"],
      truncated: true,
    });
  });

  it("정확히 maxChars까지는 유지한다", () => {
    expect(capSummaries(["12345", "67890"], 10)).toEqual({
      kept: ["12345", "67890"],
      truncated: false,
    });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/core/question-summary.test.ts`
Expected: FAIL — `Cannot find module './question-summary'` 류의 오류

- [ ] **Step 3: 구현**

`src/core/question-summary.ts`:

```ts
import type { QuestionType } from "./types";

const PLACEHOLDER_RE = /\{\{(\d+)\}\}/g;
const DEFAULT_MAX_CHARS = 8000;

export function summarizeQuestionPayload(
  type: QuestionType,
  payload: unknown,
): string {
  if (typeof payload !== "object" || payload === null) return "";
  const record = payload as Record<string, unknown>;

  if (type === "MCQ") {
    return typeof record.question === "string" ? record.question.trim() : "";
  }

  if (typeof record.text !== "string") return "";
  const answers = new Map<number, string>();
  if (Array.isArray(record.blanks)) {
    for (const blank of record.blanks) {
      if (typeof blank !== "object" || blank === null) continue;
      const { id, answer } = blank as Record<string, unknown>;
      if (typeof id === "number" && typeof answer === "string") {
        answers.set(id, answer);
      }
    }
  }
  return record.text
    .replace(PLACEHOLDER_RE, (whole, id) => answers.get(Number(id)) ?? whole)
    .trim();
}

export function capSummaries(
  summaries: string[],
  maxChars: number = DEFAULT_MAX_CHARS,
): { kept: string[]; truncated: boolean } {
  const kept: string[] = [];
  let total = 0;
  for (const summary of summaries) {
    if (!summary) continue;
    if (total + summary.length > maxChars) {
      return { kept, truncated: true };
    }
    kept.push(summary);
    total += summary.length;
  }
  return { kept, truncated: false };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/core/question-summary.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/core/question-summary.ts src/core/question-summary.test.ts
git commit -m "feat: 중복 방지용 문제 요약 유틸(question-summary) 추가"
```

---

### Task 3: core — 생성 프롬프트에 기존 문제 목록(중복 금지) 추가

**Files:**
- Modify: `src/core/prompt-template.ts` (`buildCliGenerationPrompt`, 49-66행)
- Test: `src/core/prompt-template.test.ts` (기존 `buildCliGenerationPrompt` 테스트 3건의 인자 수정 + 신규 3건)

**Interfaces:**
- Produces: `ExistingQuestions` 타입과 변경된 시그니처 — Task 6의 `generation-service`가 사용

  ```ts
  export interface ExistingQuestions {
    summaries: string[];
    truncated: boolean;
  }
  export function buildCliGenerationPrompt(
    topicName: string,
    instructions: string,
    resultPath: string,
    existing: ExistingQuestions,
  ): string;
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/prompt-template.test.ts`의 `buildCliGenerationPrompt` describe 블록을 다음으로 교체한다 (기존 3건은 4번째 인자만 추가, 신규 3건 추가):

```ts
const NO_EXISTING = { summaries: [], truncated: false };

describe("buildCliGenerationPrompt", () => {
  it("주제명·추가 지시·결과 저장 경로를 포함한다", () => {
    const prompt = buildCliGenerationPrompt(
      "리눅스 기초",
      "쉬운 난이도로 5문제",
      "D:\\work\\drillup\\generation_output\\jobs\\1\\result.json",
      NO_EXISTING,
    );
    expect(prompt).toContain('"리눅스 기초"');
    expect(prompt).toContain("쉬운 난이도로 5문제");
    expect(prompt).toContain(
      "D:\\work\\drillup\\generation_output\\jobs\\1\\result.json",
    );
    expect(prompt).toContain("stdout에 출력하지 마세요");
  });

  it("추가 지시가 공백뿐이면 (없음)으로 표기한다", () => {
    const prompt = buildCliGenerationPrompt(
      "리눅스 기초",
      "   ",
      "D:\\r.json",
      NO_EXISTING,
    );
    expect(prompt).toContain("(없음)");
  });

  it("수동용 안내 문구를 포함하지 않는다", () => {
    const prompt = buildCliGenerationPrompt(
      "리눅스 기초",
      "",
      "D:\\r.json",
      NO_EXISTING,
    );
    expect(prompt).not.toContain(
      "여기에 범위, 난이도, 문제 수 같은 조건을 추가해 사용하세요",
    );
  });

  it("기존 문제가 없으면 배치 내 중복 금지 지시만 포함한다", () => {
    const prompt = buildCliGenerationPrompt(
      "리눅스 기초",
      "",
      "D:\\r.json",
      NO_EXISTING,
    );
    expect(prompt).toContain("이번에 생성하는 문제들끼리");
    expect(prompt).not.toContain("기존 문제 목록");
  });

  it("기존 문제가 있으면 목록과 중복 금지 지시를 포함한다", () => {
    const prompt = buildCliGenerationPrompt("리눅스 기초", "", "D:\\r.json", {
      summaries: ["리눅스 커널을 만든 사람은?", "리눅스는 1991년에 발표되었다."],
      truncated: false,
    });
    expect(prompt).toContain("기존 문제 목록");
    expect(prompt).toContain("- 리눅스 커널을 만든 사람은?");
    expect(prompt).toContain("- 리눅스는 1991년에 발표되었다.");
    expect(prompt).toContain("표현만 바꾼 문제");
    expect(prompt).not.toContain("이 외에도 기존 문제가 더 있습니다");
  });

  it("목록이 잘렸으면 더 있음을 명시한다", () => {
    const prompt = buildCliGenerationPrompt("리눅스 기초", "", "D:\\r.json", {
      summaries: ["요약1"],
      truncated: true,
    });
    expect(prompt).toContain("이 외에도 기존 문제가 더 있습니다");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/core/prompt-template.test.ts`
Expected: FAIL — 신규 3건이 실패 (기존 3건은 4번째 인자가 무시되므로 통과할 수 있음. 신규 케이스 실패만 확인하면 됨)

- [ ] **Step 3: 구현**

`src/core/prompt-template.ts`의 `buildCliGenerationPrompt`를 다음으로 교체한다 (`buildGenerationPrompt`와 `promptBody`는 그대로):

```ts
export interface ExistingQuestions {
  summaries: string[];
  truncated: boolean;
}

function dedupSection(existing: ExistingQuestions): string {
  const lines = [
    "## 중복 금지",
    "",
    "- 이번에 생성하는 문제들끼리 질문 내용이 중복되면 안 됩니다.",
  ];
  if (existing.summaries.length > 0) {
    lines.push(
      "- 아래 기존 문제 목록과 질문 내용이 같거나 표현만 바꾼 문제는 출제하지 마세요.",
      "",
      "### 기존 문제 목록",
      "",
      ...existing.summaries.map((summary) => `- ${summary}`),
    );
    if (existing.truncated) {
      lines.push("", "(이 외에도 기존 문제가 더 있습니다. 위 목록은 일부입니다.)");
    }
  }
  return lines.join("\n");
}

export function buildCliGenerationPrompt(
  topicName: string,
  instructions: string,
  resultPath: string,
  existing: ExistingQuestions,
): string {
  const extra = instructions.trim();
  return `${promptBody(topicName)}
${dedupSection(existing)}

## 추가 지시

${extra || "(없음)"}

## 결과 저장 (반드시 준수)

- 결과 JSON을 stdout에 출력하지 마세요.
- 결과 JSON은 다음 경로에 UTF-8 텍스트 파일로만 저장하세요: ${resultPath}
- 파일 내용은 위 출력 형식의 JSON만 포함해야 하며, 코드 펜스나 설명 문장을 추가하지 마세요.
`;
}
```

주의: 이 시점에 `src/server/generation/generation-service.ts:71`의 기존 호출부가 인자 3개라 타입 오류가 난다. Task 6에서 고치므로 여기서는 테스트만 통과시키면 된다 (vitest는 해당 파일을 import하지 않음).

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/core/prompt-template.test.ts`
Expected: PASS

- [ ] **Step 5: 커밋**

```bash
git add src/core/prompt-template.ts src/core/prompt-template.test.ts
git commit -m "feat: 생성 프롬프트에 기존 문제 목록 기반 중복 금지 섹션 추가"
```

---

### Task 4: core — 검증 결과 스키마·병합 (`verify-schema.ts`)

**Files:**
- Create: `src/core/verify-schema.ts`
- Test: `src/core/verify-schema.test.ts`

**Interfaces:**
- Consumes: `ImportItemResult`, `ImportQuestion` from `src/core/import-schema.ts`
- Produces (Task 6·8이 사용):

  ```ts
  export interface VerifyVerdict {
    index: number;
    verdict: "pass" | "fail";
    comment: string | null;
  }
  export type VerifyParseResult =
    | { ok: true; verdicts: VerifyVerdict[] }
    | { ok: false; fatal: string };
  export function parseVerifyJson(rawText: string): VerifyParseResult;

  export type VerifiedItemResult =
    | {
        index: number;
        ok: true;
        question: ImportQuestion;
        verdict: "pass" | "fail" | "unverified";
        verdictComment: string | null;
      }
    | { index: number; ok: false; errors: string[] };
  export function mergeVerdicts(
    items: ImportItemResult[],
    verdicts: VerifyVerdict[],
  ): VerifiedItemResult[];
  ```

  `mergeVerdicts(items, [])`는 전 항목 `unverified`로 만드는 데도 쓴다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/verify-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { ImportItemResult } from "./import-schema";
import { mergeVerdicts, parseVerifyJson } from "./verify-schema";

const MCQ = {
  type: "mcq" as const,
  question: "질문?",
  choices: ["a", "b", "c", "d"],
  answer_index: 0,
};

describe("parseVerifyJson", () => {
  it("정상 verdicts를 파싱하고 빈 comment는 null로 정규화한다", () => {
    const result = parseVerifyJson(
      JSON.stringify({
        verdicts: [
          { index: 0, verdict: "pass", comment: "" },
          { index: 1, verdict: "fail", comment: " 정답 오류 " },
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      verdicts: [
        { index: 0, verdict: "pass", comment: null },
        { index: 1, verdict: "fail", comment: "정답 오류" },
      ],
    });
  });

  it("comment가 없어도 허용한다", () => {
    const result = parseVerifyJson(
      JSON.stringify({ verdicts: [{ index: 0, verdict: "pass" }] }),
    );
    expect(result).toEqual({
      ok: true,
      verdicts: [{ index: 0, verdict: "pass", comment: null }],
    });
  });

  it("형식이 어긋난 verdict는 건너뛴다", () => {
    const result = parseVerifyJson(
      JSON.stringify({
        verdicts: [
          { index: 0, verdict: "ok" },
          { index: "1", verdict: "pass" },
          { index: 2, verdict: "fail", comment: "사유" },
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      verdicts: [{ index: 2, verdict: "fail", comment: "사유" }],
    });
  });

  it("JSON이 아니면 실패한다", () => {
    expect(parseVerifyJson("검증했습니다!")).toEqual({
      ok: false,
      fatal: "올바른 JSON이 아닙니다",
    });
  });

  it("verdicts 배열이 없으면 실패한다", () => {
    expect(parseVerifyJson('{"result": []}')).toEqual({
      ok: false,
      fatal: "최상위에 verdicts 배열이 있어야 합니다",
    });
  });
});

describe("mergeVerdicts", () => {
  const items: ImportItemResult[] = [
    { index: 0, ok: true, question: MCQ },
    { index: 1, ok: false, errors: ["오류"] },
    { index: 2, ok: true, question: MCQ },
  ];

  it("index로 매칭해 verdict를 병합한다", () => {
    const merged = mergeVerdicts(items, [
      { index: 0, verdict: "pass", comment: null },
      { index: 2, verdict: "fail", comment: "복수 정답 소지" },
    ]);
    expect(merged).toEqual([
      { index: 0, ok: true, question: MCQ, verdict: "pass", verdictComment: null },
      { index: 1, ok: false, errors: ["오류"] },
      {
        index: 2,
        ok: true,
        question: MCQ,
        verdict: "fail",
        verdictComment: "복수 정답 소지",
      },
    ]);
  });

  it("verdict가 없는 유효 항목은 unverified로 남긴다", () => {
    const merged = mergeVerdicts(items, [
      { index: 0, verdict: "pass", comment: null },
    ]);
    expect(merged[2]).toEqual({
      index: 2,
      ok: true,
      question: MCQ,
      verdict: "unverified",
      verdictComment: null,
    });
  });

  it("빈 verdicts면 전 유효 항목이 unverified가 된다", () => {
    const merged = mergeVerdicts(items, []);
    expect(
      merged.filter((item) => item.ok).every((item) => item.verdict === "unverified"),
    ).toBe(true);
  });

  it("ok:false 항목은 그대로 통과시킨다", () => {
    const merged = mergeVerdicts(items, [
      { index: 1, verdict: "pass", comment: null },
    ]);
    expect(merged[1]).toEqual({ index: 1, ok: false, errors: ["오류"] });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/core/verify-schema.test.ts`
Expected: FAIL — `Cannot find module './verify-schema'`

- [ ] **Step 3: 구현**

`src/core/verify-schema.ts`:

```ts
import { z } from "zod";
import type { ImportItemResult, ImportQuestion } from "./import-schema";

const verdictSchema = z.object({
  index: z.number().int().min(0),
  verdict: z.enum(["pass", "fail"]),
  comment: z.string().optional(),
});

export interface VerifyVerdict {
  index: number;
  verdict: "pass" | "fail";
  comment: string | null;
}

export type VerifyParseResult =
  | { ok: true; verdicts: VerifyVerdict[] }
  | { ok: false; fatal: string };

export function parseVerifyJson(rawText: string): VerifyParseResult {
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    return { ok: false, fatal: "올바른 JSON이 아닙니다" };
  }

  const verdicts =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>).verdicts
      : undefined;
  if (!Array.isArray(verdicts)) {
    return { ok: false, fatal: "최상위에 verdicts 배열이 있어야 합니다" };
  }

  const parsed: VerifyVerdict[] = [];
  for (const raw of verdicts) {
    const result = verdictSchema.safeParse(raw);
    // 형식이 어긋난 verdict는 건너뛴다 — 해당 항목은 unverified로 남는다.
    if (!result.success) continue;
    const comment = result.data.comment?.trim();
    parsed.push({
      index: result.data.index,
      verdict: result.data.verdict,
      comment: comment ? comment : null,
    });
  }
  return { ok: true, verdicts: parsed };
}

export type VerifiedItemResult =
  | {
      index: number;
      ok: true;
      question: ImportQuestion;
      verdict: "pass" | "fail" | "unverified";
      verdictComment: string | null;
    }
  | { index: number; ok: false; errors: string[] };

export function mergeVerdicts(
  items: ImportItemResult[],
  verdicts: VerifyVerdict[],
): VerifiedItemResult[] {
  const byIndex = new Map(verdicts.map((verdict) => [verdict.index, verdict]));
  return items.map((item) => {
    if (!item.ok) return item;
    const matched = byIndex.get(item.index);
    if (!matched) {
      return { ...item, verdict: "unverified" as const, verdictComment: null };
    }
    return { ...item, verdict: matched.verdict, verdictComment: matched.comment };
  });
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/core/verify-schema.test.ts`
Expected: PASS (9 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/core/verify-schema.ts src/core/verify-schema.test.ts
git commit -m "feat: 검증 verdict 파싱·병합 유틸(verify-schema) 추가"
```

---

### Task 5: core — 검증 프롬프트 (`buildCliVerifyPrompt`)

**Files:**
- Modify: `src/core/prompt-template.ts` (파일 끝에 함수 추가)
- Test: `src/core/prompt-template.test.ts` (describe 블록 추가)

**Interfaces:**
- Produces (Task 6이 사용):

  ```ts
  export function buildCliVerifyPrompt(
    topicName: string,
    items: Array<{ index: number; question: unknown }>,
    resultPath: string,
  ): string;
  ```

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/prompt-template.test.ts`에 추가 (import에 `buildCliVerifyPrompt` 추가):

```ts
describe("buildCliVerifyPrompt", () => {
  const items = [
    {
      index: 0,
      question: {
        type: "mcq",
        question: "리눅스 커널을 만든 사람은?",
        choices: ["리누스 토르발스", "데니스 리치", "켄 톰프슨", "빌 게이츠"],
        answer_index: 0,
      },
    },
    { index: 2, question: { type: "cloze", text: "{{1}}는 OS다." } },
  ];

  it("주제명·판정 기준·출력 규격·저장 경로를 포함한다", () => {
    const prompt = buildCliVerifyPrompt("리눅스 기초", items, "D:\\v.json");
    expect(prompt).toContain('"리눅스 기초"');
    expect(prompt).toContain("정답 정확성");
    expect(prompt).toContain("answer_index");
    expect(prompt).toContain('"verdicts"');
    expect(prompt).toContain("D:\\v.json");
    expect(prompt).toContain("stdout에 출력하지 마세요");
  });

  it("각 문제를 index 번호와 JSON 내용으로 나열한다", () => {
    const prompt = buildCliVerifyPrompt("리눅스 기초", items, "D:\\v.json");
    expect(prompt).toContain("### 문제 0");
    expect(prompt).toContain("### 문제 2");
    expect(prompt).toContain("리눅스 커널을 만든 사람은?");
    expect(prompt).toContain("리누스 토르발스");
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/core/prompt-template.test.ts`
Expected: FAIL — `buildCliVerifyPrompt is not a function` 류

- [ ] **Step 3: 구현**

`src/core/prompt-template.ts` 끝에 추가:

```ts
export function buildCliVerifyPrompt(
  topicName: string,
  items: Array<{ index: number; question: unknown }>,
  resultPath: string,
): string {
  const listing = items
    .map(
      (item) =>
        `### 문제 ${item.index}\n\n\`\`\`json\n${JSON.stringify(item.question, null, 2)}\n\`\`\``,
    )
    .join("\n\n");

  return `당신은 학습용 문제 검수 전문가입니다. 주제 "${topicName}"에 대해 생성된 아래 문제들을 검증해 주세요.

## 판정 기준

각 문제를 다음 기준으로 판정하세요. 하나라도 어긋나면 "fail"입니다.

1. 정답 정확성: 정답이 사실적으로 정확한가? mcq는 answer_index가 가리키는 보기가 실제 정답인가? cloze는 빈칸 정답 단어가 문맥상 올바른가?
2. 문제 품질: 질문이 명확하고 모호하지 않은가? mcq 보기 중 정답으로 볼 수 있는 것이 2개 이상은 아닌가? 해설(explanation)이 정답과 모순되지 않는가?

## 검증 대상 문제

${listing}

## 출력 형식

다른 설명 없이 아래 구조의 JSON만 작성하세요. 위의 모든 문제에 대해 verdict를 하나씩 내야 합니다.

{
  "verdicts": [
    { "index": 0, "verdict": "pass", "comment": "" },
    { "index": 1, "verdict": "fail", "comment": "간결한 사유" }
  ]
}

- index는 위 "문제 N" 제목의 N을 그대로 사용하세요.
- verdict는 "pass" 또는 "fail"만 허용됩니다.
- comment는 fail이면 사유를 반드시 적고, pass면 빈 문자열이나 짧은 의견을 적으세요.

## 결과 저장 (반드시 준수)

- 결과 JSON을 stdout에 출력하지 마세요.
- 결과 JSON은 다음 경로에 UTF-8 텍스트 파일로만 저장하세요: ${resultPath}
- 파일 내용은 위 출력 형식의 JSON만 포함해야 하며, 코드 펜스나 설명 문장을 추가하지 마세요.
`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/core/prompt-template.test.ts`
Expected: PASS

- [ ] **Step 5: core 전체 테스트로 회귀 확인**

Run: `npx vitest run src/core`
Expected: 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/core/prompt-template.ts src/core/prompt-template.test.ts
git commit -m "feat: 교차 검증용 CLI 프롬프트(buildCliVerifyPrompt) 추가"
```

---

### Task 6: server — run-engine 파일 접두사 + generation-service 2단계 확장

서비스 계층은 프로젝트 규약대로 자동 테스트 없음 (Task 10에서 수동 검증).

**Files:**
- Modify: `src/server/generation/run-engine.ts`
- Modify: `src/server/generation/generation-service.ts` (전체 교체 수준)
- Modify: `src/lib/api-types.ts` (Task 7보다 먼저 필요 — 서비스가 DTO 타입을 참조)

**Interfaces:**
- Consumes: Task 1의 Prisma 필드, Task 2·3·4·5의 core 함수
- Produces:
  - `runEngine(engine, prompt, jobId, filePrefix?: string)` — `filePrefix`가 있으면 `verify-prompt.md`/`verify-result.json`/`verify-stdout.log`/`verify-stderr.log`로 기록
  - `createJob({ topicId, engine, verifyEngine, instructions })` — Task 8의 라우트가 호출
  - DTO: `GenerationStatusDto`에 `"VERIFYING"`, `GenerationItemDto` ok:true 가지에 `verdict`/`verdictComment`, `GenerationJobDto`에 `verifyEngine`/`verifyWarning`

- [ ] **Step 1: DTO 확장**

`src/lib/api-types.ts`의 generation 부분(78-94행)을 다음으로 교체:

```ts
export type GenerationEngineDto = "CLAUDE" | "CODEX" | "ANTIGRAVITY";
export type GenerationStatusDto =
  | "RUNNING"
  | "VERIFYING"
  | "SUCCEEDED"
  | "FAILED";
export type GenerationVerdictDto = "pass" | "fail" | "unverified";

export type GenerationItemDto =
  | {
      index: number;
      ok: true;
      question: unknown;
      verdict: GenerationVerdictDto;
      verdictComment: string | null;
    }
  | { index: number; ok: false; errors: string[] };

export interface GenerationJobDto {
  id: number;
  topicId: number;
  engine: GenerationEngineDto;
  verifyEngine: GenerationEngineDto;
  status: GenerationStatusDto;
  items: GenerationItemDto[] | null;
  errorMessage: string | null;
  verifyWarning: string | null;
  createdAt: string;
  finishedAt: string | null;
}
```

- [ ] **Step 2: run-engine에 filePrefix 추가**

`src/server/generation/run-engine.ts`에서:

시그니처 변경 (34-38행):

```ts
export async function runEngine(
  engine: EngineName,
  prompt: string,
  jobId: number,
  filePrefix = "",
): Promise<EngineRunResult> {
```

파일 경로 4곳에 접두사 적용:

```ts
  const promptPath = path.join(dir, `${filePrefix}prompt.md`);
  const resultPath = path.join(dir, `${filePrefix}result.json`);
```

```ts
  await writeFile(path.join(dir, `${filePrefix}stdout.log`), stdout, "utf-8").catch(
    () => undefined,
  );
  await writeFile(path.join(dir, `${filePrefix}stderr.log`), stderr, "utf-8").catch(
    () => undefined,
  );
```

result.json 미생성 메시지에도 접두사 반영:

```ts
      failureReason: `${filePrefix}result.json이 생성되지 않았습니다 (exit_code=${exit.code ?? "unknown"})${logTail ? `; ${logTail}` : ""}`,
```

- [ ] **Step 3: generation-service 2단계 확장**

`src/server/generation/generation-service.ts` 전체를 다음으로 교체:

```ts
import path from "node:path";
import type { GenerationJob, Prisma } from "@prisma/client";
import { parseImportJson } from "@/core/import-schema";
import { extractJsonObject } from "@/core/json-extract";
import {
  buildCliGenerationPrompt,
  buildCliVerifyPrompt,
  type ExistingQuestions,
} from "@/core/prompt-template";
import { capSummaries, summarizeQuestionPayload } from "@/core/question-summary";
import { mergeVerdicts, parseVerifyJson } from "@/core/verify-schema";
import type { GenerationEngineDto, GenerationJobDto } from "@/lib/api-types";
import { prisma } from "../db";
import { ServiceError } from "../errors";
import { generationTimeoutMs, jobOutputDir, runEngine } from "./run-engine";

const ORPHAN_GRACE_MS = 60_000;
const EXISTING_QUESTION_LIMIT = 100;

function toDto(job: GenerationJob): GenerationJobDto {
  return {
    id: job.id,
    topicId: job.topicId,
    engine: job.engine,
    verifyEngine: job.verifyEngine,
    status: job.status,
    items:
      job.status === "SUCCEEDED"
        ? (job.result as unknown as GenerationJobDto["items"])
        : null,
    errorMessage: job.errorMessage,
    verifyWarning: job.verifyWarning,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

async function loadExistingQuestions(
  topicId: number,
): Promise<ExistingQuestions> {
  const [total, questions] = await Promise.all([
    prisma.question.count({ where: { topicId } }),
    prisma.question.findMany({
      where: { topicId },
      orderBy: { createdAt: "desc" },
      take: EXISTING_QUESTION_LIMIT,
      select: { type: true, payload: true },
    }),
  ]);
  const capped = capSummaries(
    questions.map((question) =>
      summarizeQuestionPayload(question.type, question.payload),
    ),
  );
  return {
    summaries: capped.kept,
    truncated: capped.truncated || total > EXISTING_QUESTION_LIMIT,
  };
}

export async function createJob(input: {
  topicId: number;
  engine: GenerationEngineDto;
  verifyEngine: GenerationEngineDto;
  instructions: string;
}): Promise<GenerationJobDto> {
  const topic = await prisma.topic.findUnique({ where: { id: input.topicId } });
  if (!topic) {
    throw new ServiceError("TOPIC_NOT_FOUND", "주제를 찾을 수 없습니다", 404);
  }

  const running = await prisma.generationJob.findFirst({
    where: { topicId: input.topicId, status: { in: ["RUNNING", "VERIFYING"] } },
  });
  if (running) {
    throw new ServiceError(
      "JOB_ALREADY_RUNNING",
      "이미 생성 중인 작업이 있습니다",
      409,
    );
  }

  const existing = await loadExistingQuestions(input.topicId);

  const job = await prisma.generationJob.create({
    data: {
      topicId: input.topicId,
      engine: input.engine,
      verifyEngine: input.verifyEngine,
      instructions: input.instructions,
    },
  });

  void runJob(job.id, topic.name, input.instructions, existing).catch((e) => {
    console.error(`generation job ${job.id} failed unexpectedly`, e);
  });

  return toDto(job);
}

async function runJob(
  jobId: number,
  topicName: string,
  instructions: string,
  existing: ExistingQuestions,
): Promise<void> {
  const dir = jobOutputDir(jobId);
  const resultPath = path.join(dir, "result.json");
  const prompt = buildCliGenerationPrompt(
    topicName,
    instructions,
    resultPath,
    existing,
  );

  const job = await prisma.generationJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RUNNING") return;

  const run = await runEngine(job.engine, prompt, jobId);
  if (!run.ok) {
    await failJob(jobId, run.failureReason, null);
    return;
  }

  const parsed = parseImportJson(extractJsonObject(run.resultText));
  if (!parsed.ok) {
    await failJob(
      jobId,
      `${parsed.fatal}; 원문 앞 300자: ${run.resultText.slice(0, 300)}`,
      run.resultText,
    );
    return;
  }

  // 이 시점의 verdict는 전부 unverified — 검증이 끝나면 덮어쓴다.
  const unverifiedItems = mergeVerdicts(parsed.items, []);
  const validItems = parsed.items.filter((item) => item.ok);

  if (validItems.length === 0) {
    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: "SUCCEEDED",
        result: unverifiedItems as unknown as Prisma.InputJsonValue,
        rawOutput: run.resultText,
        finishedAt: new Date(),
      },
    });
    return;
  }

  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "VERIFYING",
      result: unverifiedItems as unknown as Prisma.InputJsonValue,
      rawOutput: run.resultText,
    },
  });

  const verifyResultPath = path.join(dir, "verify-result.json");
  const verifyPrompt = buildCliVerifyPrompt(
    topicName,
    validItems.map((item) => ({ index: item.index, question: item.question })),
    verifyResultPath,
  );

  let finalItems = unverifiedItems;
  let verifyWarning: string | null = null;

  const verifyRun = await runEngine(job.verifyEngine, verifyPrompt, jobId, "verify-");
  if (!verifyRun.ok) {
    verifyWarning = verifyRun.failureReason;
  } else {
    const verdicts = parseVerifyJson(extractJsonObject(verifyRun.resultText));
    if (!verdicts.ok) {
      verifyWarning = `검증 결과를 해석하지 못했습니다: ${verdicts.fatal}`;
    } else {
      finalItems = mergeVerdicts(parsed.items, verdicts.verdicts);
    }
  }

  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      result: finalItems as unknown as Prisma.InputJsonValue,
      verifyWarning,
      finishedAt: new Date(),
    },
  });
}

async function failJob(
  jobId: number,
  message: string,
  rawOutput: string | null,
): Promise<void> {
  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      errorMessage: message,
      rawOutput,
      finishedAt: new Date(),
    },
  });
}

export async function getJob(id: number): Promise<GenerationJobDto> {
  const job = await prisma.generationJob.findUnique({ where: { id } });
  if (!job) {
    throw new ServiceError("JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다", 404);
  }

  // 생성·검증 단계가 각각 타임아웃을 가지므로 고아 판정 기준은 2배 + 유예.
  const orphanAfterMs = 2 * generationTimeoutMs() + ORPHAN_GRACE_MS;
  const isStale = Date.now() - job.createdAt.getTime() > orphanAfterMs;

  if (job.status === "RUNNING" && isStale) {
    const updated = await prisma.generationJob.update({
      where: { id },
      data: {
        status: "FAILED",
        errorMessage: "시간 초과 또는 서버 재시작으로 중단되었습니다",
        finishedAt: new Date(),
      },
    });
    return toDto(updated);
  }

  if (job.status === "VERIFYING" && isStale) {
    // 생성 결과(전 항목 unverified)는 VERIFYING 전환 시점에 이미 저장돼 있다.
    const updated = await prisma.generationJob.update({
      where: { id },
      data: {
        status: "SUCCEEDED",
        verifyWarning: "시간 초과 또는 서버 재시작으로 검증이 중단되었습니다",
        finishedAt: new Date(),
      },
    });
    return toDto(updated);
  }

  return toDto(job);
}
```

주의: 같은 주제 중복 실행 방지 조건이 `status: "RUNNING"` 단건 비교에서 `status: { in: ["RUNNING", "VERIFYING"] }`로 바뀐다 — VERIFYING 중에도 새 잡을 막아야 한다.

- [ ] **Step 4: 타입 검사**

Run: `npx tsc --noEmit`
Expected: `src/app/api/generate/route.ts`와 `src/lib/api-client.ts`, `src/app/generate/page.tsx`에서 `verifyEngine` 누락 오류가 날 수 있다 — Task 7·8에서 해소되므로, 이 파일들 외의 오류가 없는지만 확인. (오류가 이 범위뿐이면 통과로 간주)

- [ ] **Step 5: 커밋**

```bash
git add src/server/generation/ src/lib/api-types.ts
git commit -m "feat: 생성 잡에 교차 검증 단계와 기존 문제 중복 방지 적용"
```

---

### Task 7: API 라우트 + api-client 확장

**Files:**
- Modify: `src/app/api/generate/route.ts` (zod 스키마)
- Modify: `src/lib/api-client.ts` (`api.generate.create` 입력 타입)

**Interfaces:**
- Consumes: Task 6의 `createJob` 시그니처
- Produces: `api.generate.create({ topicId, engine, verifyEngine, instructions })` — Task 8의 화면이 사용

- [ ] **Step 1: 라우트 zod 스키마에 verifyEngine 추가**

`src/app/api/generate/route.ts`의 `createSchema`를 다음으로 교체:

```ts
const createSchema = z.object({
  topicId: z.number().int().positive(),
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
  verifyEngine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
  instructions: z.string().max(4000),
});
```

- [ ] **Step 2: api-client 입력 타입 확장**

`src/lib/api-client.ts`의 `generate.create`를 다음으로 교체:

```ts
    create: (input: {
      topicId: number;
      engine: GenerationEngineDto;
      verifyEngine: GenerationEngineDto;
      instructions: string;
    }) =>
      request<{ job: GenerationJobDto }>("/api/generate", {
        method: "POST",
        body: JSON.stringify(input),
      }),
```

- [ ] **Step 3: 커밋**

```bash
git add src/app/api/generate/route.ts src/lib/api-client.ts
git commit -m "feat: 생성 API에 검증 엔진(verifyEngine) 입력 추가"
```

---

### Task 8: 화면 — 검증 엔진 선택, VERIFYING 표시, 검증 배지

**Files:**
- Modify: `src/app/generate/page.tsx`

**Interfaces:**
- Consumes: Task 6의 DTO(`verdict`/`verdictComment`/`verifyWarning`/`VERIFYING`), Task 7의 `api.generate.create`

- [ ] **Step 1: 상태·핸들러 추가**

`src/app/generate/page.tsx`에서 기존 `const [engine, setEngine] = ...` 아래에 추가:

```ts
  const [verifyEngine, setVerifyEngine] = useState<GenerationEngineDto>("CODEX");
  const [verifyTouched, setVerifyTouched] = useState(false);
```

컴포넌트 안에 핸들러 2개 추가 (생성 엔진 변경 시 사용자가 직접 고르기 전까지는 검증 기본값을 "생성 엔진과 다른 것"으로 따라가게 한다):

```ts
  function selectEngine(value: GenerationEngineDto) {
    setEngine(value);
    if (!verifyTouched) {
      setVerifyEngine(value === "CLAUDE" ? "CODEX" : "CLAUDE");
    }
  }

  function selectVerifyEngine(value: GenerationEngineDto) {
    setVerifyEngine(value);
    setVerifyTouched(true);
  }
```

기존 생성 엔진 라디오의 `onChange={() => setEngine(item.value)}`를 `onChange={() => selectEngine(item.value)}`로 바꾼다.

- [ ] **Step 2: 진행 상태를 RUNNING/VERIFYING 둘 다로 확장**

`const running = job?.status === "RUNNING";`을 다음으로 교체:

```ts
  const inProgress = job?.status === "RUNNING" || job?.status === "VERIFYING";
```

파일 내 `running` 사용처(버튼 disabled, `startGeneration`의 가드)를 모두 `inProgress`로 바꾼다.

폴링 effect의 첫 줄과 갱신 조건을 교체:

```ts
  useEffect(() => {
    if (!job || (job.status !== "RUNNING" && job.status !== "VERIFYING")) return;
    const startedAt = new Date(job.createdAt).getTime();
    const timer = setInterval(async () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
      try {
        const { job: next } = await api.generate.get(job.id);
        if (next.status !== job.status) {
          setJob(next);
          if (next.status === "SUCCEEDED" && next.items) {
            setSelected(
              new Set(
                next.items
                  .filter((item) => item.ok && item.verdict !== "fail")
                  .map((item) => item.index),
              ),
            );
          }
        }
      } catch {
        // 폴링 일시 오류는 다음 주기에 재시도한다.
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [job]);
```

(상태가 `RUNNING → VERIFYING`으로 바뀌면 `setJob(next)`로 effect가 재실행되어 폴링이 이어진다. 검증 fail 항목은 기본 체크 해제.)

생성 버튼 라벨 교체:

```tsx
        <button
          onClick={startGeneration}
          disabled={topicId === "" || starting || inProgress}
          className="rounded bg-sky-600 px-4 py-2 font-semibold disabled:opacity-50"
        >
          {job?.status === "VERIFYING"
            ? `검증 중... (경과 ${elapsed}초)`
            : inProgress
              ? `생성 중... (경과 ${elapsed}초)`
              : "생성 시작"}
        </button>
```

`startGeneration`의 `api.generate.create` 호출에 `verifyEngine` 추가:

```ts
      const { job: created } = await api.generate.create({
        topicId,
        engine,
        verifyEngine,
        instructions,
      });
```

- [ ] **Step 3: 검증 엔진 라디오 UI 추가**

"2. 엔진과 추가 지시" 섹션에서 기존 생성 엔진 라디오 `<div className="flex flex-wrap gap-4">...</div>` 바로 아래에 추가:

```tsx
        <div>
          <p className="mb-1 text-sm text-slate-400">
            검증 엔진 — 생성된 문제를 다른 CLI로 교차 검증합니다
          </p>
          <div className="flex flex-wrap gap-4">
            {ENGINES.map((item) => (
              <label key={item.value} className="flex items-center gap-2">
                <input
                  type="radio"
                  name="verifyEngine"
                  checked={verifyEngine === item.value}
                  onChange={() => selectVerifyEngine(item.value)}
                />
                {item.label}
              </label>
            ))}
          </div>
        </div>
```

- [ ] **Step 4: 미리보기에 검증 배지·의견·경고 추가**

"4. 미리보기 및 저장" 섹션에서:

(a) `<h2>` 바로 아래에 verifyWarning 배너 추가:

```tsx
          {job.verifyWarning && (
            <p className="rounded border border-amber-800 bg-amber-950/40 p-3 text-sm text-amber-300">
              ⚠️ 검증을 수행하지 못했습니다: {job.verifyWarning}
            </p>
          )}
```

(b) 카드 헤더의 유형 배지(`객관식`/`빈칸` span) 바로 다음에 검증 배지 추가 (`item.ok ? (<>` 분기 안):

```tsx
                    {item.verdict === "pass" && (
                      <span className="rounded bg-emerald-900 px-1.5 py-0.5 text-xs text-emerald-300">
                        ✅ 검증 통과
                      </span>
                    )}
                    {item.verdict === "fail" && (
                      <span className="rounded bg-amber-900 px-1.5 py-0.5 text-xs text-amber-300">
                        ⚠️ 검증 의견
                      </span>
                    )}
                    {item.verdict === "unverified" && (
                      <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs text-slate-400">
                        검증 안 됨
                      </span>
                    )}
```

(c) `<QuestionPreview ... />` 바로 아래(같은 `item.ok` 분기)에 검증 의견 표시 추가 — JSX상 형제가 되므로 해당 분기를 fragment로 감싼다:

```tsx
              {item.ok ? (
                <>
                  <QuestionPreview question={item.question as ImportQuestion} />
                  {item.verdict === "fail" && item.verdictComment && (
                    <p className="mt-2 rounded border border-amber-800 bg-amber-950/40 p-2 text-sm text-amber-200">
                      ⚠️ {item.verdictComment}
                    </p>
                  )}
                  {item.verdict === "pass" && item.verdictComment && (
                    <p className="mt-2 text-xs text-slate-500">
                      {item.verdictComment}
                    </p>
                  )}
                </>
              ) : (
                <ul className="list-inside list-disc text-sm text-red-300">
                  {item.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              )}
```

(else 분기는 기존 코드와 동일 — 변경 없음)

- [ ] **Step 5: 타입 검사 + core 회귀**

Run: `npx tsc --noEmit`
Expected: 오류 없음 (Task 6 Step 4에서 유예했던 오류가 모두 해소되어야 함)

Run: `npx vitest run`
Expected: 전부 PASS

- [ ] **Step 6: 커밋**

```bash
git add src/app/generate/page.tsx
git commit -m "feat: /generate에 검증 엔진 선택과 검증 결과 배지 표시 추가"
```

---

### Task 9: README 사용 안내 갱신

**Files:**
- Modify: `README.md` ("## AI 문제 생성 (/generate)" 섹션, 53-60행)

- [ ] **Step 1: 안내 문구 추가**

기존 섹션의 불릿 목록에 다음 2줄을 추가한다 (지원 엔진 불릿 아래):

```markdown
- 교차 검증: 생성 직후 화면에서 선택한 검증 엔진 CLI가 정답 정확성·문제 품질을 판정합니다. 불합격(⚠️) 문제는 미리보기에서 기본 체크가 해제되며, 최종 저장 여부는 사람이 결정합니다. 검증 자체가 실패해도 생성 결과는 유지됩니다("검증 안 됨" 표시).
- 중복 방지: 같은 주제의 기존 문제 목록(최신 100개, 8,000자 한도)을 생성 프롬프트에 포함해 중복 출제를 예방합니다.
```

또한 "흐름:" 불릿을 다음으로 교체:

```markdown
- 흐름: 주제·추가 지시 입력 -> 잡 생성(202) -> 3초 폴링(생성 중 -> 검증 중) -> 미리보기에서 선택 -> 기존 가져오기 API로 저장.
```

- [ ] **Step 2: 커밋**

```bash
git add README.md
git commit -m "docs: AI 생성 교차 검증·중복 방지 사용 안내 추가"
```

---

### Task 10: 수동 검증 (서비스·화면)

**Files:** 없음 (검증만)

- [ ] **Step 1: 개발 서버 실행**

Run: `npm run dev` (백그라운드)

- [ ] **Step 2: 정상 경로 확인**

브라우저에서 `/generate` 접속 후:

1. 문제가 이미 몇 개 있는 주제 선택
2. 생성 엔진 claude, 검증 엔진 기본값이 codex로 잡혀 있는지 확인. 생성 엔진을 codex로 바꾸면 검증 기본값이 claude로 따라 바뀌는지 확인
3. "쉬운 난이도로 3문제"로 생성 시작 → 버튼이 "생성 중..." → "검증 중..."으로 바뀌는지 확인
4. 미리보기에서 ✅ 검증 통과 / ⚠️ 검증 의견 배지 확인, ⚠️ 항목은 기본 체크 해제 확인
5. 선택 저장 → "✅ N개 문제를 저장했습니다"
6. `generation_output/jobs/<id>/`에 `prompt.md`, `result.json`, `verify-prompt.md`, `verify-result.json` 생성 확인
7. `prompt.md`를 열어 "기존 문제 목록" 섹션에 해당 주제의 기존 문제가 들어갔는지 확인

- [ ] **Step 3: 검증 실패 경로 확인**

검증 엔진을 설치되지 않은 엔진(예: antigravity 미설치 시 antigravity)으로 선택해 생성 → SUCCEEDED로 끝나되 미리보기 상단에 "⚠️ 검증을 수행하지 못했습니다: ..." 배너와 전 항목 "검증 안 됨" 배지가 뜨는지 확인.

- [ ] **Step 4: 중복 실행 방지 확인**

생성이 도는 동안(RUNNING 또는 VERIFYING) 같은 주제로 다시 "생성 시작" → "이미 생성 중인 작업이 있습니다" 오류 확인.

- [ ] **Step 5: 이상 없으면 완료 보고**

문제 발견 시 해당 태스크로 돌아가 수정 후 `fix:` 커밋.
