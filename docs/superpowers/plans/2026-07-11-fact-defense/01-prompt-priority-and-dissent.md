# 사실 오류 방어 1/3 — 프롬프트 우선순위 통일 + 이의 제기 출구 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 참고 자료가 오염돼도 AI 파이프라인(생성·검증·해설·선지 강화)이 사실 오류를 따라가지 않도록, 프롬프트 사실 우선순위를 통일하고 하류 단계에 `factual_concern` 이의 제기 출구를 추가한다.

**Architecture:** 모든 프롬프트는 `src/core/prompt-template.ts`에 모여 있고 공통 섹션(`referenceSection`, `webVerificationSection`)을 공유한다. 공통 섹션의 "자료 우선" 지시를 "공식 웹 문서 > 참고 자료 > 모델 기억" 우선순위로 교체하면 전 기능에 전파된다. AI 해설·선지 강화는 출력 스키마에 선택 필드 `factual_concern`을 추가해 정답 자체의 사실 오류를 보고할 수 있게 하고, DB(`AnswerExplanation.factual_concern`)와 UI(학습 화면 `ResultPanel.tsx`)에 표출한다.

**Tech Stack:** Next.js(주의: `node_modules/next/dist/docs/`의 문서를 따를 것), Prisma 7 + MariaDB, zod 4, vitest.

**전체 실행 순서:** 이 파일(01) → `02-audit-job.md` → `03-fact-check-gate.md`. 세 파일은 독립적으로도 동작하지만 이 순서를 권장한다.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-11-fact-defense-design.md`
- `master` 브랜치에서 직접 작업한다. 피처 브랜치·워크트리를 만들지 않는다.
- 커밋 메시지는 한국어, conventional-commit 타입 접두사는 영어(`feat:`, `fix:`, `test:`, `chore:`, `docs:`). 태스크당 1커밋.
- 사용자-facing 문구의 이모지는 유지·사용한다(예: ⚠️ 경고 배지).
- 테스트 실행: `npm test` (vitest run). 특정 파일만: `npx vitest run src/core/prompt-template.test.ts`.
- Prisma 마이그레이션은 원격 MariaDB(.env의 DATABASE_URL)에 적용된다: `npx prisma migrate dev --name <이름>`.
- `.env`는 절대 커밋하지 않는다.

---

### Task 1: 참고 자료 오류 서술 수정

Bedrock Prompt Management에는 네이티브 승인·반려 워크플로가 없다. 참고 자료의 오류 서술이 question 57 오류의 뿌리이므로 먼저 고친다.

**Files:**
- Modify: `generation_reference/aip-c01/d1/bedrock-models-data.md:51`

**Interfaces:**
- Consumes: 없음
- Produces: 없음 (데이터 수정)

- [ ] **Step 1: 오류 서술 교체**

51행의 기존 줄:

```markdown
- Bedrock Prompt Management로 역할 정의, 파라미터화된 템플릿, 승인 워크플로를 관리한다.
```

다음으로 교체:

```markdown
- Bedrock Prompt Management로 역할 정의, 파라미터화된 템플릿, 버전 관리(draft→version 스냅샷)를 제공한다. 네이티브 승인·반려 워크플로는 없으므로, 배포 전 승인이 필요하면 외부 프로세스(티켓 승인, 코드 리뷰 등)와 결합해야 한다.
```

- [ ] **Step 2: 커밋**

```bash
git add generation_reference/aip-c01/d1/bedrock-models-data.md
git commit -m "fix: AIP-C01 참고 자료의 Prompt Management 승인 워크플로 오류 서술 수정"
```

---

### Task 2: 프롬프트 사실 우선순위 통일 + 검증자 재갈 제거

**Files:**
- Modify: `src/core/prompt-template.ts` (`referenceSection` 171-186행, `buildCliVerifyPrompt` 335행 근처, `buildCliRevisionPrompt` 469행)
- Test: `src/core/prompt-template.test.ts`

**Interfaces:**
- Consumes: 기존 `buildCliVerifyPrompt(topicName, items, resultPath, referenceFiles)`, `buildCliRevisionPrompt(...)` 시그니처 (변경 없음)
- Produces: 프롬프트 문구만 변경. 이후 태스크는 "사실 우선순위:" 문구가 존재한다고 가정한다.

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/prompt-template.test.ts` 끝에 추가:

