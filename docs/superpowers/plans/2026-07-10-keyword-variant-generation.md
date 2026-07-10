# 키워드 매핑 + AI 변형 출제 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 설계서(`docs/superpowers/specs/2026-07-10-keyword-variant-generation-design.md`)에 정의된 키워드 매핑(AI 자동 부여 + 수동 교정 + 모아보기 + 키워드별 연습)과 AI 변형 출제를 구현한다.

**Architecture:** `Keyword`/`QuestionKeyword` 정규화 테이블 추가. 신규 문제는 생성/임포트 스키마의 `keywords` 필드로 자동 태깅, 기존 문제는 `GenerationJob.kind=KEYWORD_TAG` 잡으로 일괄 백필. 변형 출제는 `GenerationJob.sourceQuestionIds`에 원본 문제를 담아 기존 생성→검증→승인 파이프라인을 재사용한다.

**Tech Stack:** Next.js 16 (App Router, TypeScript), Prisma 7 + MariaDB, zod 4, vitest, Tailwind CSS

## Global Constraints

- **Node 22+, npm.** TypeScript strict, `any` 금지 — payload 캐스팅은 `as unknown as T`만 허용.
- **`src/core/`는 순수 TS** (Next.js/Prisma/Node API import 금지, zod 허용). **`src/server/`는 Next.js import 금지** (`src/server/http.ts` 예외).
- **Route Handler는 얇게**: zod 파싱 → 서비스 호출 → JSON 응답.
- **화면은 `src/lib/api-client.ts`의 `api` 객체만 사용** (fetch 직접 호출 금지).
- **문제 payload 키는 snake_case.** **UI 문구는 한국어, 피드백 문구의 이모지 유지(✅/❌/🎉 등).**
- **API 오류 응답**: `{ "error": { "code": string, "message": string } }`
- **커밋은 conventional commits, 메시지는 한국어** (`feat:`/`fix:`/`test:` 등 접두사는 영문). 태스크마다 1커밋.
- **테스트는 vitest**, 대상 파일 옆 `*.test.ts`. 서비스 계층(`src/server/`)은 자동 테스트를 두지 않는다(core 단위 테스트 + 수동 검증).
- 검증 명령의 `curl`은 PowerShell에서 `curl.exe`로 실행.

## 파일 구조 지도 (이번 작업 범위)

```
prisma/schema.prisma                          # 수정: Keyword, QuestionKeyword, GenerationJobKind, GenerationJob 컬럼
src/core/
  keyword.ts (+test)                          # 신규: 키워드 이름 정규화/중복 제거
  import-schema.ts (+test)                    # 수정: keywords 필드
  keyword-tag-schema.ts (+test)               # 신규: 백필 응답 파서
  prompt-template.ts (+test)                  # 수정: 키워드/변형 섹션, 백필 프롬프트
src/server/
  keyword-service.ts                          # 신규: 키워드 목록/추가/삭제/attachKeywords
  import-service.ts                           # 수정: 저장 시 키워드 연결
  question-service.ts                         # 수정: keywordId 필터, 상세에 keywords
  study-service.ts                            # 수정: practice 모드 keywordId
  generation/generation-service.ts            # 수정: 변형 출제, 키워드 주입, KEYWORD_TAG 잡
src/lib/
  api-types.ts                                # 수정: Keyword DTO, GenerationJob kind 등
  api-client.ts                               # 수정: keywords/generate/study 확장
src/app/api/
  keywords/route.ts                           # 신규: GET
  questions/[id]/keywords/route.ts            # 신규: POST
  questions/[id]/keywords/[keywordId]/route.ts# 신규: DELETE
  questions/route.ts                          # 수정: keywordId 파라미터
  study/queue/route.ts                        # 수정: keywordId 파라미터
  generate/route.ts                           # 수정: sourceQuestionIds
  generate/keyword-tag/route.ts               # 신규: POST
src/app/
  keywords/page.tsx                           # 신규: 키워드 모아보기
  questions/page.tsx                          # 수정: 키워드 필터 + 일괄 부여 진입점
  questions/[id]/page.tsx                     # 수정: 키워드 칩 + 변형 생성 버튼
  generate/page.tsx                           # 수정: kind 배지
  generate/new/page.tsx                       # 수정: 변형 파라미터
  generate/[id]/page.tsx                      # 수정: KEYWORD_TAG 승인 UI
  study/page.tsx                              # 수정: keywordId 연습
src/components/AppNav.tsx                     # 수정: "키워드" 링크
```

---

### Task 1: DB 스키마 + 키워드 정규화 core 모듈

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `src/core/keyword.ts`
- Test: `src/core/keyword.test.ts`

**Interfaces:**
- Produces: Prisma 모델 `Keyword`, `QuestionKeyword`, enum `GenerationJobKind`, `GenerationJob.kind`/`sourceQuestionIds`, `Question.keywords` 관계
- Produces: `normalizeKeywordName(raw: string): string`, `dedupeKeywordNames(names: string[]): string[]`, `KEYWORD_MAX_LENGTH = 50`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/keyword.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  dedupeKeywordNames,
  KEYWORD_MAX_LENGTH,
  normalizeKeywordName,
} from "./keyword";

describe("normalizeKeywordName", () => {
  it("양끝 공백을 제거한다", () => {
    expect(normalizeKeywordName("  TCP  ")).toBe("TCP");
  });

  it("연속 공백을 하나로 줄인다", () => {
    expect(normalizeKeywordName("서브넷   마스크")).toBe("서브넷 마스크");
  });

  it("탭/개행도 공백 하나로 정규화한다", () => {
    expect(normalizeKeywordName("서브넷\t\n마스크")).toBe("서브넷 마스크");
  });
});

