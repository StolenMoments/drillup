# testedDistinction 기반 중복 방지 목록 전환 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **실행 방식 (사용자 지시):** 태스크별 구현은 전부 **Sonnet 모델 서브에이전트**에 위임한다. 메인 세션(Fable)은 코드를 직접 작성하지 않고 태스크 사이 리뷰(결과 검증, diff 리뷰, 다음 태스크 디스패치)만 수행한다.
>
> 실행 시작 시 이 계획 사본을 `docs/superpowers/plans/2026-07-13-tested-distinction-dedup.md`로 저장한다 (repo 관례).

**Goal:** 생성 프롬프트의 "기존 문제 목록"(문제 전문 요약, 최대 8,000자)을 블루프린트의 `testedDistinction` 한 줄 목록으로 교체해 토큰을 줄이고 의미 기반 중복 방지로 전환한다.

**Architecture:** 블루프린트 단계가 만든 `testedDistinction`을 잡 결과 아이템(`job.result`)에 실어 두었다가, 저장(approve) 시 `Question.testedDistinction` 컬럼에 영속화한다. 다음 생성 잡의 `loadExistingQuestions`는 문제 요약 대신 이 컬럼 값만 조회해 `dedupSection`에 넣는다. 구세대 문제(컬럼 null)는 목록에서 자연히 빠진다 — 백필 없음.

**Tech Stack:** Next.js 16 / Prisma 7 (MySQL·MariaDB) / Vitest / Zod

## Global Constraints

- `master` 브랜치에서 직접 작업 (워크트리·피처 브랜치 금지 — AGENTS.md).
- 커밋 메시지는 한국어, conventional-commit 접두사는 영어 (`feat:`, `fix:`, `test:` 등). 태스크당 커밋 1개.
- 구세대 문제 백필은 하지 않는다 (사용자 결정). `testedDistinction`이 null인 문제는 중복 방지 목록에서 제외.
- UI 변경 없음. `EXISTING_QUESTION_LIMIT`(100)·`capSummaries` 기본 8,000자 캡은 유지 — distinction은 한 줄짜리라 같은 캡에서 커버리지가 수 배로 늘고 토큰은 줄어든다.
- 실제 런타임 생성 경로는 블루프린트 경로뿐이다. `buildCliGenerationPrompt`(prompt-template.ts:189)는 데드 코드지만 이번 범위에서 삭제하지 않는다 — 컴파일만 유지.

## Context

AI 문제 생성 잡은 중복 방지를 위해 주제의 기존 문제를 프롬프트에 넣는다. 현재는 문제 전문 요약(MCQ 시나리오 지문 등, 문제당 200~500자)을 최대 100개/8,000자까지 넣어 토큰이 낭비되고, 캡을 넘는 문제는 목록에서 빠져 중복 방지도 불완전하다. 중복 판정에 실제로 필요한 것은 "어떤 개념 구분을 검사했는가"이며, 블루프린트 경로가 이미 문제마다 `testedDistinction` 한 줄을 생성하지만 현재는 어디에도 저장되지 않고 버려진다.

### 데이터 흐름 (현재 → 변경 후)

- 현재: `loadExistingQuestions`(generation-service.ts:131) → `summarizeQuestionPayload`로 payload 전문 요약 → `dedupSection`(prompt-template.ts:151) → 블루프린트 프롬프트.
- 변경 후: 블루프린트 `testedDistinction` → (신규) `job.result` 아이템 필드 → (신규) `Question.testedDistinction` 컬럼 → `loadExistingQuestions`가 컬럼 값만 조회 → `dedupSection`이 "기존 출제 개념 목록"으로 출력.

### 재사용하는 기존 코드

- `capSummaries` (`src/core/question-summary.ts:33`) — 8,000자 캡 그대로 재사용.
- `blueprints[item.index]` 인덱스 매핑 — runJob이 이미 검증/수선 단계에서 쓰는 확립된 패턴 (generation-service.ts:521, 558, 584). 생성 결과는 블루프린트와 1:1 순서 보장 (개수 불일치 시 잡 실패, :476).
- `attachKeywords` 패턴의 `importQuestions` 트랜잭션 (import-service.ts:30).

### 주의점