```ts
describe("사실 우선순위 지시", () => {
  const sampleBlueprint = {
    id: "b1",
    domainTask: "task",
    testedDistinction: "distinction",
    referenceFacts: [{ id: "f1", statement: "fact", sourceFile: "d1/a.md" }],
    constraints: [{ id: "c1", statement: "constraint", kind: "FUNCTIONAL" as const, factIds: ["f1"] }],
    choices: [{ id: "a", solution: "solution", serviceNames: ["svc"], satisfiedConstraintIds: ["c1"], violatedConstraintIds: [], misconception: "reason", correct: true }],
    reasoningSteps: ["step"],
  };

  it("referenceSection이 공식 문서 우선순위를 명시하고 자료 우선 지시를 제거한다", () => {
    const prompt = buildCliVerifyPrompt("주제", [{ index: 0, question: {} }], "C:/out/result.json", ["C:/ref/a.md"]);
    expect(prompt).toContain("사실 우선순위: 최신 공식 웹 문서 > 참고 자료 > 당신의 기억");
    expect(prompt).toContain("공식 웹 문서로 확인");
    expect(prompt).not.toContain("자료와 당신의 기억이 다르면 자료를 우선하세요");
  });

  it("verify 프롬프트에서 사실 정확성이 블루프린트보다 우선한다", () => {
    const prompt = buildCliVerifyPrompt("주제", [{ index: 0, question: {}, blueprint: sampleBlueprint }], "C:/out/result.json");
    expect(prompt).toContain("factual accuracy overrides the blueprint");
    expect(prompt).not.toContain("are immutable");
  });

  it("revision 프롬프트가 사실 오류 수정을 허용한다", () => {
    const prompt = buildCliRevisionPrompt("주제", { type: "mcq" }, "지시", "C:/out/result.json", [], sampleBlueprint);
    expect(prompt).not.toContain("unchanged");
    expect(prompt).toContain("correct factual errors");
  });
});
```

파일 상단 import에 `buildCliRevisionPrompt`, `buildCliVerifyPrompt`가 없으면 추가한다 (이미 있으면 그대로).

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/core/prompt-template.test.ts`
Expected: 새 테스트 3개 FAIL (기존 문구가 아직 남아 있음)

- [ ] **Step 3: 구현**

`referenceSection` 함수 본문의 안내 4줄을 교체한다. 기존:

```ts
    "- 문제와 정답의 사실 관계는 반드시 위 자료 내용에 근거해야 합니다.",
    "- 자료에 없는 내용을 기억이나 추측으로 출제하지 마세요.",
    "- 자료와 당신의 기억이 다르면 자료를 우선하세요.",
    "- 읽을 수 없는 파일이 있으면 그 파일은 무시하고 진행하세요.",
```

교체 후:

```ts
    "- 사실 우선순위: 최신 공식 웹 문서 > 참고 자료 > 당신의 기억.",
    "- 참고 자료는 출제 범위와 스타일의 근거입니다. 자료에 없는 범위를 기억이나 추측으로 출제하지 마세요.",
    "- 서비스가 특정 기능을 기본 제공한다는 주장은 자료에 적혀 있어도 공식 웹 문서로 확인하고, 확인할 수 없으면 그 주장을 정답의 근거로 삼지 마세요.",
    "- 읽을 수 없는 파일이 있으면 그 파일은 무시하고 진행하세요.",