describe("dedupeKeywordNames", () => {
  it("정규화 후 같은 이름은 하나만 남긴다", () => {
    expect(dedupeKeywordNames(["TCP", " TCP ", "UDP"])).toEqual(["TCP", "UDP"]);
  });

  it("빈 문자열과 공백만 있는 항목은 제외한다", () => {
    expect(dedupeKeywordNames(["", "   ", "TCP"])).toEqual(["TCP"]);
  });

  it("최대 길이를 넘는 이름은 제외한다", () => {
    expect(dedupeKeywordNames(["a".repeat(KEYWORD_MAX_LENGTH + 1)])).toEqual([]);
  });

  it("입력 순서를 유지한다", () => {
    expect(dedupeKeywordNames(["b", "a", "b"])).toEqual(["b", "a"]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/core/keyword.test.ts`
Expected: FAIL — `Cannot find module './keyword'`

- [ ] **Step 3: 구현**

`src/core/keyword.ts`:

```ts
export const KEYWORD_MAX_LENGTH = 50;

export function normalizeKeywordName(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

export function dedupeKeywordNames(names: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of names) {
    const name = normalizeKeywordName(raw);
    if (!name || name.length > KEYWORD_MAX_LENGTH) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/core/keyword.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Prisma 스키마 수정**

`prisma/schema.prisma`에 enum과 모델을 추가하고 기존 모델에 관계/컬럼을 더한다.

`GenerationStatus` enum 아래에 추가:

```prisma
enum GenerationJobKind {
  QUESTION
  KEYWORD_TAG
}
```

`Question` 모델의 `answerExplanations AnswerExplanation[]` 줄 아래에 추가:

```prisma
  keywords           QuestionKeyword[]
```

`GenerationJob` 모델의 `referenceFiles` 줄 아래에 추가:

```prisma
  kind              GenerationJobKind @default(QUESTION)
  sourceQuestionIds Json?             @map("source_question_ids")
```

파일 끝(`AnswerExplanation` 모델 아래)에 추가:

```prisma
model Keyword {
  id        Int               @id @default(autoincrement())
  name      String            @unique @db.VarChar(50)
  createdAt DateTime          @default(now()) @map("created_at")
  questions QuestionKeyword[]

  @@map("keyword")
}

model QuestionKeyword {
  questionId Int      @map("question_id")
  keywordId  Int      @map("keyword_id")
  question   Question @relation(fields: [questionId], references: [id], onDelete: Cascade)
  keyword    Keyword  @relation(fields: [keywordId], references: [id], onDelete: Cascade)

  @@id([questionId, keywordId])
  @@map("question_keyword")
}
```

- [ ] **Step 6: 마이그레이션 실행**

Run: `npx prisma migrate dev --name add_keyword_and_job_kind`
Expected: 마이그레이션 생성·적용, `prisma generate` 자동 실행. `npx tsc --noEmit` 통과 확인.

- [ ] **Step 7: 커밋**

```bash
git add prisma/ src/core/keyword.ts src/core/keyword.test.ts
git commit -m "feat: 키워드 스키마와 이름 정규화 모듈 추가"
```

---

### Task 2: 임포트 스키마 keywords 필드 + 백필 응답 파서

**Files:**
- Modify: `src/core/import-schema.ts`
- Create: `src/core/keyword-tag-schema.ts`
- Test: `src/core/import-schema.test.ts` (케이스 추가), `src/core/keyword-tag-schema.test.ts`

**Interfaces:**
- Consumes: `KEYWORD_MAX_LENGTH`, `dedupeKeywordNames` (Task 1)
- Produces: `ImportQuestion`에 `keywords?: string[]` 필드 (mcq/cloze 공통)
- Produces: `parseKeywordTagJson(rawText: string): KeywordTagParseResult`, `KeywordAssignment { id: number; keywords: string[] }`

- [ ] **Step 1: 실패하는 테스트 작성 — import-schema**

`src/core/import-schema.test.ts`에 describe 블록 추가:

```ts
describe("keywords 필드", () => {
  const baseMcq = {
    type: "mcq",
    question: "질문",
    choices: ["a", "b", "c", "d"],
    answer_index: 0,
  };

  it("keywords가 있으면 통과하고 값을 유지한다", () => {
    const result = importMcqSchema.safeParse({
      ...baseMcq,
      keywords: ["TCP", "3-way handshake"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.keywords).toEqual(["TCP", "3-way handshake"]);
    }
  });

  it("keywords가 없어도 통과한다", () => {
    expect(importMcqSchema.safeParse(baseMcq).success).toBe(true);
  });

  it("keywords가 6개 이상이면 거부한다", () => {
    const result = importMcqSchema.safeParse({
      ...baseMcq,
      keywords: ["1", "2", "3", "4", "5", "6"],
    });
    expect(result.success).toBe(false);
  });

  it("빈 문자열 키워드는 거부한다", () => {
    const result = importMcqSchema.safeParse({ ...baseMcq, keywords: ["  "] });
    expect(result.success).toBe(false);
  });

  it("50자를 넘는 키워드는 거부한다", () => {
    const result = importMcqSchema.safeParse({
      ...baseMcq,
      keywords: ["a".repeat(51)],
    });
    expect(result.success).toBe(false);
  });
});
```

(파일 상단 import에 `importMcqSchema`가 이미 없다면 추가한다.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/core/import-schema.test.ts`
Expected: FAIL — keywords가 스키마에 없어 `result.data.keywords`가 undefined이거나 unknown key 통과로 어긋남

- [ ] **Step 3: import-schema 구현**

`src/core/import-schema.ts` 상단에 import 추가:

```ts
import { KEYWORD_MAX_LENGTH } from "./keyword";
```

`PLACEHOLDER_RE` 선언 아래에 공용 필드 정의:

```ts
const keywordListSchema = z
  .array(nonBlank.max(KEYWORD_MAX_LENGTH, `키워드는 ${KEYWORD_MAX_LENGTH}자 이하여야 합니다`))
  .max(5, "키워드는 최대 5개입니다")
  .optional();
```

`importMcqSchema`/`importClozeSchema`의 `.extend({...})`에 각각 `keywords: keywordListSchema` 추가:

```ts
export const importMcqSchema = mcqBase
  .extend({
    type: z.literal("mcq"),
    explanation: z.string().optional(),
    keywords: keywordListSchema,
  })
  .superRefine(refineMcq);

export const importClozeSchema = clozeBase
  .extend({
    type: z.literal("cloze"),
    explanation: z.string().optional(),
    keywords: keywordListSchema,
  })
  .superRefine(refineCloze);
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/core/import-schema.test.ts`
Expected: PASS (기존 + 신규 5 케이스)

- [ ] **Step 5: 실패하는 테스트 작성 — keyword-tag-schema**

`src/core/keyword-tag-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseKeywordTagJson } from "./keyword-tag-schema";

describe("parseKeywordTagJson", () => {
  it("정상 JSON을 파싱한다", () => {
    const result = parseKeywordTagJson(
      JSON.stringify({
        assignments: [{ id: 3, keywords: ["TCP", " TCP ", "UDP"] }],
      }),
    );
    expect(result).toEqual({
      ok: true,
      assignments: [{ id: 3, keywords: ["TCP", "UDP"] }],
    });
  });

  it("JSON이 아니면 fatal을 반환한다", () => {
    expect(parseKeywordTagJson("not json")).toEqual({
      ok: false,
      fatal: "올바른 JSON이 아닙니다",
    });
  });

  it("assignments 배열이 없으면 fatal을 반환한다", () => {
    expect(parseKeywordTagJson("{}")).toEqual({
      ok: false,
      fatal: "최상위에 assignments 배열이 있어야 합니다",
    });
  });

  it("형식이 어긋난 항목은 건너뛴다", () => {
    const result = parseKeywordTagJson(
      JSON.stringify({
        assignments: [
          { id: "x", keywords: ["a"] },
          { id: 2, keywords: [] },
          { id: 3, keywords: ["ok"] },
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      assignments: [{ id: 3, keywords: ["ok"] }],
    });
  });

  it("정규화 후 키워드가 모두 사라진 항목은 건너뛴다", () => {
    const result = parseKeywordTagJson(
      JSON.stringify({ assignments: [{ id: 1, keywords: ["   "] }] }),
    );
    expect(result).toEqual({ ok: true, assignments: [] });
  });
});
```

- [ ] **Step 6: 테스트 실패 확인**

Run: `npx vitest run src/core/keyword-tag-schema.test.ts`
Expected: FAIL — `Cannot find module './keyword-tag-schema'`

- [ ] **Step 7: keyword-tag-schema 구현**

`src/core/keyword-tag-schema.ts`:

```ts
import { z } from "zod";
import { dedupeKeywordNames } from "./keyword";

const assignmentSchema = z.object({
  id: z.number().int().positive(),
  keywords: z.array(z.string()).min(1).max(5),
});

export interface KeywordAssignment {
  id: number;
  keywords: string[];
}

export type KeywordTagParseResult =
  | { ok: true; assignments: KeywordAssignment[] }
  | { ok: false; fatal: string };

export function parseKeywordTagJson(rawText: string): KeywordTagParseResult {
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    return { ok: false, fatal: "올바른 JSON이 아닙니다" };
  }

  const assignments =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>).assignments
      : undefined;
  if (!Array.isArray(assignments)) {
    return { ok: false, fatal: "최상위에 assignments 배열이 있어야 합니다" };
  }

  const parsed: KeywordAssignment[] = [];
  for (const raw of assignments) {
    const result = assignmentSchema.safeParse(raw);
    // 형식이 어긋난 항목은 건너뛴다 — 나머지 문제의 부여는 살린다.
    if (!result.success) continue;
    const keywords = dedupeKeywordNames(result.data.keywords);
    if (keywords.length === 0) continue;
    parsed.push({ id: result.data.id, keywords });
  }
  return { ok: true, assignments: parsed };
}
```

- [ ] **Step 8: 전체 core 테스트 통과 확인**

Run: `npx vitest run src/core`
Expected: PASS

- [ ] **Step 9: 커밋**

```bash
git add src/core/import-schema.ts src/core/import-schema.test.ts src/core/keyword-tag-schema.ts src/core/keyword-tag-schema.test.ts
git commit -m "feat: 임포트 스키마 keywords 필드와 백필 응답 파서 추가"
```

---

### Task 3: 프롬프트 템플릿 확장

**Files:**
- Modify: `src/core/prompt-template.ts`
- Test: `src/core/prompt-template.test.ts` (케이스 추가)

**Interfaces:**
- Produces: `existingKeywordsSection(names: string[]): string`
- Produces: `VariantSource { question: string }`
- Produces: `buildCliGenerationPrompt(topicName, instructions, resultPath, existing, referenceFiles = [], existingKeywords: string[] = [], variantSources: VariantSource[] = [])` — 뒤 2개 인자 신규(기존 호출부는 그대로 동작)
- Produces: `buildCliKeywordTagPrompt(topicName: string, questions: Array<{ id: number; summary: string }>, existingKeywords: string[], resultPath: string): string`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/prompt-template.test.ts`에 케이스 추가:

```ts
describe("키워드/변형 확장", () => {
  const existing = { summaries: [], truncated: false };

  it("출력 형식 예시에 keywords 필드가 포함된다", () => {
    const prompt = buildCliGenerationPrompt("주제", "", "/tmp/r.json", existing);
    expect(prompt).toContain('"keywords"');
  });

  it("existingKeywords가 있으면 키워드 규칙 섹션과 목록이 포함된다", () => {
    const prompt = buildCliGenerationPrompt(
      "주제", "", "/tmp/r.json", existing, [], ["TCP", "UDP"],
    );
    expect(prompt).toContain("## 키워드 규칙");
    expect(prompt).toContain("- TCP");
    expect(prompt).toContain("- UDP");
  });

  it("existingKeywords가 비어 있으면 키워드 규칙 섹션이 없다", () => {
    const prompt = buildCliGenerationPrompt("주제", "", "/tmp/r.json", existing);
    expect(prompt).not.toContain("## 키워드 규칙");
  });

  it("variantSources가 있으면 변형 출제 섹션에 원본 JSON이 포함된다", () => {
    const prompt = buildCliGenerationPrompt(
      "주제", "", "/tmp/r.json", existing, [], [],
      [{ question: '{"type":"mcq","question":"원본Q"}' }],
    );
    expect(prompt).toContain("## 변형 출제 (원본 문제)");
    expect(prompt).toContain("원본Q");
    expect(prompt).toContain("표현만 바꾼 문제는 금지");
  });

  it("buildCliKeywordTagPrompt가 문제 목록·기존 키워드·저장 경로를 포함한다", () => {
    const prompt = buildCliKeywordTagPrompt(
      "네트워크",
      [{ id: 7, summary: "TCP 연결 수립 절차는?" }],
      ["TCP"],
      "/tmp/result.json",
    );
    expect(prompt).toContain("(id=7)");
    expect(prompt).toContain("TCP 연결 수립 절차는?");
    expect(prompt).toContain("## 키워드 규칙");
    expect(prompt).toContain('"assignments"');
    expect(prompt).toContain("/tmp/result.json");
    expect(prompt).toContain("stdout에 출력하지 마세요");
  });
});
```

(파일 상단 import에 `buildCliKeywordTagPrompt` 추가.)

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/core/prompt-template.test.ts`
Expected: FAIL — `buildCliKeywordTagPrompt` 미존재 / keywords 미포함

- [ ] **Step 3: 구현**

`src/core/prompt-template.ts` 수정:

(1) `promptBody`의 JSON 예시에서 mcq 항목의 `"explanation"` 줄 뒤에 `"keywords": ["핵심 개념 키워드1", "핵심 개념 키워드2"]`를, cloze 항목의 `"explanation": "해설"` 뒤에도 동일하게 추가한다. `## 규칙` 목록 끝에 한 줄 추가:

```
- keywords: 문제가 다루는 핵심 개념 키워드 1~3개. 짧은 명사구로 작성.
```

(2) `dedupSection` 위에 신규 함수 2개 추가:

```ts
export function existingKeywordsSection(names: string[]): string {
  if (names.length === 0) return "";
  return [
    "## 키워드 규칙",
    "",
    "- 가능하면 아래 기존 키워드를 재사용하고, 딱 맞는 것이 없을 때만 새 키워드를 만드세요.",
    "- 표기 변형(대소문자, 조사, 축약형)으로 사실상 같은 키워드를 새로 만들지 마세요.",
    "",
    "### 기존 키워드 목록",
    "",
    ...names.map((name) => `- ${name}`),
    "",
  ].join("\n");
}

export interface VariantSource {
  question: string; // 원본 문제 JSON 직렬화 (payload + explanation)
}

function variantSection(sources: VariantSource[]): string {
  if (sources.length === 0) return "";
  return [
    "## 변형 출제 (원본 문제)",
    "",
    "아래 원본 문제들과 같은 개념을 다른 각도·형태·상황으로 묻는 문제를 만드세요.",
    "",
    ...sources.map(
      (source, i) =>
        `### 원본 ${i + 1}\n\n\`\`\`json\n${source.question}\n\`\`\``,
    ),
    "",
    "- 원본과 표현만 바꾼 문제는 금지합니다 (중복 금지 규칙과 같은 기준).",
    "- 원본이 mcq면 cloze로, cloze면 mcq로 바꾸는 유형 전환도 좋은 변형입니다.",
    "",
  ].join("\n");
}
```

(3) `buildCliGenerationPrompt` 시그니처와 본문 확장:

```ts
export function buildCliGenerationPrompt(
  topicName: string,
  instructions: string,
  resultPath: string,
  existing: ExistingQuestions,
  referenceFiles: string[] = [],
  existingKeywords: string[] = [],
  variantSources: VariantSource[] = [],
): string {
  const extra = instructions.trim();
  return `${promptBody(topicName)}
${webVerificationSection("문제를 만들기 전에")}${referenceSection(referenceFiles, "문제를 만들기 전에")}${variantSection(variantSources)}${existingKeywordsSection(existingKeywords)}${dedupSection(existing)}

## 추가 지시

${extra || "(없음)"}

## 결과 저장 (반드시 준수)

- 결과 JSON을 stdout에 출력하지 마세요.
- 결과 JSON은 다음 경로에 UTF-8 텍스트 파일로만 저장하세요: ${resultPath}
- 파일 내용은 위 출력 형식의 JSON만 포함해야 하며, 코드 펜스나 설명 문장을 추가하지 마세요.
`;
}
```

(4) 파일 끝에 백필 프롬프트 추가:

```ts
export function buildCliKeywordTagPrompt(
  topicName: string,
  questions: Array<{ id: number; summary: string }>,
  existingKeywords: string[],
  resultPath: string,
): string {
  const listing = questions
    .map((question) => `- (id=${question.id}) ${question.summary}`)
    .join("\n");

  return `당신은 학습 문제 분류 전문가입니다. 주제 "${topicName}"의 아래 문제들에 핵심 개념 키워드를 부여해 주세요.

## 대상 문제 목록

${listing}

${existingKeywordsSection(existingKeywords)}## 출력 형식

다른 설명 없이 아래 구조의 JSON만 작성하세요.

{
  "assignments": [
    { "id": 123, "keywords": ["키워드1", "키워드2"] }
  ]
}

- 위 목록의 모든 문제에 대해 assignment를 하나씩 만드세요. id는 목록의 (id=N)을 그대로 사용하세요.
- keywords는 문제가 다루는 핵심 개념 1~3개. 짧은 명사구로 작성하세요.

## 결과 저장 (반드시 준수)

- 결과 JSON을 stdout에 출력하지 마세요.
- 결과 JSON은 다음 경로에 UTF-8 텍스트 파일로만 저장하세요: ${resultPath}
- 파일 내용은 위 출력 형식의 JSON만 포함해야 하며, 코드 펜스나 설명 문장을 추가하지 마세요.
`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/core/prompt-template.test.ts`
Expected: PASS (기존 + 신규 5 케이스). 기존 케이스가 keywords 추가로 깨지면 기대 문자열을 갱신한다(출력 형식 변경은 의도된 것).

- [ ] **Step 5: 커밋**

```bash
git add src/core/prompt-template.ts src/core/prompt-template.test.ts
git commit -m "feat: 생성 프롬프트에 키워드·변형 섹션과 백필 프롬프트 추가"
```

---

### Task 4: 키워드 서비스 + 임포트 연동 + 키워드 API

**Files:**
- Create: `src/server/keyword-service.ts`
- Modify: `src/server/import-service.ts`
- Create: `src/app/api/keywords/route.ts`
- Create: `src/app/api/questions/[id]/keywords/route.ts`
- Create: `src/app/api/questions/[id]/keywords/[keywordId]/route.ts`
- Modify: `src/lib/api-types.ts`, `src/lib/api-client.ts`

**Interfaces:**
- Consumes: `normalizeKeywordName`, `dedupeKeywordNames`, `KEYWORD_MAX_LENGTH` (Task 1), `ImportQuestion.keywords` (Task 2)
- Produces: `KeywordRefDto { id: number; name: string }`, `KeywordDto extends KeywordRefDto { questionCount: number }`
- Produces: `listKeywords(topicId?: number): Promise<KeywordDto[]>`, `addQuestionKeyword(questionId: number, rawName: string): Promise<KeywordRefDto>`, `removeQuestionKeyword(questionId: number, keywordId: number): Promise<void>`, `attachKeywords(tx: Prisma.TransactionClient, questionId: number, names: string[]): Promise<void>`
- Produces: `api.keywords.list(topicId?)`, `api.questions.addKeyword(id, name)`, `api.questions.removeKeyword(id, keywordId)`

- [ ] **Step 1: DTO 추가**

`src/lib/api-types.ts`의 `TopicDto` 위에 추가:

```ts
export interface KeywordRefDto {
  id: number;
  name: string;
}

export interface KeywordDto extends KeywordRefDto {
  questionCount: number;
}
```

- [ ] **Step 2: keyword-service 구현**

`src/server/keyword-service.ts`:

```ts
import type { Prisma } from "@prisma/client";
import {
  dedupeKeywordNames,
  KEYWORD_MAX_LENGTH,
  normalizeKeywordName,
} from "@/core/keyword";
import type { KeywordDto, KeywordRefDto } from "@/lib/api-types";
import { prisma } from "./db";
import { ServiceError } from "./errors";

export async function listKeywords(topicId?: number): Promise<KeywordDto[]> {
  const keywords = await prisma.keyword.findMany({
    where: topicId
      ? { questions: { some: { question: { topicId } } } }
      : undefined,
    orderBy: { name: "asc" },
    include: { _count: { select: { questions: true } } },
  });
  // questionCount는 주제 필터와 무관하게 전체 연결 수 — 키워드는 전역 어휘.
  return keywords.map((keyword) => ({
    id: keyword.id,
    name: keyword.name,
    questionCount: keyword._count.questions,
  }));
}

export async function attachKeywords(
  tx: Prisma.TransactionClient,
  questionId: number,
  names: string[],
): Promise<void> {
  for (const name of dedupeKeywordNames(names)) {
    const keyword = await tx.keyword.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    await tx.questionKeyword.upsert({
      where: { questionId_keywordId: { questionId, keywordId: keyword.id } },
      update: {},
      create: { questionId, keywordId: keyword.id },
    });
  }
}

export async function addQuestionKeyword(
  questionId: number,
  rawName: string,
): Promise<KeywordRefDto> {
  const name = normalizeKeywordName(rawName);
  if (!name || name.length > KEYWORD_MAX_LENGTH) {
    throw new ServiceError(
      "VALIDATION",
      `키워드는 1~${KEYWORD_MAX_LENGTH}자여야 합니다`,
      400,
    );
  }
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: { id: true },
  });
  if (!question) {
    throw new ServiceError("NOT_FOUND", "문제를 찾을 수 없습니다", 404);
  }

  const keyword = await prisma.$transaction(async (tx) => {
    await attachKeywords(tx, questionId, [name]);
    return tx.keyword.findUniqueOrThrow({ where: { name } });
  });
  return { id: keyword.id, name: keyword.name };
}

export async function removeQuestionKeyword(
  questionId: number,
  keywordId: number,
): Promise<void> {
  const link = await prisma.questionKeyword.findUnique({
    where: { questionId_keywordId: { questionId, keywordId } },
  });
  if (!link) {
    throw new ServiceError("NOT_FOUND", "연결된 키워드를 찾을 수 없습니다", 404);
  }

  await prisma.$transaction(async (tx) => {
    await tx.questionKeyword.delete({
      where: { questionId_keywordId: { questionId, keywordId } },
    });
    // 고아 키워드 정리 — 연결이 0개가 되면 키워드도 삭제한다.
    const remaining = await tx.questionKeyword.count({ where: { keywordId } });
    if (remaining === 0) {
      await tx.keyword.delete({ where: { id: keywordId } });
    }
  });
}
```

- [ ] **Step 3: import-service 연동**

`src/server/import-service.ts` — 상단에 import 추가:

```ts
import { attachKeywords } from "./keyword-service";
```

`importQuestions`의 트랜잭션 내부, `await tx.srsState.create(...)` 줄 아래에 추가:

```ts
      if (question.keywords && question.keywords.length > 0) {
        await attachKeywords(tx, created.id, question.keywords);
      }
```

- [ ] **Step 4: API 라우트 3개 생성**

`src/app/api/keywords/route.ts`:

```ts
import { ServiceError } from "@/server/errors";
import { handleApiError, jsonOk } from "@/server/http";
import { listKeywords } from "@/server/keyword-service";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const topicIdRaw = url.searchParams.get("topicId");
    const topicId = topicIdRaw ? Number(topicIdRaw) : undefined;
    if (
      topicIdRaw &&
      (!Number.isInteger(topicId) || topicId === undefined || topicId <= 0)
    ) {
      throw new ServiceError("BAD_REQUEST", "잘못된 topicId입니다", 400);
    }
    return jsonOk({ keywords: await listKeywords(topicId) });
  } catch (e) {
    return handleApiError(e);
  }
}
```

`src/app/api/questions/[id]/keywords/route.ts`:

```ts
import { z } from "zod";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";
import { addQuestionKeyword } from "@/server/keyword-service";

const addSchema = z.object({ name: z.string().min(1).max(100) });

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const input = await parseBody(req, addSchema);
    return jsonOk(await addQuestionKeyword(parseIdParam(id), input.name));
  } catch (e) {
    return handleApiError(e);
  }
}
```

`src/app/api/questions/[id]/keywords/[keywordId]/route.ts`:

```ts
import { handleApiError, jsonOk, parseIdParam } from "@/server/http";
import { removeQuestionKeyword } from "@/server/keyword-service";