- `mergeVerdicts`(verify-schema.ts:64)는 `...item` 스프레드라 필드가 살아남지만, 자동 수선 경로(generation-service.ts:592)는 아이템을 `{index, ok, question}`으로 새로 만들어 필드가 유실된다. 따라서 파이프라인 중간에 싣지 않고 **`job.result`를 쓰는 3곳(FAILED :496, VERIFYING :509, SUCCEEDED :611)에서 저장 직전에 부착**한다.
- 변형 출제(variantSection)는 의도적으로 같은 개념을 다른 각도로 묻는다. `testedDistinction`이 "각도"까지 포함하는 한 줄이므로 "같은 distinction 금지" 규칙과 충돌하지 않는다 — 기존 variantSection 문구 유지.
- 이 변경 배포 전에 저장된 잡(`job.result`에 `testedDistinction` 없음)을 나중에 approve하면 null로 저장된다 — 의도된 동작(구세대 취급).

---

### Task 1: Question.testedDistinction 컬럼 추가

**Files:**
- Modify: `prisma/schema.prisma` (Question 모델, 77–92행)

**Interfaces:**
- Produces: `Question.testedDistinction: string | null` (DB 컬럼 `tested_distinction`, TEXT). Task 3·4가 이 컬럼을 읽고 쓴다.

- [ ] **Step 1: 스키마에 필드 추가**

`explanation` 필드 아래에:

```prisma
model Question {
  id                 Int                 @id @default(autoincrement())
  topicId            Int                 @map("topic_id")
  type               QuestionType
  payload            Json
  explanation        String?             @db.Text
  testedDistinction  String?             @map("tested_distinction") @db.Text
  ...(나머지 기존 필드 유지)
}
```

- [ ] **Step 2: 마이그레이션 생성 + 클라이언트 재생성**

Run: `npx prisma migrate dev --name add_question_tested_distinction`
Expected: `prisma/migrations/<timestamp>_add_question_tested_distinction/migration.sql` 생성 (`ALTER TABLE question ADD COLUMN tested_distinction TEXT NULL`), `prisma generate` 자동 실행. (로컬 MariaDB 필요 — README 참고.)

- [ ] **Step 3: 기존 테스트 회귀 확인**

Run: `npm test`
Expected: 전체 PASS (스키마 추가만으로 깨지는 테스트 없음)

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: Question에 tested_distinction 컬럼 추가"
```

---

### Task 2: attachTestedDistinctions 헬퍼 (core)

**Files:**
- Modify: `src/core/generation-result.ts`
- Test: `src/core/generation-result.test.ts`

**Interfaces:**
- Consumes: `VerifiedItemResult` (`src/core/verify-schema.ts:54`), `QuestionBlueprint` (`src/core/question-blueprint.ts`)
- Produces:
  ```ts
  export type DistinctionTaggedItemResult =
    | (Extract<VerifiedItemResult, { ok: true }> & { testedDistinction: string | null })
    | Extract<VerifiedItemResult, { ok: false }>;
  export function attachTestedDistinctions(
    items: VerifiedItemResult[],
    blueprints: QuestionBlueprint[],
  ): DistinctionTaggedItemResult[];
  ```
  Task 5의 runJob이 `job.result` 저장 직전에 호출한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/generation-result.test.ts`에 추가:

```ts
import { attachTestedDistinctions, prepareGeneratedItems } from "./generation-result";
import type { QuestionBlueprint } from "./question-blueprint";
import type { VerifiedItemResult } from "./verify-schema";

const question = {
  type: "mcq" as const,
  question: "q",
  choices: ["a", "b", "c", "d"],
  answer_index: 0,
};

function blueprintWith(testedDistinction: string): QuestionBlueprint {
  return { testedDistinction } as unknown as QuestionBlueprint;
}

describe("attachTestedDistinctions", () => {
  it("ok 아이템에 인덱스가 가리키는 블루프린트의 testedDistinction을 붙인다", () => {
    const items: VerifiedItemResult[] = [
      { index: 0, ok: true, question, verdict: "pass", verdictComment: null },
      { index: 1, ok: false, errors: ["bad"] },
    ];
    const blueprints = [blueprintWith("관리형 대 자체 운영 구분"), blueprintWith("무관")];
    expect(attachTestedDistinctions(items, blueprints)).toEqual([
      { index: 0, ok: true, question, verdict: "pass", verdictComment: null, testedDistinction: "관리형 대 자체 운영 구분" },
      { index: 1, ok: false, errors: ["bad"] },
    ]);
  });

  it("블루프린트가 없거나 distinction이 공백이면 null을 붙인다", () => {
    const items: VerifiedItemResult[] = [
      { index: 0, ok: true, question, verdict: "unverified", verdictComment: null },
      { index: 5, ok: true, question, verdict: "pass", verdictComment: null },
    ];
    const result = attachTestedDistinctions(items, [blueprintWith("   ")]);
    expect(result[0]).toMatchObject({ testedDistinction: null });
    expect(result[1]).toMatchObject({ testedDistinction: null }); // index 5는 범위 밖
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/core/generation-result.test.ts`
Expected: FAIL — `attachTestedDistinctions`가 export되지 않음