```

`buildCliVerifyPrompt`의 Blueprint conformance 문장(335행 근처) 기존:

```ts
${blueprintListing ? `## Blueprint conformance\nFacts, correct answers, constraints, and service relationships are immutable. Fail decorative constraints and presentation clues: ...` : ""}
```

앞부분만 다음으로 교체(뒤의 "Fail decorative constraints..." 이하는 유지):

```ts
${blueprintListing ? `## Blueprint conformance\nUse the blueprint as design intent, but factual accuracy overrides the blueprint: if a blueprint fact, the designated correct answer, or a service capability claim contradicts current official documentation, fail that question and explain why. Fail decorative constraints and presentation clues: ...` : ""}
```

`buildCliRevisionPrompt`의 immutable 지시(469행) 기존:

```ts
const questionWithBlueprint = blueprint ? { question, blueprint, immutable: "Keep blueprint facts, answers, constraints, and service relationships unchanged." } : question;
```

교체 후:

```ts
const questionWithBlueprint = blueprint ? { question, blueprint, blueprintGuide: "Keep the blueprint's tested distinction and structure, but correct factual errors: if a blueprint fact or the designated answer contradicts current official documentation, fix the question accordingly and explain in the comment." } : question;
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/core/prompt-template.test.ts`
Expected: 전체 PASS

- [ ] **Step 5: 전체 테스트 및 커밋**

```bash
npm test
git add src/core/prompt-template.ts src/core/prompt-template.test.ts
git commit -m "feat: 프롬프트 사실 우선순위 통일 및 검증 단계 사실 오류 우선 지시"
```

---

### Task 3: AI 해설 factual_concern — 스키마·DB·서비스

**Files:**
- Modify: `prisma/schema.prisma` (`AnswerExplanation` 모델)
- Modify: `src/core/explanation-schema.ts`
- Modify: `src/core/prompt-template.ts` (`buildAnswerExplanationPrompt`)
- Modify: `src/server/explanation-service.ts`
- Modify: `src/lib/api-types.ts` (`AnswerExplanationDto`)
- Test: `src/core/explanation-schema.test.ts`, `src/core/prompt-template.test.ts`

**Interfaces:**
- Consumes: `parseExplanationJson(rawText, type, payload)` 기존 시그니처 유지
- Produces:
  - `ExplanationParseResult` ok 분기에 `factualConcern: string | null` 추가
  - `AnswerExplanation` 테이블에 `factual_concern TEXT NULL` 컬럼
  - `AnswerExplanationDto`에 `factualConcern: string | null`
  - `getAnswerExplanation` 반환 객체에 `factualConcern: string | null`

- [ ] **Step 1: 실패하는 스키마 테스트 작성**

`src/core/explanation-schema.test.ts` 끝에 추가:

```ts
describe("factual_concern", () => {
  it("factual_concern이 있으면 파싱 결과에 포함한다", () => {
    const result = parseExplanationJson(
      JSON.stringify({
        explanation: "해설",
        factual_concern: "정답 전제가 공식 문서와 다릅니다. https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-management.html",
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      factualConcern: "정답 전제가 공식 문서와 다릅니다. https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-management.html",
    });
  });

  it("factual_concern이 없으면 null이다", () => {
    const result = parseExplanationJson(JSON.stringify({ explanation: "해설" }));
    expect(result).toMatchObject({ ok: true, factualConcern: null });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/core/explanation-schema.test.ts`
Expected: FAIL (`factualConcern` 필드 없음)

- [ ] **Step 3: 스키마 구현**

`src/core/explanation-schema.ts`:

```ts
const explanationSchema = z.object({
  explanation: z.string().trim().min(1, "explanation은 비어 있으면 안 됩니다"),
  factual_concern: z.string().trim().min(1).optional(),
});
```

`ExplanationParseResult` ok 분기에 `factualConcern: string | null` 추가:

```ts
export type ExplanationParseResult =
  | { ok: true; explanation: string; choiceExplanations: ChoiceExplanation[] | null; factualConcern: string | null }
  | { ok: false; fatal: string };
```

두 곳의 성공 return에 각각 추가 (`mcqExplanationSchema`는 `explanationSchema.extend`이므로 필드를 상속한다):

```ts
    return { ok: true, explanation: parsed.data.explanation, choiceExplanations: null, factualConcern: parsed.data.factual_concern ?? null };
```

```ts
  return {
    ok: true,
    explanation: parsed.data.explanation,
    factualConcern: parsed.data.factual_concern ?? null,
    choiceExplanations: choiceExplanations.map((item) => ({
      choice: item.choice,
      explanation: item.explanation,
      awsReference: item.aws_reference,
    })),
  };
```

- [ ] **Step 4: 스키마 테스트 통과 확인**

Run: `npx vitest run src/core/explanation-schema.test.ts`
Expected: PASS

- [ ] **Step 5: 프롬프트 테스트 추가 후 프롬프트 구현**

`src/core/prompt-template.test.ts`에 추가:

```ts
describe("해설 프롬프트 factual_concern", () => {
  it("정답 이의 제기 지시와 출력 필드를 포함한다", () => {
    const prompt = buildAnswerExplanationPrompt(
      "MCQ",
      { question: "Q", choices: ["a", "b"], answer_index: 0 },
      "C:/out/result.json",
    );
    expect(prompt).toContain("factual_concern");
    expect(prompt).toContain("정답 표기 자체가");
  });
});
```

Run: `npx vitest run src/core/prompt-template.test.ts` → 새 테스트 FAIL 확인.

`buildAnswerExplanationPrompt`의 요구 사항 목록(`- 한국어로, ...` 줄 위)에 추가:

```
- 이 문제의 정답 표기 자체가 최신 공식 문서와 다르다고 판단되면, 해설은 위 지침대로 작성하되 출력 JSON의 factual_concern 필드에 무엇이 왜 다른지와 근거 공식 문서 URL을 함께 적으세요. 확신이 없으면 factual_concern을 넣지 마세요.
```

`outputShape` 두 형태(MCQ/CLOZE) 모두에 필드 추가. MCQ:

```
{
  "explanation": "여기에 전체 해설 텍스트",
  "factual_concern": "(선택) 정답 표기가 사실과 다르다고 판단한 이유와 근거 URL",
  "choice_explanations": [ ... 기존 그대로 ... ]
}
```

CLOZE:

```
{
  "explanation": "여기에 전체 해설 텍스트",
  "factual_concern": "(선택) 정답 표기가 사실과 다르다고 판단한 이유와 근거 URL"
}
```

Run: `npx vitest run src/core/prompt-template.test.ts` → PASS 확인.

- [ ] **Step 6: DB 마이그레이션**

`prisma/schema.prisma`의 `AnswerExplanation` 모델에 컬럼 추가:

```prisma
model AnswerExplanation {
  id                 Int              @id @default(autoincrement())
  questionId         Int              @map("question_id")
  engine             GenerationEngine
  content            String           @db.Text
  choiceExplanations Json?            @map("choice_explanations")
  factualConcern     String?          @map("factual_concern") @db.Text
  createdAt          DateTime         @default(now()) @map("created_at")
  question           Question         @relation(fields: [questionId], references: [id], onDelete: Cascade)

  @@unique([questionId, engine])
  @@map("answer_explanation")
}
```

Run: `npx prisma migrate dev --name add_explanation_factual_concern`
Expected: 마이그레이션 생성·적용, `prisma generate` 자동 실행

- [ ] **Step 7: 서비스 반영**

`src/server/explanation-service.ts`:

1. 반환 타입에 `factualConcern: string | null;` 추가.
2. 캐시 반환(existing 분기):

```ts
    return {
      engine,
      content: existing.content,
      choiceExplanations: existing.choiceExplanations as ChoiceExplanation[] | null,
      factualConcern: existing.factualConcern,
      cached: true,
    };
```

3. `prisma.answerExplanation.create`의 data에 `factualConcern: parsed.factualConcern,` 추가.
4. 마지막 return에 `factualConcern: parsed.factualConcern,` 추가.

`src/lib/api-types.ts`의 `AnswerExplanationDto`에 추가:

```ts
export interface AnswerExplanationDto {
  engine: GenerationEngineDto;
  content: string;
  choiceExplanations: ChoiceExplanationDto[] | null;
  factualConcern: string | null;
  cached: boolean;
}
```

- [ ] **Step 8: 전체 테스트·타입 확인 후 커밋**

```bash
npm test
npx tsc --noEmit
git add prisma/schema.prisma prisma/migrations src/core/explanation-schema.ts src/core/explanation-schema.test.ts src/core/prompt-template.ts src/core/prompt-template.test.ts src/server/explanation-service.ts src/lib/api-types.ts
git commit -m "feat: AI 해설에 factual_concern 이의 제기 필드 추가"
```

---

### Task 4: 선지 강화 factual_concern — 스키마·서비스

**Files:**
- Modify: `src/core/harden-schema.ts`
- Modify: `src/core/prompt-template.ts` (`buildChoiceHardeningPrompt`)
- Modify: `src/server/choice-hardening-service.ts`
- Modify: `src/lib/api-types.ts` (`HardenPreviewDto`)
- Test: `src/core/harden-schema.test.ts`, `src/core/prompt-template.test.ts`

**Interfaces:**
- Consumes: `parseHardenJson(rawText, original)` 기존 시그니처 유지
- Produces:
  - `HardenParseResult` ok 분기에 `factualConcern: string | null`
  - `HardenPreviewDto`에 `factualConcern: string | null`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/harden-schema.test.ts` 끝에 추가:

```ts
describe("factual_concern", () => {
  const original = {
    question: "Q",
    choices: ["a", "b", "c", "d"],
    answer_indices: [0],
    choice_explanations: ["e1", "e2", "e3", "e4"],
  };
  const revised = { ...original, choices: ["a", "x", "c", "d"] };

  it("factual_concern이 있으면 결과에 포함한다", () => {
    const result = parseHardenJson(
      JSON.stringify({ comment: "교체", factual_concern: "정답 선지가 공식 문서와 다릅니다", revised }),
      original,
    );
    expect(result).toMatchObject({ ok: true, factualConcern: "정답 선지가 공식 문서와 다릅니다" });
  });

  it("없으면 null이다", () => {
    const result = parseHardenJson(JSON.stringify({ comment: "교체", revised }), original);
    expect(result).toMatchObject({ ok: true, factualConcern: null });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/core/harden-schema.test.ts`
Expected: 새 테스트 FAIL

- [ ] **Step 3: 구현**

`src/core/harden-schema.ts`:

```ts
const hardenSchema = z.object({
  comment: z.string().trim().min(1),
  factual_concern: z.string().trim().min(1).optional(),
  revised: z.unknown(),
});

export type HardenParseResult =
  | { ok: true; comment: string; payload: McqPayload; factualConcern: string | null }
  | { ok: false; fatal: string };
```

마지막 성공 return:

```ts
  return { ok: true, comment: outer.data.comment, payload, factualConcern: outer.data.factual_concern ?? null };
```

`buildChoiceHardeningPrompt`의 불변 조건 목록 아래에 지시 추가:

```
- 정답 선지 자체가 최신 공식 문서와 다르다고 판단되면, 교체 작업은 위 규칙대로 진행하되 factual_concern 필드에 이유와 근거 공식 문서 URL을 적으세요. 확신이 없으면 넣지 마세요.
```

출력 형식 JSON에 필드 추가:

```
{
  "comment": "어떤 오답을 왜 교체했는지 간결한 한국어 설명",
  "factual_concern": "(선택) 정답 선지가 사실과 다르다고 판단한 이유와 근거 URL",
  "revised": { ... 기존 그대로 ... }
}
```

프롬프트 테스트(`src/core/prompt-template.test.ts`)에 추가:

```ts
describe("선지 강화 프롬프트 factual_concern", () => {
  it("이의 제기 지시와 출력 필드를 포함한다", () => {
    const prompt = buildChoiceHardeningPrompt(
      "주제",
      { question: "Q", choices: ["a", "b", "c", "d"], answer_index: 0 },
      "C:/out/result.json",
    );
    expect(prompt).toContain("factual_concern");
  });
});
```

`src/lib/api-types.ts`:

```ts
export interface HardenPreviewDto {
  engine: GenerationEngineDto;
  comment: string;
  factualConcern: string | null;
  payload: HardenedMcqPayloadDto;
}
```

`src/server/choice-hardening-service.ts`의 return에 `factualConcern: parsed.factualConcern,` 추가.

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/core/harden-schema.test.ts src/core/prompt-template.test.ts`
Expected: PASS

- [ ] **Step 5: 전체 테스트·타입 확인 후 커밋**

```bash
npm test
npx tsc --noEmit
git add src/core/harden-schema.ts src/core/harden-schema.test.ts src/core/prompt-template.ts src/core/prompt-template.test.ts src/server/choice-hardening-service.ts src/lib/api-types.ts
git commit -m "feat: 선지 난이도 올리기에 factual_concern 이의 제기 필드 추가"
```

---

### Task 5: 학습 화면 ⚠️ 경고 표출

**Files:**
- Modify: `src/components/ResultPanel.tsx`

**Interfaces:**
- Consumes: Task 3의 `AnswerExplanationDto.factualConcern`, Task 4의 `HardenPreviewDto.factualConcern`
- Produces: 없음 (UI 표출)

- [ ] **Step 1: AI 해설 상태에 factualConcern 반영**

`ResultPanel.tsx`의 해설 상태 타입(31-32행 근처, `content`/`choiceExplanations`를 담는 곳)에 `factualConcern: string | null;`을 추가하고, API 응답을 상태에 넣는 곳(119-120행 근처)에 `factualConcern: res.factualConcern,`을 추가한다.

- [ ] **Step 2: 해설 렌더링에 경고 블록 추가**

해설 본문 `{state.content}`(199행 근처)를 렌더링하는 블록 바로 위에 추가한다 (색상 클래스는 파일 내 기존 팔레트 변수 스타일을 따르되 amber 계열 사용):

```tsx
{state.factualConcern && (
  <p className="mb-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
    ⚠️ 사실 확인 필요: {state.factualConcern}
  </p>
)}
```

- [ ] **Step 3: 선지 강화 미리보기에 경고 추가**

`ResultPanel.tsx`에서 `HardenPreviewDto`를 미리보기로 렌더링하는 부분(comment를 보여주는 곳)에 같은 형태로 추가:

```tsx
{hardenPreview.factualConcern && (
  <p className="mb-2 rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
    ⚠️ 사실 확인 필요: {hardenPreview.factualConcern}
  </p>
)}
```

(변수명은 파일 내 실제 harden 미리보기 상태 이름에 맞춘다.)

- [ ] **Step 4: 수동 확인 및 커밋**

Run: `npx tsc --noEmit && npm test`
Expected: 통과

`npm run dev`로 학습 화면에서 문제 풀이 → AI 해설 요청이 기존대로 동작하는지 확인한다(경고는 factualConcern이 채워진 응답에서만 보인다).

```bash
git add src/components/ResultPanel.tsx
git commit -m "feat: 학습 화면에 사실 확인 필요 경고 표출"
```
