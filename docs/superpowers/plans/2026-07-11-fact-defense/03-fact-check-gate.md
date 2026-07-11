# 사실 오류 방어 3/3 — 블루프린트 fact-check 게이트 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 문제 생성 파이프라인에서 블루프린트의 `referenceFacts`를 별도 엔진 호출로 공식 문서와 대조하고, 반박된(refuted) 사실을 참조하는 블루프린트를 생성에서 제외하며, 오염된 참고 자료 파일을 `verifyWarning`으로 지목한다.

**Architecture:** 게이트 판단 로직은 순수 함수로 `src/core/fact-check.ts`에 둔다(사실 목록 추출 `buildFactEntries`, 판정 적용 `gateBlueprints`, 결과 파서 `parseFactCheckJson`). `runJob`(generation-service)은 블루프린트 확정 직후 `runEngine`을 1회 추가 호출해 판정을 받고 순수 함수에 위임한다. 엔진 실패·파싱 실패·unverifiable은 생성을 막지 않고 경고만 남긴다(가용성 우선). refuted만 차단한다.

**Tech Stack:** Next.js(주의: `node_modules/next/dist/docs/`의 문서를 따를 것), Prisma 7 + MariaDB, zod 4, vitest.

**선행 조건:** `01-prompt-priority-and-dissent.md`의 Task 2(프롬프트 우선순위) 완료 권장.

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-11-fact-defense-design.md`
- `master` 브랜치에서 직접 작업, 태스크당 1커밋, 커밋 메시지 한국어(타입 접두사 영어).
- 테스트: `npm test`.
- `.env`는 절대 커밋하지 않는다.

---

### Task 1: fact-check 파서·게이트 순수 함수 + 프롬프트 빌더

**Files:**
- Create: `src/core/fact-check.ts`
- Create: `src/core/fact-check.test.ts`
- Modify: `src/core/prompt-template.ts` (`buildCliFactCheckPrompt` 추가)
- Test: `src/core/prompt-template.test.ts`

**Interfaces:**
- Consumes: `QuestionBlueprint` (`src/core/question-blueprint.ts` — `referenceFacts: Array<{ id, statement, sourceFile }>`)
- Produces:
  - `FactEntry { id: string; statement: string; sourceFile: string }`
  - `buildFactEntries(blueprints: QuestionBlueprint[]): FactEntry[]` — statement 기준 중복 제거, id는 `F1`부터 부여
  - `FactCheckVerdict { id: string; verdict: "confirmed" | "refuted" | "unverifiable"; url: string | null; note: string | null }`
  - `parseFactCheckJson(rawText: string): { ok: true; verdicts: FactCheckVerdict[] } | { ok: false; fatal: string }`
  - `gateBlueprints(blueprints: QuestionBlueprint[], entries: FactEntry[], verdicts: FactCheckVerdict[]): { blueprints: QuestionBlueprint[]; warning: string | null }`
  - `buildCliFactCheckPrompt(topicName: string, facts: FactEntry[], resultPath: string): string`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/fact-check.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { QuestionBlueprint } from "./question-blueprint";
import { buildFactEntries, gateBlueprints, parseFactCheckJson } from "./fact-check";

function blueprint(id: string, facts: Array<{ id: string; statement: string; sourceFile: string }>): QuestionBlueprint {
  return {
    id,
    domainTask: "task",
    testedDistinction: "distinction",
    referenceFacts: facts,
    constraints: [{ id: "c1", statement: "constraint", kind: "FUNCTIONAL", factIds: [facts[0].id] }],
    choices: [{ id: "a", solution: "sol", serviceNames: ["svc"], satisfiedConstraintIds: ["c1"], violatedConstraintIds: [], misconception: "m", correct: true }],
    reasoningSteps: ["step"],
  };
}

describe("buildFactEntries", () => {
  it("statement 기준으로 중복을 제거하고 F1부터 id를 부여한다", () => {
    const blueprints = [
      blueprint("b1", [{ id: "f1", statement: "사실 A", sourceFile: "d1/a.md" }]),
      blueprint("b2", [
        { id: "f1", statement: "사실 A", sourceFile: "d1/a.md" },
        { id: "f2", statement: "사실 B", sourceFile: "d1/b.md" },
      ]),
    ];
    expect(buildFactEntries(blueprints)).toEqual([
      { id: "F1", statement: "사실 A", sourceFile: "d1/a.md" },
      { id: "F2", statement: "사실 B", sourceFile: "d1/b.md" },
    ]);
  });
});

describe("parseFactCheckJson", () => {
  it("facts 배열을 파싱한다", () => {
    const result = parseFactCheckJson(
      JSON.stringify({
        facts: [
          { id: "F1", verdict: "refuted", url: "https://docs.aws.amazon.com/x", note: "승인 워크플로 없음" },
          { id: "F2", verdict: "confirmed" },
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      verdicts: [
        { id: "F1", verdict: "refuted", url: "https://docs.aws.amazon.com/x", note: "승인 워크플로 없음" },
        { id: "F2", verdict: "confirmed", url: null, note: null },
      ],
    });
  });

  it("facts 배열이 없으면 실패한다", () => {
    expect(parseFactCheckJson(JSON.stringify({}))).toMatchObject({ ok: false });
  });

  it("형식이 어긋난 항목은 건너뛴다", () => {
    const result = parseFactCheckJson(
      JSON.stringify({ facts: [{ id: "F1", verdict: "maybe" }, { id: "F2", verdict: "confirmed" }] }),
    );
    expect(result).toEqual({ ok: true, verdicts: [{ id: "F2", verdict: "confirmed", url: null, note: null }] });
  });
});

describe("gateBlueprints", () => {
  const factA = { id: "f1", statement: "사실 A", sourceFile: "d1/a.md" };
  const factB = { id: "f1", statement: "사실 B", sourceFile: "d1/b.md" };
  const blueprints = [blueprint("b1", [factA]), blueprint("b2", [factB])];
  const entries = [
    { id: "F1", statement: "사실 A", sourceFile: "d1/a.md" },
    { id: "F2", statement: "사실 B", sourceFile: "d1/b.md" },
  ];

  it("refuted 사실을 참조하는 블루프린트를 제외하고 출처를 경고에 담는다", () => {
    const result = gateBlueprints(blueprints, entries, [
      { id: "F1", verdict: "refuted", url: null, note: "공식 문서에 없음" },
      { id: "F2", verdict: "confirmed", url: null, note: null },
    ]);
    expect(result.blueprints.map((item) => item.id)).toEqual(["b2"]);
    expect(result.warning).toContain("사실 A");
    expect(result.warning).toContain("d1/a.md");
    expect(result.warning).toContain("공식 문서에 없음");
  });

  it("unverifiable은 차단하지 않고 경고만 남긴다", () => {
    const result = gateBlueprints(blueprints, entries, [
      { id: "F1", verdict: "unverifiable", url: null, note: null },
      { id: "F2", verdict: "confirmed", url: null, note: null },
    ]);
    expect(result.blueprints.map((item) => item.id)).toEqual(["b1", "b2"]);
    expect(result.warning).toContain("확인 불가");
  });

  it("전부 confirmed면 경고 없이 전부 통과한다", () => {
    const result = gateBlueprints(blueprints, entries, [
      { id: "F1", verdict: "confirmed", url: null, note: null },
      { id: "F2", verdict: "confirmed", url: null, note: null },
    ]);
    expect(result.blueprints).toHaveLength(2);
    expect(result.warning).toBeNull();
  });

  it("판정이 누락된 사실은 unverifiable로 취급한다", () => {
    const result = gateBlueprints(blueprints, entries, [
      { id: "F2", verdict: "confirmed", url: null, note: null },
    ]);
    expect(result.blueprints).toHaveLength(2);
    expect(result.warning).toContain("확인 불가");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/core/fact-check.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 구현**

`src/core/fact-check.ts`:

```ts
import { z } from "zod";
import type { QuestionBlueprint } from "./question-blueprint";