- [ ] **Step 3: 구현**

`src/core/generation-result.ts`에 추가:

```ts
import type { QuestionBlueprint } from "./question-blueprint";
import type { VerifiedItemResult } from "./verify-schema";

export type DistinctionTaggedItemResult =
  | (Extract<VerifiedItemResult, { ok: true }> & { testedDistinction: string | null })
  | Extract<VerifiedItemResult, { ok: false }>;

// 검증·수선 단계가 아이템 객체를 새로 만들며 필드를 잃으므로, job.result 저장 직전마다 호출한다.
export function attachTestedDistinctions(
  items: VerifiedItemResult[],
  blueprints: QuestionBlueprint[],
): DistinctionTaggedItemResult[] {
  return items.map((item) => {
    if (!item.ok) return item;
    const distinction = blueprints[item.index]?.testedDistinction?.trim();
    return { ...item, testedDistinction: distinction || null };
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/core/generation-result.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/core/generation-result.ts src/core/generation-result.test.ts
git commit -m "feat: 생성 아이템에 testedDistinction을 부착하는 헬퍼 추가"
```

---

### Task 3: 중복 방지 목록을 distinction 목록으로 교체 (프롬프트 + 로더)

**Files:**
- Modify: `src/core/prompt-template.ts` (`ExistingQuestions` :66, `dedupSection` :151)
- Modify: `src/server/generation/generation-service.ts` (`loadExistingQuestions` :131)
- Test: `src/core/prompt-template.test.ts`

**Interfaces:**
- Consumes: Task 1의 `Question.testedDistinction` 컬럼
- Produces: `ExistingQuestions`의 필드가 `summaries` → `distinctions`로 바뀐다 (`{ distinctions: string[]; truncated: boolean }`). `buildCliQuestionBlueprintPrompt`/`buildCliGenerationPrompt` 호출자와 테스트 픽스처 전부 이 이름을 쓴다.

- [ ] **Step 1: 실패하는 테스트로 수정**

`src/core/prompt-template.test.ts`에서 `ExistingQuestions` 픽스처의 `summaries:`를 모두 `distinctions:`로 바꾸고 (예: `NO_EXISTING = { distinctions: [], truncated: false }`), 88–117행의 세 테스트를 다음 취지로 교체:

```ts
it("기존 distinction이 없으면 배치 내 중복 금지 지시만 포함한다", () => {
  const prompt = buildCliGenerationPrompt("리눅스 기초", "", "D:\\r.json", NO_EXISTING);
  expect(prompt).toContain("이번에 생성하는 문제들끼리");
  expect(prompt).not.toContain("기존 출제 개념 목록");
});

it("기존 distinction이 있으면 목록과 중복 금지 지시를 포함한다", () => {
  const prompt = buildCliGenerationPrompt("리눅스 기초", "", "D:\\r.json", {
    distinctions: ["커널 모듈 로딩 방식 구분", "패키지 매니저 잠금 파일 역할 구분"],
    truncated: false,
  });
  expect(prompt).toContain("기존 출제 개념 목록");
  expect(prompt).toContain("- 커널 모듈 로딩 방식 구분");
  expect(prompt).toContain("- 패키지 매니저 잠금 파일 역할 구분");
  expect(prompt).toContain("표현을 바꿔도");
  expect(prompt).not.toContain("이 외에도 기존 출제 개념이 더 있습니다");
});

it("목록이 잘렸으면 더 있음을 명시한다", () => {
  const prompt = buildCliGenerationPrompt("리눅스 기초", "", "D:\\r.json", {
    distinctions: ["개념1"],
    truncated: true,
  });
  expect(prompt).toContain("이 외에도 기존 출제 개념이 더 있습니다");
});
```

`buildCliQuestionBlueprintPrompt` 테스트 블록에도 픽스처 이름 변경을 반영하고, 블루프린트 프롬프트에 목록이 실리는지 한 건 확인:

```ts
it("블루프린트 프롬프트에 기존 출제 개념 목록을 포함한다", () => {
  const prompt = buildCliQuestionBlueprintPrompt("t", "", "D:\\b.json", {
    distinctions: ["관리형 대 자체 운영 구분"],
    truncated: false,
  });
  expect(prompt).toContain("기존 출제 개념 목록");
  expect(prompt).toContain("- 관리형 대 자체 운영 구분");
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/core/prompt-template.test.ts`
Expected: FAIL — 타입 오류(`distinctions` 없음) 및 문구 불일치

- [ ] **Step 3: prompt-template.ts 수정**

```ts
export interface ExistingQuestions {
  distinctions: string[];
  truncated: boolean;
}

function dedupSection(existing: ExistingQuestions): string {
  const lines = [
    "## 중복 금지",
    "",
    "- 이번에 생성하는 문제들끼리 같은 개념 구분(tested distinction)을 검사하면 안 됩니다.",
  ];
  if (existing.distinctions.length > 0) {
    lines.push(
      "- 아래는 이미 출제된 문제들이 검사한 tested distinction 목록입니다. 목록과 같은 구분을 검사하는 문제는 표현을 바꿔도 출제하지 마세요.",
      "",
      "### 기존 출제 개념 목록",
      "",
      ...existing.distinctions.map((distinction) => `- ${distinction}`),
    );
    if (existing.truncated) {
      lines.push("", "(이 외에도 기존 출제 개념이 더 있습니다. 위 목록은 일부입니다.)");
    }
  }
  return lines.join("\n");
}
```

- [ ] **Step 4: loadExistingQuestions 수정 (generation-service.ts:131)**

```ts
async function loadExistingQuestions(
  topicId: number,
): Promise<ExistingQuestions> {
  // 구세대 문제(testedDistinction null)는 중복 방지 목록에서 제외한다.
  const where = { topicId, testedDistinction: { not: null } };
  const [total, questions] = await Promise.all([
    prisma.question.count({ where }),
    prisma.question.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: EXISTING_QUESTION_LIMIT,
      select: { testedDistinction: true },
    }),
  ]);
  const capped = capSummaries([
    ...new Set(questions.map((question) => question.testedDistinction ?? "")),
  ]);
  return {
    distinctions: capped.kept,
    truncated: capped.truncated || total > EXISTING_QUESTION_LIMIT,
  };
}
```

`summarizeQuestionPayload` import는 키워드 태깅 잡(:274)이 계속 쓰므로 유지.

- [ ] **Step 5: 통과 확인 + 전체 회귀**

Run: `npx vitest run src/core/prompt-template.test.ts` → PASS
Run: `npm test` → 전체 PASS (다른 파일에 `summaries:` 잔재가 있으면 타입 에러로 드러남)

- [ ] **Step 6: Commit**

```bash
git add src/core/prompt-template.ts src/core/prompt-template.test.ts src/server/generation/generation-service.ts
git commit -m "feat: 생성 프롬프트 중복 방지 목록을 tested distinction 목록으로 교체"
```

---

### Task 4: importQuestions가 testedDistinction을 저장

**Files:**
- Modify: `src/server/import-service.ts`
- Modify: `src/app/api/import/route.ts` (:32)
- Test: `src/server/import-service.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface ImportQuestionInput {
    question: ImportQuestion;
    testedDistinction?: string | null;
  }
  export async function importQuestions(topicId: number, items: ImportQuestionInput[]): Promise<number>;
  ```
  Task 5의 `approveJob`이 이 시그니처로 호출한다. 수동 JSON 가져오기(route.ts)는 `testedDistinction` 없이 호출 → null 저장.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/server/import-service.test.ts`의 기존 호출을 새 시그니처로 감싸고(`importQuestions(1, [validMcq])` → `importQuestions(1, [{ question: validMcq }])`), 테스트 추가:

```ts
it("testedDistinction을 함께 저장한다", async () => {
  await importQuestions(1, [{ question: validMcq, testedDistinction: "  관리형 대 자체 운영 구분  " }]);
  expect(questionCreateMock).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ testedDistinction: "관리형 대 자체 운영 구분" }),
    }),
  );
});

it("testedDistinction이 없으면 null로 저장한다", async () => {
  await importQuestions(1, [{ question: validMcq }]);
  expect(questionCreateMock).toHaveBeenCalledWith(
    expect.objectContaining({
      data: expect.objectContaining({ testedDistinction: null }),
    }),
  );
});
```

(mock 변수 이름은 그 파일의 기존 prisma mock 구조를 따른다.)

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/server/import-service.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`src/server/import-service.ts`:

```ts
export interface ImportQuestionInput {
  question: ImportQuestion;
  testedDistinction?: string | null;
}