type Ctx = { params: Promise<{ id: string; keywordId: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id, keywordId } = await ctx.params;
    await removeQuestionKeyword(parseIdParam(id), parseIdParam(keywordId));
    return jsonOk({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
```

- [ ] **Step 5: api-client 확장**

`src/lib/api-client.ts` — 타입 import에 `KeywordDto`, `KeywordRefDto` 추가. `questions` 객체의 `explain` 아래에 추가:

```ts
    addKeyword: (id: number, name: string) =>
      request<KeywordRefDto>(`/api/questions/${id}/keywords`, {
        method: "POST",
        body: JSON.stringify({ name }),
      }),
    removeKeyword: (id: number, keywordId: number) =>
      request<{ ok: true }>(`/api/questions/${id}/keywords/${keywordId}`, {
        method: "DELETE",
      }),
```

`api` 객체에 최상위 `keywords` 추가 (`import` 항목 위):

```ts
  keywords: {
    list: (topicId?: number) =>
      request<{ keywords: KeywordDto[] }>(
        `/api/keywords${topicId ? `?topicId=${topicId}` : ""}`,
      ),
  },
```

- [ ] **Step 6: 타입 검사와 전체 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: 오류 없음, 기존 테스트 전부 PASS

- [ ] **Step 7: 커밋**

```bash
git add src/server/keyword-service.ts src/server/import-service.ts src/app/api/keywords src/app/api/questions src/lib/api-types.ts src/lib/api-client.ts
git commit -m "feat: 키워드 서비스와 API, 임포트 시 키워드 연결 추가"
```

---

### Task 5: 문제·학습 서비스 키워드 필터

**Files:**
- Modify: `src/server/question-service.ts`, `src/server/study-service.ts`
- Modify: `src/app/api/questions/route.ts`, `src/app/api/study/queue/route.ts`
- Modify: `src/lib/api-types.ts`, `src/lib/api-client.ts`

**Interfaces:**
- Consumes: `KeywordRefDto` (Task 4)
- Produces: `QuestionListParams.keywordId?: number`, `QuestionDetailDto.keywords: KeywordRefDto[]`
- Produces: `getStudyQueue(mode, topicId?, keywordId?)` — keywordId는 practice 모드에서만 적용
- Produces: `api.questions.list({ keywordId })`, `api.study.queue(mode, topicId?, keywordId?)`

- [ ] **Step 1: DTO 확장**

`src/lib/api-types.ts`:

- `QuestionListParams`에 `keywordId?: number;` 추가.
- `QuestionDetailDto`에 `keywords: KeywordRefDto[];` 추가.

- [ ] **Step 2: question-service 수정**

`src/server/question-service.ts`:

(1) import에 `KeywordRefDto` 타입 추가.

(2) `listQuestions`의 `where`를 키워드 필터 포함으로 변경:

```ts
  const questions = await prisma.question.findMany({
    where: {
      ...(params.topicId ? { topicId: params.topicId } : {}),
      ...(params.keywordId
        ? { keywords: { some: { keywordId: params.keywordId } } }
        : {}),
    },
    include: { reviewLogs: { select: { isCorrect: true } } },
    orderBy: { id: "desc" },
  });
```

(3) 상세 DTO 변환을 공용 함수로 추출하고 keywords를 포함:

```ts
const KEYWORDS_INCLUDE = {
  keywords: {
    include: { keyword: true },
    orderBy: { keyword: { name: "asc" } },
  },
} as const;

function toDetailDto(q: {
  id: number;
  topicId: number;
  type: QuestionTypeDto;
  payload: unknown;
  explanation: string | null;
  keywords: Array<{ keyword: { id: number; name: string } }>;
}): QuestionDetailDto {
  return {
    id: q.id,
    topicId: q.topicId,
    type: q.type,
    payload: q.payload,
    explanation: q.explanation,
    keywords: q.keywords.map(
      (link): KeywordRefDto => ({ id: link.keyword.id, name: link.keyword.name }),
    ),
  };
}
```

`getQuestion`은 `prisma.question.findUnique({ where: { id }, include: KEYWORDS_INCLUDE })`로 조회 후 `toDetailDto(q)` 반환. `updateQuestion`의 `prisma.question.update`에도 `include: KEYWORDS_INCLUDE`를 추가하고 `toDetailDto(q)` 반환으로 교체.

- [ ] **Step 3: study-service 수정**

`src/server/study-service.ts`의 `getStudyQueue` 시그니처와 practice 분기 변경:

```ts
export async function getStudyQueue(
  mode: "srs" | "practice",
  topicId?: number,
  keywordId?: number,
): Promise<StudyQuestionDto[]> {
```

practice 분기의 첫 조회를:

```ts
  const rows = await prisma.question.findMany({
    where: {
      ...(topicId ? { topicId } : {}),
      ...(keywordId ? { keywords: { some: { keywordId } } } : {}),
    },
    select: { id: true },
  });
```

SRS 분기는 변경하지 않는다 (keywordId 무시 — 연습 전용).

- [ ] **Step 4: 라우트 수정**

`src/app/api/questions/route.ts` — `topicId` 파싱 블록 아래에 동일 패턴으로 추가하고 `listQuestions` 호출에 전달:

```ts
    const keywordIdRaw = url.searchParams.get("keywordId");
    const keywordId = keywordIdRaw ? Number(keywordIdRaw) : undefined;
    if (
      keywordIdRaw &&
      (!Number.isInteger(keywordId) || keywordId === undefined || keywordId <= 0)
    ) {
      throw new ServiceError("BAD_REQUEST", "잘못된 keywordId입니다", 400);
    }
```

`src/app/api/study/queue/route.ts` — 같은 패턴으로 `keywordId` 파싱 후 `getStudyQueue(mode, topicId, keywordId)`로 전달.

- [ ] **Step 5: api-client 수정**

`src/lib/api-client.ts`:

- `questions.list`에 `if (params.keywordId) searchParams.set("keywordId", String(params.keywordId));` 추가.
- `study.queue`를 파라미터 빌더로 교체:

```ts
    queue: (mode: "srs" | "practice", topicId?: number, keywordId?: number) => {
      const searchParams = new URLSearchParams({ mode });
      if (topicId) searchParams.set("topicId", String(topicId));
      if (keywordId) searchParams.set("keywordId", String(keywordId));
      return request<StudyQuestionDto[]>(`/api/study/queue?${searchParams}`);
    },
```

- [ ] **Step 6: 타입 검사와 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: PASS. (`study-service.test.ts`가 존재하므로 시그니처 변경으로 깨지는 곳이 있으면 optional 인자라 영향이 없는지 확인.)

- [ ] **Step 7: 커밋**

```bash
git add src/server/question-service.ts src/server/study-service.ts src/app/api/questions/route.ts src/app/api/study/queue/route.ts src/lib/api-types.ts src/lib/api-client.ts
git commit -m "feat: 문제 목록·상세·연습 큐에 키워드 필터 추가"
```

---

### Task 6: 생성 서비스 — 변형 출제 + 기존 키워드 주입

**Files:**
- Modify: `src/server/generation/generation-service.ts`
- Modify: `src/app/api/generate/route.ts`
- Modify: `src/lib/api-types.ts`, `src/lib/api-client.ts`

**Interfaces:**
- Consumes: `buildCliGenerationPrompt(..., existingKeywords, variantSources)`, `VariantSource` (Task 3)
- Produces: `createJob` 입력에 `sourceQuestionIds?: number[]` (최대 10개, 전부 존재해야 함)
- Produces: `loadExistingKeywords(topicId: number): Promise<string[]>` (모듈 내부 함수 — Task 7에서도 사용)
- Produces: `GenerationJobDto.sourceQuestionIds: number[] | null`
- Produces: `api.generate.create({ ..., sourceQuestionIds? })`

- [ ] **Step 1: DTO 확장**

`src/lib/api-types.ts`의 `GenerationJobDto`에 추가:

```ts
  sourceQuestionIds: number[] | null;
```

- [ ] **Step 2: generation-service 수정**

`src/server/generation/generation-service.ts`:

(1) import 수정 — `buildCliGenerationPrompt` 옆에 `type VariantSource` 추가:

```ts
import {
  buildCliGenerationPrompt,
  buildCliVerifyPrompt,
  type ExistingQuestions,
  type VariantSource,
} from "@/core/prompt-template";
```

(2) 상수 추가:

```ts
const VARIANT_SOURCE_LIMIT = 10;
const EXISTING_KEYWORD_LIMIT = 50;
```

(3) `toDto`에 필드 추가:

```ts
    sourceQuestionIds: (job.sourceQuestionIds as unknown as number[] | null) ?? null,
```

(4) `loadExistingQuestions` 아래에 함수 추가:

```ts
async function loadExistingKeywords(topicId: number): Promise<string[]> {
  const keywords = await prisma.keyword.findMany({
    where: { questions: { some: { question: { topicId } } } },
    orderBy: { questions: { _count: "desc" } },
    take: EXISTING_KEYWORD_LIMIT,
    select: { name: true },
  });
  return keywords.map((keyword) => keyword.name);
}
```

(5) `createJob` — 입력 타입에 `sourceQuestionIds?: number[]` 추가. `loadExistingQuestions` 호출 뒤에 원본 로드 로직 추가:

```ts
  let variantSources: VariantSource[] = [];
  const sourceQuestionIds = input.sourceQuestionIds?.slice(0, VARIANT_SOURCE_LIMIT);
  if (sourceQuestionIds && sourceQuestionIds.length > 0) {
    const sourceQuestions = await prisma.question.findMany({
      where: { id: { in: sourceQuestionIds } },
    });
    if (sourceQuestions.length !== new Set(sourceQuestionIds).size) {
      throw new ServiceError("NOT_FOUND", "원본 문제를 찾을 수 없습니다", 404);
    }
    variantSources = sourceQuestions.map((question) => ({
      question: JSON.stringify(
        {
          type: question.type === "MCQ" ? "mcq" : "cloze",
          ...(question.payload as Record<string, unknown>),
          ...(question.explanation ? { explanation: question.explanation } : {}),
        },
        null,
        2,
      ),
    }));
  }
  const existingKeywords = await loadExistingKeywords(input.topicId);
```

잡 생성 data에 `sourceQuestionIds: sourceQuestionIds && sourceQuestionIds.length > 0 ? sourceQuestionIds : undefined,` 추가. `runJob` 호출에 `existingKeywords, variantSources` 인자 전달.

(6) `runJob` 시그니처와 프롬프트 호출 확장:

```ts
async function runJob(
  jobId: number,
  topicName: string,
  instructions: string,
  existing: ExistingQuestions,
  referenceAbsPaths: string[],
  existingKeywords: string[],
  variantSources: VariantSource[],
): Promise<void> {
```

`buildCliGenerationPrompt(topicName, instructions, resultPath, existing, referenceAbsPaths, existingKeywords, variantSources)`로 변경.

- [ ] **Step 3: 라우트 스키마 확장**

`src/app/api/generate/route.ts`의 `createSchema`에 추가:

```ts
  sourceQuestionIds: z.array(z.number().int().positive()).max(10).optional(),
```

- [ ] **Step 4: api-client 수정**

`src/lib/api-client.ts`의 `generate.create` 입력 타입에 `sourceQuestionIds?: number[];` 추가 (body는 `JSON.stringify(input)` 그대로라 추가 변경 없음).

- [ ] **Step 5: 타입 검사와 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/server/generation/generation-service.ts src/app/api/generate/route.ts src/lib/api-types.ts src/lib/api-client.ts
git commit -m "feat: 변형 출제 원본 컨텍스트와 기존 키워드 프롬프트 주입"
```

---

### Task 7: 생성 서비스 — KEYWORD_TAG 백필 잡

**Files:**
- Modify: `src/server/generation/generation-service.ts`
- Create: `src/app/api/generate/keyword-tag/route.ts`
- Modify: `src/lib/api-types.ts`, `src/lib/api-client.ts`

**Interfaces:**
- Consumes: `buildCliKeywordTagPrompt` (Task 3), `parseKeywordTagJson` (Task 2), `attachKeywords` (Task 4), `loadExistingKeywords` (Task 6)
- Produces: `GenerationJobKindDto = "QUESTION" | "KEYWORD_TAG"`, `KeywordTagItemDto { id: number; summary: string; keywords: string[] }`
- Produces: `GenerationJobDto.kind`, `GenerationJobDto.keywordItems: KeywordTagItemDto[] | null`, `GenerationJobSummaryDto.kind`
- Produces: `createKeywordTagJob(input: { topicId: number; engine: GenerationEngineDto }): Promise<GenerationJobDto>`
- Produces: `approveJob` — KEYWORD_TAG 잡이면 `indices`를 **문제 id 배열**로 해석해 키워드를 적용
- Produces: `api.generate.keywordTag({ topicId, engine })`

- [ ] **Step 1: DTO 확장**

`src/lib/api-types.ts`:

```ts
export type GenerationJobKindDto = "QUESTION" | "KEYWORD_TAG";

export interface KeywordTagItemDto {
  id: number;
  summary: string;
  keywords: string[];
}
```

`GenerationJobDto`에 `kind: GenerationJobKindDto;`와 `keywordItems: KeywordTagItemDto[] | null;` 추가. `GenerationJobSummaryDto`에 `kind: GenerationJobKindDto;` 추가.

- [ ] **Step 2: generation-service 수정**

(1) import 추가:

```ts
import { parseKeywordTagJson } from "@/core/keyword-tag-schema";
import { buildCliKeywordTagPrompt } from "@/core/prompt-template";
import type { GenerationJobKindDto, KeywordTagItemDto } from "@/lib/api-types";
import { attachKeywords } from "../keyword-service";
```

(`buildCliKeywordTagPrompt`는 기존 prompt-template import 구문에 합친다.)

(2) 상수 추가:

```ts
const KEYWORD_TAG_BATCH_LIMIT = 50;
```

(3) `toDto`의 `items` 계산을 kind 분기로 교체하고 필드 추가:

```ts
    kind: job.kind as GenerationJobKindDto,
    items:
      job.kind === "QUESTION" && job.status === "SUCCEEDED"
        ? (job.result as unknown as GenerationJobDto["items"])
        : null,
    keywordItems:
      job.kind === "KEYWORD_TAG" && job.status === "SUCCEEDED"
        ? (job.result as unknown as KeywordTagItemDto[])
        : null,
```

`toSummaryDto`에도 `kind: job.kind as GenerationJobKindDto,` 추가. `toSummaryDto`의 `itemCount`는 kind와 무관하게 result 배열 길이를 쓰도록 교체하고, 이때 기존 `const items = job.result as unknown as GenerationItemDto[] | null;` 선언은 미사용이 되므로 삭제한다:

```ts
    itemCount:
      job.status === "SUCCEEDED" && Array.isArray(job.result)
        ? (job.result as unknown[]).length
        : null,
```

(4) `createKeywordTagJob`와 `runKeywordTagJob` 추가 (`createJob` 아래):

```ts
export async function createKeywordTagJob(input: {
  topicId: number;
  engine: GenerationEngineDto;
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

  const untagged = await prisma.question.findMany({
    where: { topicId: input.topicId, keywords: { none: {} } },
    orderBy: { id: "asc" },
    take: KEYWORD_TAG_BATCH_LIMIT,
    select: { id: true, type: true, payload: true },
  });
  const targets = untagged
    .map((question) => ({
      id: question.id,
      summary: summarizeQuestionPayload(question.type, question.payload),
    }))
    .filter((target) => target.summary);
  if (targets.length === 0) {
    throw new ServiceError(
      "NO_UNTAGGED_QUESTIONS",
      "키워드를 부여할 문제가 없습니다",
      400,
    );
  }

  const existingKeywords = await loadExistingKeywords(input.topicId);

  const job = await prisma.generationJob.create({
    data: {
      topicId: input.topicId,
      engine: input.engine,
      verifyEngine: input.engine,
      instructions: "",
      kind: "KEYWORD_TAG",
    },
  });

  void runKeywordTagJob(job.id, topic.name, targets, existingKeywords).catch(
    (e) => {
      console.error(`keyword tag job ${job.id} failed unexpectedly`, e);
    },
  );

  return toDto(job);
}

async function runKeywordTagJob(
  jobId: number,
  topicName: string,
  targets: Array<{ id: number; summary: string }>,
  existingKeywords: string[],
): Promise<void> {
  const dir = jobOutputDir(jobId);
  const resultPath = path.join(dir, "result.json");
  const prompt = buildCliKeywordTagPrompt(
    topicName,
    targets,
    existingKeywords,
    resultPath,
  );

  const job = await prisma.generationJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RUNNING") return;

  const run = await runEngine(job.engine, prompt, dir);
  if (!run.ok) {
    await failJob(jobId, run.failureReason, null);
    return;
  }

  const parsed = parseKeywordTagJson(extractJsonObject(run.resultText));
  if (!parsed.ok) {
    await failJob(
      jobId,
      `${parsed.fatal}; 원문 앞 300자: ${run.resultText.slice(0, 300)}`,
      run.resultText,
    );
    return;
  }

  const summaryById = new Map(targets.map((target) => [target.id, target.summary]));
  // 요청에 없던 문제 id는 무시한다.
  const items: KeywordTagItemDto[] = parsed.assignments
    .filter((assignment) => summaryById.has(assignment.id))
    .map((assignment) => ({
      id: assignment.id,
      summary: summaryById.get(assignment.id) as string,
      keywords: assignment.keywords,
    }));

  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      result: items as unknown as Prisma.InputJsonValue,
      rawOutput: run.resultText,
      finishedAt: new Date(),
    },
  });
}
```

(5) `approveJob` — 상태 검증(`job.status !== "SUCCEEDED"`) 통과 직후에 kind 분기 추가:

```ts
  if (job.kind === "KEYWORD_TAG") {
    const items = (job.result as unknown as KeywordTagItemDto[] | null) ?? [];
    const byId = new Map(items.map((item) => [item.id, item]));
    const picked: KeywordTagItemDto[] = [];
    for (const id of indices) {
      const item = byId.get(id);
      if (!item) {
        throw new ServiceError(
          "INVALID_ITEMS",
          "저장할 수 없는 항목이 포함되어 있습니다",
          400,
        );
      }
      picked.push(item);
    }
    if (picked.length === 0) {
      throw new ServiceError("INVALID_ITEMS", "저장할 항목이 없습니다", 400);
    }

    // 잡 실행 후 삭제된 문제는 건너뛴다.
    const existingIds = new Set(
      (
        await prisma.question.findMany({
          where: { id: { in: picked.map((item) => item.id) } },
          select: { id: true },
        })
      ).map((question) => question.id),
    );
    let applied = 0;
    await prisma.$transaction(async (tx) => {
      for (const item of picked) {
        if (!existingIds.has(item.id)) continue;
        await attachKeywords(tx, item.id, item.keywords);
        applied += 1;
      }
    });

    const updated = await prisma.generationJob.update({
      where: { id },
      data: { approvedAt: new Date(), savedCount: { increment: applied } },
    });
    return { savedCount: applied, job: toDto(updated) };
  }
```

(6) `getJob`의 고아 판정은 그대로 둔다 (KEYWORD_TAG 잡도 RUNNING 초과 시 FAILED 처리 — VERIFYING 분기는 QUESTION 잡만 진입).

- [ ] **Step 3: 라우트 생성**

`src/app/api/generate/keyword-tag/route.ts`:

```ts
import { z } from "zod";
import { createKeywordTagJob } from "@/server/generation/generation-service";
import { handleApiError, jsonOk, parseBody } from "@/server/http";

const createSchema = z.object({
  topicId: z.number().int().positive(),
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
});

export async function POST(req: Request) {
  try {
    const input = await parseBody(req, createSchema);
    return jsonOk({ job: await createKeywordTagJob(input) }, 202);
  } catch (e) {
    return handleApiError(e);
  }
}
```

- [ ] **Step 4: api-client 확장**

`src/lib/api-client.ts`의 `generate` 객체에 추가:

```ts
    keywordTag: (input: { topicId: number; engine: GenerationEngineDto }) =>
      request<{ job: GenerationJobDto }>("/api/generate/keyword-tag", {
        method: "POST",
        body: JSON.stringify(input),
      }),
```

- [ ] **Step 5: 타입 검사와 테스트**

Run: `npx tsc --noEmit && npm test`
Expected: PASS

- [ ] **Step 6: 커밋**

```bash
git add src/server/generation/generation-service.ts src/app/api/generate/keyword-tag src/lib/api-types.ts src/lib/api-client.ts
git commit -m "feat: 키워드 일괄 부여 잡(KEYWORD_TAG) 추가"
```

---

### Task 8: 문제 상세 화면 — 키워드 칩 + 변형 생성 버튼

**Files:**
- Modify: `src/app/questions/[id]/page.tsx`

**Interfaces:**
- Consumes: `QuestionDetailDto.keywords` (Task 5), `api.questions.addKeyword/removeKeyword` (Task 4), `api.keywords.list` (Task 4)

- [ ] **Step 1: 상태와 로드 로직 추가**

`src/app/questions/[id]/page.tsx`:

(1) import 확장:

```ts
import Link from "next/link";
import { api } from "@/lib/api-client";
import type { KeywordDto, KeywordRefDto } from "@/lib/api-types";
```

(2) 컴포넌트에 상태 추가:

```ts
  const [topicId, setTopicId] = useState<number | null>(null);
  const [keywords, setKeywords] = useState<KeywordRefDto[]>([]);
  const [allKeywords, setAllKeywords] = useState<KeywordDto[]>([]);
  const [newKeyword, setNewKeyword] = useState("");
```

(3) 기존 `useEffect`의 `.then((question) => {...})`에 두 줄 추가:

```ts
        setTopicId(question.topicId);
        setKeywords(question.keywords);
```

같은 `useEffect` 안에서 자동완성용 전체 키워드도 로드:

```ts
    api.keywords
      .list()
      .then((data) => setAllKeywords(data.keywords))
      .catch(() => setAllKeywords([]));
```

(4) 핸들러 추가:

```ts
  async function addKeyword() {
    const name = newKeyword.trim();
    if (!name) return;
    try {
      const added = await api.questions.addKeyword(id, name);
      setKeywords((prev) =>
        prev.some((keyword) => keyword.id === added.id)
          ? prev
          : [...prev, added].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setNewKeyword("");
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "키워드 추가에 실패했습니다",
      );
    }
  }

  async function removeKeyword(keywordId: number) {
    try {
      await api.questions.removeKeyword(id, keywordId);
      setKeywords((prev) => prev.filter((keyword) => keyword.id !== keywordId));
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "키워드 삭제에 실패했습니다",
      );
    }
  }
```

- [ ] **Step 2: JSX 추가**

해설 `surface` 섹션 아래(오류 메시지 `{message && ...}` 위)에 키워드 섹션 추가:

```tsx
      <div className="surface surface-pad space-y-2">
        <label className="text-sm font-semibold text-[color:var(--muted)]">키워드</label>
        <div className="flex flex-wrap items-center gap-2">
          {keywords.length === 0 && (
            <span className="muted text-sm">아직 키워드가 없습니다.</span>
          )}
          {keywords.map((keyword) => (
            <span key={keyword.id} className="chip gap-1">
              {keyword.name}
              <button
                type="button"
                onClick={() => removeKeyword(keyword.id)}
                aria-label={`${keyword.name} 키워드 삭제`}
                className="text-[color:var(--danger)]"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newKeyword}
            onChange={(event) => setNewKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void addKeyword();
              }
            }}
            list="keyword-options"
            placeholder="키워드 추가 (예: TCP)"
            className="field min-w-0 flex-1"
          />
          <datalist id="keyword-options">
            {allKeywords.map((keyword) => (
              <option key={keyword.id} value={keyword.name} />
            ))}
          </datalist>
          <button
            onClick={addKeyword}
            disabled={newKeyword.trim().length === 0}
            className="btn btn-secondary shrink-0"
          >
            추가
          </button>
        </div>
      </div>
```

하단 버튼 영역(`저장`/`취소` 버튼이 있는 `<div className="flex gap-2">`)에 변형 생성 링크 추가:

```tsx
        {topicId !== null && (
          <Link
            href={`/generate/new?topicId=${topicId}&sourceQuestionIds=${id}`}
            className="btn btn-secondary ml-auto"
          >
            🤖 변형 문제 생성
          </Link>
        )}
```

- [ ] **Step 3: 검증**

Run: `npx tsc --noEmit && npm run lint`
Expected: 오류 없음. `npm run dev` 후 브라우저에서 `/questions/{id}` 접속 — 키워드 추가/삭제, Enter 입력, 변형 버튼이 `/generate/new?topicId=...&sourceQuestionIds=...`로 이동하는지 확인.

- [ ] **Step 4: 커밋**

```bash
git add "src/app/questions/[id]/page.tsx"
git commit -m "feat: 문제 상세에 키워드 편집과 변형 생성 버튼 추가"
```

---

### Task 9: 키워드 모아보기 페이지 + 내비게이션

**Files:**
- Create: `src/app/keywords/page.tsx`
- Modify: `src/components/AppNav.tsx`

**Interfaces:**
- Consumes: `api.keywords.list(topicId?)`, `api.questions.list({ keywordId })`, `KeywordDto`, `QuestionListItemDto`

- [ ] **Step 1: AppNav에 링크 추가**

`src/components/AppNav.tsx`의 `navItems`에서 `문제 관리` 항목 아래에 추가:

```ts
  { href: "/keywords", label: "키워드", basePath: "/keywords" },
```

- [ ] **Step 2: 페이지 구현**

`src/app/keywords/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import type {
  KeywordDto,
  QuestionListItemDto,
  TopicDto,
} from "@/lib/api-types";

const VARIANT_SOURCE_LIMIT = 10;

function mostCommonTopicId(questions: QuestionListItemDto[]): number | null {
  const counts = new Map<number, number>();
  for (const question of questions) {
    counts.set(question.topicId, (counts.get(question.topicId) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [topicId, count] of counts) {
    if (count > bestCount) {
      best = topicId;
      bestCount = count;
    }
  }
  return best;
}

export default function KeywordsPage() {
  const [topics, setTopics] = useState<TopicDto[]>([]);
  const [topicFilter, setTopicFilter] = useState<number | "">("");
  const [keywords, setKeywords] = useState<KeywordDto[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<QuestionListItemDto[]>([]);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [message, setMessage] = useState("");

  const selected = useMemo(
    () => keywords?.find((keyword) => keyword.id === selectedId) ?? null,
    [keywords, selectedId],
  );

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const [topicList, keywordList] = await Promise.all([
          api.topics.list(),
          api.keywords.list(topicFilter === "" ? undefined : topicFilter),
        ]);
        if (ignore) return;
        setTopics(topicList);
        setKeywords(keywordList.keywords);
        setSelectedId(null);
        setQuestions([]);
        setMessage("");
      } catch (error) {
        if (!ignore) {
          setMessage(
            error instanceof Error
              ? error.message
              : "키워드 목록을 불러오지 못했습니다",
          );
        }
      }
    }
    void load();
    return () => {
      ignore = true;
    };
  }, [topicFilter]);

  useEffect(() => {
    if (selectedId === null) return;
    let ignore = false;
    api.questions
      .list({ keywordId: selectedId })
      .then((page) => {
        if (ignore) return;
        setQuestions(page.items);
        setTotalQuestions(page.totalItems);
      })
      .catch((error: unknown) => {
        if (!ignore) {
          setMessage(
            error instanceof Error
              ? error.message
              : "문제 목록을 불러오지 못했습니다",
          );
        }
      });
    return () => {
      ignore = true;
    };
  }, [selectedId]);

  const generateHref = useMemo(() => {
    if (!selected || questions.length === 0) return null;
    const sourceIds = questions
      .slice(0, VARIANT_SOURCE_LIMIT)
      .map((question) => question.id)
      .join(",");
    const topicId = mostCommonTopicId(questions);
    return `/generate/new?sourceQuestionIds=${sourceIds}${topicId ? `&topicId=${topicId}` : ""}`;
  }, [selected, questions]);

  return (
    <div className="app-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">키워드</h1>
          <p className="page-subtitle">
            개념 키워드로 문제를 모아보고, 집중 연습하거나 변형 문제를 만듭니다.
          </p>
        </div>
      </div>

      <div className="surface surface-pad flex flex-wrap items-center gap-2">
        <select
          value={topicFilter}
          onChange={(event) =>
            setTopicFilter(event.target.value ? Number(event.target.value) : "")
          }
          className="field w-auto min-w-52"
        >
          <option value="">전체 주제</option>
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.name} ({topic.questionCount})
            </option>
          ))}
        </select>
      </div>

      {message && <p className="text-sm text-[color:var(--danger)]">{message}</p>}

      {keywords === null ? (
        <p className="muted">불러오는 중...</p>
      ) : keywords.length === 0 ? (
        <p className="empty-state">
          키워드가 없습니다 — 문제 관리에서 &quot;키워드 일괄 부여&quot;를 실행하거나
          문제 상세에서 직접 추가하세요.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {keywords.map((keyword) => (
            <button
              key={keyword.id}
              type="button"
              onClick={() =>
                setSelectedId((prev) => (prev === keyword.id ? null : keyword.id))
              }
              className={`chip ${selectedId === keyword.id ? "bg-[color:var(--brand-soft)] font-bold" : ""}`}
            >
              {keyword.name}
              <span className="subtle ml-1 text-xs">{keyword.questionCount}</span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <section className="surface surface-pad space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="section-title min-w-0 flex-1">
              {selected.name} — {totalQuestions}문제
            </h2>
            <Link
              href={`/study?mode=practice&keywordId=${selected.id}`}
              className="btn btn-primary shrink-0"
            >
              📝 이 키워드 연습하기
            </Link>
            {generateHref && (
              <Link href={generateHref} className="btn btn-secondary shrink-0">
                🤖 이 개념으로 문제 생성
              </Link>
            )}
          </div>
          <ul className="space-y-2">
            {questions.map((question) => (
              <li key={question.id} className="list-row flex items-center gap-3 p-3">
                <span className="chip">
                  {question.type === "MCQ" ? "객관식" : "빈칸"}
                </span>
                <span className="min-w-0 flex-1 truncate">{question.preview}</span>
                <Link
                  href={`/questions/${question.id}`}
                  className="shrink-0 text-sm font-semibold text-[color:var(--brand)]"
                >
                  수정
                </Link>
              </li>
            ))}
          </ul>
          {totalQuestions > questions.length && (
            <p className="muted text-sm">
              첫 {questions.length}개만 표시 — 전체는 문제 관리에서 키워드 필터로
              확인하세요.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 3: 검증**

Run: `npx tsc --noEmit && npm run lint`
Expected: 오류 없음. 브라우저에서 `/keywords` — 주제 필터, 키워드 선택 시 문제 목록, 연습/생성 링크 URL 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/app/keywords/page.tsx src/components/AppNav.tsx
git commit -m "feat: 키워드 모아보기 페이지와 내비게이션 추가"
```

---

### Task 10: 문제 목록 — 키워드 필터 + 일괄 부여 진입점

**Files:**
- Modify: `src/app/questions/page.tsx`

**Interfaces:**
- Consumes: `api.keywords.list(topicId?)`, `api.questions.list({ keywordId })` (Task 4·5), `api.generate.keywordTag` (Task 7)

- [ ] **Step 1: 상태·로드·핸들러 추가**

`src/app/questions/page.tsx`:

(1) import 확장 — `useRouter`(from `next/navigation`), `GenerationEngineDto`, `KeywordDto` 타입 추가.

(2) 컴포넌트 상태 추가:

```ts
  const router = useRouter();
  const [keywordId, setKeywordId] = useState<number | "">("");
  const [keywords, setKeywords] = useState<KeywordDto[]>([]);
  const [tagEngine, setTagEngine] = useState<GenerationEngineDto>("CLAUDE");
  const [tagging, setTagging] = useState(false);
```

(3) `reload` 옵션에 `selectedKeywordId: number | ""` 추가하고, `api.questions.list` 호출에 `keywordId: options.selectedKeywordId === "" ? undefined : options.selectedKeywordId,` 전달. `Promise.all`에 `api.keywords.list()`를 추가해 `setKeywords`로 저장. `useEffect` 의존성과 모든 `reload({...})` 호출부에 `selectedKeywordId: keywordId`를 추가한다 (누락 시 타입 오류로 잡힌다).

(4) 핸들러 추가:

```ts
  async function runKeywordTag() {
    if (topicId === "" || tagging) return;
    setTagging(true);
    try {
      const { job } = await api.generate.keywordTag({
        topicId,
        engine: tagEngine,
      });
      router.push(`/generate/${job.id}`);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "키워드 부여 요청에 실패했습니다",
      );
      setTagging(false);
    }
  }
```

- [ ] **Step 2: JSX 추가**

유형 필터 `<select>` 아래에 키워드 필터 추가:

```tsx
        <select
          value={keywordId}
          onChange={(event) => {
            setKeywordId(event.target.value ? Number(event.target.value) : "");
            resetPage();
          }}
          className="field w-auto min-w-44"
        >
          <option value="">전체 키워드</option>
          {keywords.map((keyword) => (
            <option key={keyword.id} value={keyword.id}>
              {keyword.name} ({keyword.questionCount})
            </option>
          ))}
        </select>
```

`topicId !== ""`일 때 렌더링되는 버튼 묶음(주제 삭제 버튼 뒤)에 추가:

```tsx
            <select
              value={tagEngine}
              onChange={(event) =>
                setTagEngine(event.target.value as GenerationEngineDto)
              }
              className="field w-auto min-w-32"
            >
              <option value="CLAUDE">claude code</option>
              <option value="CODEX">codex</option>
              <option value="ANTIGRAVITY">antigravity</option>
            </select>
            <button
              onClick={runKeywordTag}
              disabled={tagging}
              className="btn btn-secondary min-h-9 px-3 text-sm"
            >
              {tagging ? "요청 중..." : "🏷️ 키워드 일괄 부여"}
            </button>
```

- [ ] **Step 3: 검증**

Run: `npx tsc --noEmit && npm run lint`
Expected: 오류 없음. 브라우저에서 `/questions` — 키워드 필터 동작, 주제 선택 시 일괄 부여 버튼 노출 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/app/questions/page.tsx
git commit -m "feat: 문제 목록에 키워드 필터와 일괄 부여 진입점 추가"
```

---

### Task 11: 생성 화면 3종 — 변형 파라미터·kind 배지·KEYWORD_TAG 승인

**Files:**
- Modify: `src/app/generate/new/page.tsx`, `src/app/generate/page.tsx`, `src/app/generate/[id]/page.tsx`

**Interfaces:**
- Consumes: `api.generate.create({ sourceQuestionIds })` (Task 6), `GenerationJobDto.kind/keywordItems/sourceQuestionIds`, `GenerationJobSummaryDto.kind` (Task 7)

- [ ] **Step 1: `/generate/new` — 변형 파라미터 수용**

`src/app/generate/new/page.tsx`:

(1) `useSearchParams`는 Suspense 경계가 필요하므로 기존 컴포넌트를 `GenerationNewForm`으로 이름을 바꾸고, 파일 하단에 래퍼를 만든다:

```tsx
export default function GenerationNewPage() {
  return (
    <Suspense fallback={<p className="muted">불러오는 중...</p>}>
      <GenerationNewForm />
    </Suspense>
  );
}
```

(import에 `Suspense`, `useSearchParams` 추가.)

(2) `GenerationNewForm` 상단에서 쿼리 파라미터 해석:

```ts
  const searchParams = useSearchParams();
  const sourceQuestionIds = useMemo(() => {
    const raw = searchParams.get("sourceQuestionIds");
    if (!raw) return [];
    return raw
      .split(",")
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
      .slice(0, 10);
  }, [searchParams]);
```

(import에 `useMemo` 추가.)

(3) 주제 프리셀렉트 — 주제 목록 로드 `useEffect`의 `setTopics(list)` 다음에 추가:

```ts
        const preset = Number(searchParams.get("topicId"));
        if (
          Number.isInteger(preset) &&
          list.some((topic) => topic.id === preset)
        ) {
          setTopicId(preset);
        }
```

(해당 `useEffect` 의존성 배열에 `searchParams` 추가.)

(4) `startGeneration`의 `api.generate.create` 입력에 추가:

```ts
        sourceQuestionIds: sourceQuestionIds.length > 0 ? sourceQuestionIds : undefined,
```

(5) 변형 안내 — `주제 선택` 섹션 위에 추가:

```tsx
      {sourceQuestionIds.length > 0 && (
        <section className="surface surface-pad space-y-1">
          <h2 className="section-title">🔀 변형 출제</h2>
          <p className="muted text-sm">
            원본 문제 {sourceQuestionIds.length}개(#
            {sourceQuestionIds.join(", #")})와 같은 개념을 다른 각도로 묻는
            문제를 생성합니다.
          </p>
        </section>
      )}
```

- [ ] **Step 2: `/generate` 목록 — kind 배지**

`src/app/generate/page.tsx`의 잡 카드에서 `#{job.id}` `subtle` 스팬 다음, 주제 이름 앞에 추가:

```tsx
                  {job.kind === "KEYWORD_TAG" && (
                    <span className="chip">🏷️ 키워드 부여</span>
                  )}
```

`statusBadge`의 SUCCEEDED 분기는 그대로 둔다 (저장 수 의미가 동일: 적용된 문제 수).

- [ ] **Step 3: `/generate/[id]` 상세 — KEYWORD_TAG 승인 UI**

`src/app/generate/[id]/page.tsx`:

(1) `selectValidItems`를 kind 분기로 확장:

```ts
function selectValidItems(job: GenerationJobDto): Set<number> {
  if (job.status !== "SUCCEEDED") return new Set<number>();
  if (job.kind === "KEYWORD_TAG") {
    return new Set((job.keywordItems ?? []).map((item) => item.id));
  }
  if (!job.items) return new Set<number>();
  return new Set(
    job.items
      .filter((item) => item.ok && item.verdict !== "fail")
      .map((item) => item.index),
  );
}
```

(2) `statusLabel`의 RUNNING 라벨은 그대로 사용한다. 상태 칩 영역의 `{job.engine}→{job.verifyEngine}` 칩을 kind 분기로 교체:

```tsx
            {job.kind === "KEYWORD_TAG" ? (
              <span className="chip">🏷️ 키워드 부여 · {job.engine}</span>
            ) : (
              <span className="chip">{job.engine}→{job.verifyEngine}</span>
            )}
            {job.kind === "QUESTION" && job.sourceQuestionIds && (
              <span className="chip">
                🔀 변형 (원본 #{job.sourceQuestionIds.join(", #")})
              </span>
            )}
```

(3) `save()`는 변경 없음 — KEYWORD_TAG에서는 `selected`가 문제 id 집합이고 `api.generate.approve(job.id, [...selected])`가 그대로 동작한다. 저장 성공 메시지는 kind에 따라:

```ts
      setMessage(
        job.kind === "KEYWORD_TAG"
          ? `✅ ${result.savedCount}개 문제에 키워드를 적용했습니다`
          : `✅ ${result.savedCount}개 문제를 저장했습니다`,
      );
```

(4) QUESTION 잡 항목 미리보기에 키워드 칩 추가 — `QuestionPreview` 렌더링 바로 아래에:

```tsx
                  {(item.question as ImportQuestion).keywords?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(item.question as ImportQuestion).keywords?.map(
                        (keyword) => (
                          <span key={keyword} className="chip">🏷️ {keyword}</span>
                        ),
                      )}
                    </div>
                  ) : null}
```

(5) 기존 `job?.status === "SUCCEEDED" && job.items` 섹션 조건을 `job?.status === "SUCCEEDED" && job.kind === "QUESTION" && job.items`로 좁히고, 그 아래에 KEYWORD_TAG 전용 섹션 추가:

```tsx
      {job?.status === "SUCCEEDED" && job.kind === "KEYWORD_TAG" && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="section-title">제안된 키워드 확인 및 적용</h2>
            <button
              onClick={save}
              disabled={selected.size === 0 || saving}
              className="btn btn-success"
            >
              {saving ? "적용 중..." : `선택한 ${selected.size}개 문제에 적용`}
            </button>
          </div>
          {(job.keywordItems ?? []).length === 0 && (
            <p className="muted text-sm">제안된 키워드가 없습니다.</p>
          )}
          {(job.keywordItems ?? []).map((item) => (
            <div key={item.id} className="surface surface-pad">
              <div className="flex items-start gap-3 text-sm">
                <label className="flex shrink-0 items-center gap-2 pt-0.5">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                  <span className="subtle">#{item.id}</span>
                </label>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="break-all">{item.summary}</p>
                  <div className="flex flex-wrap gap-1">
                    {item.keywords.map((keyword) => (
                      <span key={keyword} className="chip">🏷️ {keyword}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}
```

- [ ] **Step 4: 검증**

Run: `npx tsc --noEmit && npm run lint && npm run build`
Expected: 오류 없음, 빌드 성공

- [ ] **Step 5: 커밋**

```bash
git add src/app/generate
git commit -m "feat: 생성 화면에 변형 출제와 키워드 부여 잡 지원 추가"
```

---

### Task 12: 학습 화면 키워드 연습 + 전체 수동 검증

**Files:**
- Modify: `src/app/study/page.tsx`

**Interfaces:**
- Consumes: `api.study.queue(mode, topicId, keywordId)` (Task 5), `api.keywords.list()` (Task 4)

- [ ] **Step 1: study 페이지 수정**

`src/app/study/page.tsx`:

(1) `StudySession` props에 `keywordId?: number` 추가, 큐 로드를 `api.study.queue(mode, topicId, keywordId)`로 변경하고 `useEffect` 의존성에 `keywordId` 추가.

(2) `StudySession` 안에서 키워드 이름 로드(라벨 표시용):

```ts
  const [keywordName, setKeywordName] = useState<string | null>(null);

  useEffect(() => {
    if (!keywordId) {
      setKeywordName(null);
      return;
    }
    let ignore = false;
    api.keywords
      .list()
      .then((data) => {
        if (ignore) return;
        const match = data.keywords.find((keyword) => keyword.id === keywordId);
        setKeywordName(match?.name ?? null);
      })
      .catch(() => {
        // 라벨 표시용 조회 실패는 무시한다.
      });
    return () => {
      ignore = true;
    };
  }, [keywordId]);
```

(3) 진행 헤더의 모드 라벨을 키워드 연습이면 함께 표시:

```tsx
        <span className="font-semibold">
          {modeLabel(mode)}
          {keywordName && (
            <span className="chip ml-2">🏷️ {keywordName}</span>
          )}
        </span>
```

(4) `StudyContent`에서 파라미터 해석과 전달:

```ts
  const keywordIdRaw = params.get("keywordId");
  const keywordId = keywordIdRaw ? Number(keywordIdRaw) : undefined;
```

`StudySession`의 `key`를 `` `${mode}-${topicId ?? "all"}-${keywordId ?? "all"}` ``로 바꾸고 `keywordId={keywordId}` 전달.

(5) 완료 화면의 "자유 연습하기" 링크는 키워드 연습에서도 의미가 통하므로 변경하지 않는다.

- [ ] **Step 2: 정적 검증**

Run: `npx tsc --noEmit && npm run lint && npm test && npm run build`
Expected: 모두 통과

- [ ] **Step 3: 종합 수동 검증 (개발 서버 + 실제 엔진 필요)**

`npm run dev` 후 브라우저에서 순서대로:

1. **수동 키워드**: `/questions/{id}`에서 키워드 추가 → `/keywords`에 나타나는지 → 삭제 시 (그 키워드의 마지막 연결이었다면) 목록에서 사라지는지.
2. **임포트 태깅**: `/import`에서 `keywords` 포함 JSON 저장 → 문제 상세에 키워드 표시 확인.
3. **백필**: `/questions`에서 주제 선택 → "🏷️ 키워드 일괄 부여" → 잡 상세에서 제안 확인 → 일부만 선택 적용 → 문제 상세 반영 및 `savedCount` 확인.
4. **변형 출제**: 문제 상세 "🤖 변형 문제 생성" → `/generate/new`에 변형 안내·주제 프리셀렉트 확인 → 생성 → 잡 상세에 "🔀 변형" 칩 → 승인 → 새 문제에 키워드 자동 부여 확인.
5. **키워드 연습**: `/keywords`에서 "📝 이 키워드 연습하기" → 해당 키워드 문제만 출제되고 헤더에 🏷️ 라벨 표시 확인.
6. **회귀**: 일반 생성 잡(변형 아님), SRS 학습, 문제 수정/삭제가 기존대로 동작하는지 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/app/study/page.tsx
git commit -m "feat: 키워드별 연습 학습 지원"
```