export interface FactEntry {
  id: string;
  statement: string;
  sourceFile: string;
}

export function buildFactEntries(blueprints: QuestionBlueprint[]): FactEntry[] {
  const byStatement = new Map<string, { statement: string; sourceFile: string }>();
  for (const blueprint of blueprints) {
    for (const fact of blueprint.referenceFacts) {
      if (!byStatement.has(fact.statement)) {
        byStatement.set(fact.statement, { statement: fact.statement, sourceFile: fact.sourceFile });
      }
    }
  }
  return [...byStatement.values()].map((fact, index) => ({
    id: `F${index + 1}`,
    statement: fact.statement,
    sourceFile: fact.sourceFile,
  }));
}

const factCheckVerdictSchema = z.object({
  id: z.string().trim().min(1),
  verdict: z.enum(["confirmed", "refuted", "unverifiable"]),
  url: z.string().optional(),
  note: z.string().optional(),
});

export interface FactCheckVerdict {
  id: string;
  verdict: "confirmed" | "refuted" | "unverifiable";
  url: string | null;
  note: string | null;
}

export type FactCheckParseResult =
  | { ok: true; verdicts: FactCheckVerdict[] }
  | { ok: false; fatal: string };

export function parseFactCheckJson(rawText: string): FactCheckParseResult {
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    return { ok: false, fatal: "올바른 JSON이 아닙니다" };
  }

  const facts =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>).facts
      : undefined;
  if (!Array.isArray(facts)) {
    return { ok: false, fatal: "최상위에 facts 배열이 있어야 합니다" };
  }

  const parsed: FactCheckVerdict[] = [];
  for (const raw of facts) {
    const result = factCheckVerdictSchema.safeParse(raw);
    // 형식이 어긋난 판정은 건너뛴다 — 해당 사실은 unverifiable로 취급된다.
    if (!result.success) continue;
    parsed.push({
      id: result.data.id,
      verdict: result.data.verdict,
      url: result.data.url?.trim() || null,
      note: result.data.note?.trim() || null,
    });
  }
  return { ok: true, verdicts: parsed };
}