export async function importQuestions(
  topicId: number,
  items: ImportQuestionInput[],
): Promise<number> {
  const topic = await prisma.topic.findUnique({ where: { id: topicId } });
  if (!topic) {
    throw new ServiceError("NOT_FOUND", "주제를 찾을 수 없습니다", 404);
  }

  await prisma.$transaction(async (tx) => {
    for (const { question, testedDistinction } of items) {
      const created = await tx.question.create({
        data: {
          topicId,
          type: question.type === "mcq" ? "MCQ" : "CLOZE",
          payload: toPayload(question) as Prisma.InputJsonValue,
          explanation: question.explanation?.trim()
            ? question.explanation.trim()
            : null,
          testedDistinction: testedDistinction?.trim() || null,
        },
        select: { id: true },
      });
      await tx.srsState.create({ data: { questionId: created.id } });
      if (question.keywords && question.keywords.length > 0) {
        await attachKeywords(tx, created.id, question.keywords);
      }
    }
  });

  return items.length;
}
```

`src/app/api/import/route.ts:32`:

```ts
const savedCount = await importQuestions(
  input.topicId,
  questions.map((question) => ({ question })),
);
```

- [ ] **Step 4: 통과 확인**

Run: `npx vitest run src/server/import-service.test.ts`
Expected: PASS. (이 시점에 `generation-service.ts:876`이 타입 에러가 나면 임시로 `questions.map((question) => ({ question }))`로 맞춰 두고 Task 5에서 완성해도 되고, Task 4·5를 연달아 작업 중이면 그대로 진행.)

- [ ] **Step 5: Commit**

```bash
git add src/server/import-service.ts src/server/import-service.test.ts src/app/api/import/route.ts
git commit -m "feat: 문제 저장 시 testedDistinction 영속화"
```

---

### Task 5: 파이프라인 배선 — job.result 부착 + approveJob 전달

**Files:**
- Modify: `src/lib/api-types.ts` (`GenerationItemDto` :205)
- Modify: `src/server/generation/generation-service.ts` (runJob :496·:509·:611, approveJob :859–876)
- Test: `src/server/generation/generation-service.test.ts`

**Interfaces:**
- Consumes: Task 2 `attachTestedDistinctions`, Task 4 `ImportQuestionInput`
- Produces: `GenerationItemDto` ok 변형에 `testedDistinction?: string | null` (옵셔널 — 구버전 잡 호환). `job.result`에 저장되는 모든 아이템이 이 필드를 갖는다.

- [ ] **Step 1: 실패하는 테스트로 수정**

`src/server/generation/generation-service.test.ts`:

`succeededJob()`의 result 아이템에 `testedDistinction: "관리형 대 자체 운영 구분"` 추가:

```ts
result: [{ index: 0, ok: true, question: originalQuestion, verdict: "fail", verdictComment: "수정 필요", testedDistinction: "관리형 대 자체 운영 구분" }],
```

기존 기대(:70)를 새 시그니처로 교체:

```ts
expect(importQuestionsMock).toHaveBeenCalledWith(2, [
  { question: revisedQuestion, testedDistinction: "관리형 대 자체 운영 구분" },
]);
```

구버전 잡 호환 테스트 추가:

```ts
it("testedDistinction이 없는 구버전 잡 아이템은 null로 저장한다", async () => {
  const legacy = succeededJob();
  legacy.result = [{ index: 0, ok: true, question: originalQuestion, verdict: "pass", verdictComment: null }];
  prismaMock.generationJob.findUnique.mockResolvedValue(legacy);
  prismaMock.generationItemRevision.findMany.mockResolvedValue([]);

  await approveJob(1, [0]);
  expect(importQuestionsMock).toHaveBeenCalledWith(2, [
    { question: originalQuestion, testedDistinction: null },
  ]);
});
```

- [ ] **Step 2: 실패 확인**

Run: `npx vitest run src/server/generation/generation-service.test.ts`
Expected: FAIL

- [ ] **Step 3: 구현**

`src/lib/api-types.ts` — ok 변형에 필드 추가:

```ts
export type GenerationItemDto =
  | {
      index: number;
      ok: true;
      question: unknown;
      verdict: GenerationVerdictDto;
      verdictComment: string | null;
      testedDistinction?: string | null;
      revision: GenerationItemRevisionDto | null;
    }
  | { index: number; ok: false; errors: string[] };