export function gateBlueprints(
  blueprints: QuestionBlueprint[],
  entries: FactEntry[],
  verdicts: FactCheckVerdict[],
): { blueprints: QuestionBlueprint[]; warning: string | null } {
  const verdictById = new Map(verdicts.map((verdict) => [verdict.id, verdict]));
  const refuted = entries.filter((entry) => verdictById.get(entry.id)?.verdict === "refuted");
  const unverifiableCount = entries.filter((entry) => {
    const verdict = verdictById.get(entry.id);
    return !verdict || verdict.verdict === "unverifiable";
  }).length;

  const refutedStatements = new Set(refuted.map((entry) => entry.statement));
  const passed = blueprints.filter(
    (blueprint) => !blueprint.referenceFacts.some((fact) => refutedStatements.has(fact.statement)),
  );

  const warnings: string[] = [];
  for (const entry of refuted) {
    const note = verdictById.get(entry.id)?.note;
    warnings.push(
      `반박된 사실: "${entry.statement}" (출처: ${entry.sourceFile}${note ? `, 근거: ${note}` : ""})`,
    );
  }
  if (unverifiableCount > 0) {
    warnings.push(`확인 불가 사실 ${unverifiableCount}건은 통과 처리했습니다.`);
  }

  return { blueprints: passed, warning: warnings.length ? warnings.join(" ") : null };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/core/fact-check.test.ts`
Expected: PASS

- [ ] **Step 5: 프롬프트 빌더 테스트 → 구현**

`src/core/prompt-template.test.ts`에 추가:

```ts
describe("buildCliFactCheckPrompt", () => {
  it("사실 목록과 판정 계약을 포함한다", () => {
    const prompt = buildCliFactCheckPrompt(
      "주제",
      [{ id: "F1", statement: "Bedrock Prompt Management provides approval workflow", sourceFile: "d1/a.md" }],
      "C:/out/factcheck.json",
    );
    expect(prompt).toContain("F1");
    expect(prompt).toContain("Bedrock Prompt Management provides approval workflow");
    expect(prompt).toContain("confirmed");
    expect(prompt).toContain("refuted");
    expect(prompt).toContain("unverifiable");
    expect(prompt).toContain("C:/out/factcheck.json");
  });
});
```

Run: `npx vitest run src/core/prompt-template.test.ts` → FAIL 확인.

`src/core/prompt-template.ts`에 추가 (블루프린트 빌더들 근처, 영문 프롬프트 스타일 유지). 파일 상단에 `import type { FactEntry } from "./fact-check";` 추가:

```ts
export function buildCliFactCheckPrompt(
  topicName: string,
  facts: FactEntry[],
  resultPath: string,
): string {
  const listing = facts
    .map((fact) => `- ${fact.id}: ${fact.statement}`)
    .join("\n");

  return `You are a fact-checker for exam questions about "${topicName}". Verify each claim below against current official vendor documentation (for AWS topics, https://docs.aws.amazon.com/).

Use WebSearch/WebFetch/browsing tools. Rules:
- "confirmed": official documentation clearly supports the claim. Include the supporting URL.
- "refuted": official documentation contradicts the claim, or the claimed capability does not exist as a native feature. Include the URL and a one-line note explaining the contradiction.
- "unverifiable": you cannot confirm or refute with official documentation, or web tools are unavailable. Never guess.
- Judge native capability claims strictly: "service X provides Y" is confirmed only if Y is a built-in feature of X, not something you could assemble around X.

Claims:
${listing}

Output only this JSON shape:
{
  "facts": [
    { "id": "F1", "verdict": "refuted", "url": "https://docs.aws.amazon.com/...", "note": "short reason" }
  ]
}

- Return exactly one entry per claim id above.
- Write the JSON as UTF-8 to ${resultPath}; do not print it to stdout.
`;
}
```

Run: `npx vitest run src/core/prompt-template.test.ts` → PASS 확인.

- [ ] **Step 6: 커밋**

```bash
npm test
git add src/core/fact-check.ts src/core/fact-check.test.ts src/core/prompt-template.ts src/core/prompt-template.test.ts
git commit -m "feat: 블루프린트 사실 검증 파서·게이트·프롬프트 추가"
```

---

### Task 2: runJob 파이프라인 통합

**Files:**
- Modify: `src/server/generation/generation-service.ts` (`runJob`)

**Interfaces:**
- Consumes: Task 1의 `buildFactEntries`, `gateBlueprints`, `parseFactCheckJson`, `buildCliFactCheckPrompt`; 기존 `runEngine(engine, prompt, dir, prefix?)`
- Produces: 없음 (파이프라인 내부). `verifyWarning`에 fact-check 경고가 합쳐진다.

- [ ] **Step 1: 통합 코드 작성**

`src/server/generation/generation-service.ts`에 import 추가:

```ts
import { buildFactEntries, gateBlueprints, parseFactCheckJson } from "@/core/fact-check";
// buildCliFactCheckPrompt는 기존 @/core/prompt-template import 블록에 항목만 추가
```

`runJob`에서 구조 게이트 통과 블루프린트를 확정하는 지점(현재 379-385행):

```ts
  const blueprints = assessments.filter((item) => item.assessment.pass).map((item) => item.blueprint);
  if (!blueprints.length) {
    await failJob(jobId, "No question blueprints passed the structural difficulty gate.", blueprintRun.resultText);
    return;
  }
  const excluded = assessments.filter((item) => !item.assessment.pass);
  const blueprintWarning = excluded.length ? `${excluded.length} blueprint(s) were excluded after one repair attempt.` : null;
```

이 블록 바로 뒤에 fact-check 게이트를 삽입하고, 이후 코드가 쓰는 `blueprints`를 게이트 통과본으로 교체한다. 기존 `const blueprints`를 `structurallyPassed`로 rename하고 다음을 추가:

```ts
  const structurallyPassed = assessments.filter((item) => item.assessment.pass).map((item) => item.blueprint);
  if (!structurallyPassed.length) {
    await failJob(jobId, "No question blueprints passed the structural difficulty gate.", blueprintRun.resultText);
    return;
  }
  const excluded = assessments.filter((item) => !item.assessment.pass);
  const blueprintWarning = excluded.length ? `${excluded.length} blueprint(s) were excluded after one repair attempt.` : null;

  // 사실 검증 게이트: refuted 사실을 참조하는 블루프린트는 생성에서 제외한다.
  let blueprints = structurallyPassed;
  let factCheckWarning: string | null = null;
  const factEntries = buildFactEntries(structurallyPassed);
  if (factEntries.length > 0) {
    const factCheckPath = path.join(dir, "factcheck-result.json");
    const factRun = await runEngine(
      job.verifyEngine,
      buildCliFactCheckPrompt(topicName, factEntries, factCheckPath),
      dir,
      "factcheck-",
    );
    if (!factRun.ok) {
      factCheckWarning = `사실 검증 단계를 건너뛰었습니다: ${factRun.failureReason}`;
    } else {
      const factParsed = parseFactCheckJson(extractJsonObject(factRun.resultText));
      if (!factParsed.ok) {
        factCheckWarning = `사실 검증 결과를 해석하지 못했습니다: ${factParsed.fatal}`;
      } else {
        const gated = gateBlueprints(structurallyPassed, factEntries, factParsed.verdicts);
        blueprints = gated.blueprints;
        factCheckWarning = gated.warning;
      }
    }
  }
  if (!blueprints.length) {
    await failJob(jobId, "모든 블루프린트가 사실 검증에서 반박된 사실을 참조합니다. 참고 자료를 점검하세요.", blueprintRun.resultText);
    return;
  }
```

주의사항:
- 이후 코드(`buildCliGenerationFromBlueprintPrompt(topicName, blueprints, ...)`, `parsed.items.length !== blueprints.length` 검사, `blueprints[item.index]` 참조)는 전부 게이트 통과본 `blueprints`를 그대로 쓰므로 변경이 필요 없다 — rename과 삽입만 정확히 하면 된다.
- 최종 `verifyWarning` 저장부(현재 522행)를 다음으로 교체:

```ts
      verifyWarning: [blueprintWarning, factCheckWarning, verifyWarning].filter(Boolean).join(" ") || null,
```

- [ ] **Step 2: 타입·전체 테스트 확인**

Run: `npx tsc --noEmit && npm test`
Expected: 통과 (게이트 로직 자체는 Task 1의 순수 함수 테스트가 커버한다)

- [ ] **Step 3: 실동 확인**

`npm run dev` 후 생성 화면에서 AIP-C01 주제로 소량(1-2문항) 생성 잡을 실행한다.
- `generation_output/<jobId>/factcheck-result.json`이 생성되는지 확인.
- 잡 상세 화면의 verifyWarning에 fact-check 경고(있다면)가 표시되는지 확인.
- 01번 계획 Task 1을 아직 적용하지 않은 상태라면, 오염된 참고 자료로 생성 시 "반박된 사실 … (출처: d1/bedrock-models-data.md)" 경고가 뜨는 것이 기대 동작이다.

- [ ] **Step 4: 커밋**

```bash
git add src/server/generation/generation-service.ts
git commit -m "feat: 문제 생성 파이프라인에 블루프린트 사실 검증 게이트 통합"
```

---

## 완료 후 확인 체크리스트 (세 계획 공통)

- [ ] `npm test` 전체 통과, `npx tsc --noEmit` 통과
- [ ] question 57: 사실 감사 잡으로 fail 검출 → 문항 편집으로 수정 (정답 선지·explanation에서 "승인 워크플로" 단정 제거) → 기존 AI 해설 2건 삭제 후 재생성
- [ ] 새 생성 잡에서 verifyWarning에 fact-check 결과가 반영되는지 확인