```

`generation-service.ts` — `attachTestedDistinctions`를 `@/core/generation-result`에서 import하고, `job.result`를 쓰는 3곳을 감싼다:

:496 (validCount === 0 FAILED)와 :509 (VERIFYING) 두 곳:

```ts
result: attachTestedDistinctions(unverifiedItems, blueprints) as unknown as Prisma.InputJsonValue,
```

:611 (SUCCEEDED):

```ts
result: attachTestedDistinctions(
  finalItems.map((item) => item.ok && item.question.type === "mcq"
    ? { ...item, question: shuffleMcqChoices(item.question) as ImportQuestion }
    : item),
  blueprints,
) as unknown as Prisma.InputJsonValue,
```

`approveJob` (:859–876) — 수집 타입을 바꾸고 distinction을 함께 전달:

```ts
const questions: ImportQuestionInput[] = [];
for (const index of indices) {
  const item = byIndex.get(index);
  const appliedQuestion = appliedByIndex.get(index);
  if (!item || !item.ok || (item.verdict === "fail" && !appliedQuestion)) {
    throw new ServiceError("INVALID_ITEMS", "저장할 수 없는 항목이 포함되어 있습니다", 400);
  }
  questions.push({
    question: (appliedQuestion ?? item.question) as unknown as ImportQuestion,
    testedDistinction: item.testedDistinction ?? null,
  });
}
```

`ImportQuestionInput`은 `../import-service`에서 type import.

- [ ] **Step 4: 통과 확인 + 전체 회귀**

Run: `npx vitest run src/server/generation/generation-service.test.ts` → PASS
Run: `npm test` → 전체 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/api-types.ts src/server/generation/generation-service.ts src/server/generation/generation-service.test.ts
git commit -m "feat: 생성 결과에 testedDistinction을 실어 저장까지 전달"
```

---

### Task 6: 최종 검증

- [ ] **Step 1: 전체 테스트·린트·타입 체크**

```bash
npm test        # 전체 PASS
npm run lint    # 오류 0
npx tsc --noEmit
```

- [ ] **Step 2: E2E 수동 검증** (엔진 CLI 실행 필요 — `/verify` 스킬 절차 준수)

1. `npm run dev`로 앱 실행, 아무 주제에서 생성 잡 1개 실행 → 완료 후 항목 저장(approve).
2. DB 확인: `SELECT id, tested_distinction FROM question ORDER BY id DESC LIMIT 5;` → 방금 저장한 문제에 블루프린트의 testedDistinction이 들어 있어야 함.
3. 같은 주제로 생성 잡을 하나 더 만들고 `generation_run_log`의 BLUEPRINT 단계 prompt를 확인 → "기존 출제 개념 목록" 아래에 2번의 distinction이 보이고, 문제 전문 요약("기존 문제 목록")은 더 이상 없어야 함.
4. 수동 JSON 가져오기 화면에서 문제 1개 import → `tested_distinction`이 NULL로 저장되는지 확인.

- [ ] **Step 3: 필요 시 수정 후 마무리 커밋 (검증 산출물이 있으면)**

## 검증 요약 (Verification)

- 단위: `npm test` — prompt 문구, 헬퍼 부착 규칙, import 영속화, approve 전달, 구버전 잡 호환.
- 정적: `npm run lint`, `npx tsc --noEmit`.
- E2E: 생성→저장→재생성 사이클에서 (1) 컬럼 영속화, (2) 다음 잡 프롬프트에 distinction 목록 등장, (3) 프롬프트에서 문제 전문 요약 제거 확인 (Task 6 Step 2).

## Self-Review 결과

- 범위 커버리지: 요구사항(프롬프트 토큰 절감 + 신규 문제만 대상, 백필 없음)이 Task 1~5로 모두 매핑됨.
- 타입 일관성: `ExistingQuestions.distinctions`(T3) ↔ `loadExistingQuestions`(T3) ↔ 테스트 픽스처(T3), `ImportQuestionInput`(T4) ↔ `approveJob`(T5), `DistinctionTaggedItemResult`(T2) ↔ runJob 저장(T5) 확인.
- 의도적 제외: 구세대 문제 백필, `buildCliGenerationPrompt`(데드 코드) 삭제, UI 표시, `EXISTING_QUESTION_LIMIT` 조정.
