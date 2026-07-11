# 사실 오류 방어 2/3 — 저장 문항 감사(AUDIT) 잡 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 이미 저장된 문항을 주제 단위 배치(최대 20문항)로 웹 검증 전용 프롬프트에 넣어 재감사하는 `AUDIT` 잡을 추가한다. question 57 같은 기존 오류 문항을 찾아내는 수단이다.

**Architecture:** 기존 `KEYWORD_TAG` 잡과 같은 패턴을 따른다: `GenerationJobKind`에 `AUDIT` 추가 → 전용 프롬프트 빌더 + 결과 파서(core) → `createAuditJob`/`runAuditJob`(service) → POST 라우트 + api-client → 문제 목록 페이지에서 트리거, 잡 상세 페이지에서 결과 표출. 감사 프롬프트는 참고 자료(`referenceSection`)를 포함하지 않고 웹 검증만 사용한다 — 오염된 자료로부터 독립적인 2차 의견이 목적이다. 잡은 승인(approve) 대상이 아니며 결과 조회·수정 링크만 제공한다.

**Tech Stack:** Next.js(주의: `node_modules/next/dist/docs/`의 문서를 따를 것), Prisma 7 + MariaDB, zod 4, vitest.

**선행 조건:** `01-prompt-priority-and-dissent.md` 완료 권장(필수는 아님).

## Global Constraints

- 스펙: `docs/superpowers/specs/2026-07-11-fact-defense-design.md`
- `master` 브랜치에서 직접 작업, 태스크당 1커밋, 커밋 메시지 한국어(타입 접두사 영어).
- 사용자-facing 문구에 이모지 유지(✅/❌/⚠️).
- 테스트: `npm test`. 마이그레이션: `npx prisma migrate dev --name <이름>` (원격 MariaDB에 적용됨).
- `.env`는 절대 커밋하지 않는다.

---

### Task 1: AUDIT enum·DTO·마이그레이션

**Files:**
- Modify: `prisma/schema.prisma` (`GenerationJobKind` enum)
- Modify: `src/lib/api-types.ts`

**Interfaces:**
- Consumes: 없음
- Produces:
  - Prisma enum `GenerationJobKind`: `QUESTION | KEYWORD_TAG | AUDIT`
  - `GenerationJobKindDto = "QUESTION" | "KEYWORD_TAG" | "AUDIT"`
  - `AuditItemDto { questionId: number; summary: string; verdict: "pass" | "fail" | "unverified"; comment: string | null }`
  - `GenerationJobDto.auditItems: AuditItemDto[] | null`

- [ ] **Step 1: Prisma enum 확장 및 마이그레이션**

`prisma/schema.prisma`:

```prisma
enum GenerationJobKind {
  QUESTION
  KEYWORD_TAG
  AUDIT
}
```

Run: `npx prisma migrate dev --name add_audit_job_kind`
Expected: 마이그레이션 생성·적용

- [ ] **Step 2: DTO 추가**

`src/lib/api-types.ts`:

```ts
export type GenerationJobKindDto = "QUESTION" | "KEYWORD_TAG" | "AUDIT";

export interface AuditItemDto {
  questionId: number;
  summary: string;
  verdict: "pass" | "fail" | "unverified";
  comment: string | null;
}
```

`GenerationJobDto`에 필드 추가:

```ts
export interface GenerationJobDto {
  // ... 기존 필드 유지 ...
  keywordItems: KeywordTagItemDto[] | null;
  auditItems: AuditItemDto[] | null;
  // ... 기존 필드 유지 ...
}
```

- [ ] **Step 3: 타입 확인 및 커밋**

Run: `npx tsc --noEmit`
Expected: `auditItems`를 채우지 않는 `toDto` 관련 에러가 나면 다음 태스크에서 해결하므로, 이 시점에는 `GenerationJobDto`를 만드는 `toDto`에 임시로 `auditItems: null,`을 추가해 통과시킨다 (`src/server/generation/generation-service.ts`의 `toDto`).

```bash
git add prisma/schema.prisma prisma/migrations src/lib/api-types.ts src/server/generation/generation-service.ts
git commit -m "feat: AUDIT 잡 종류와 감사 결과 DTO 추가"
```

---

### Task 2: 감사 프롬프트 빌더 + 결과 파서

**Files:**
- Create: `src/core/audit-schema.ts`
- Create: `src/core/audit-schema.test.ts`
- Modify: `src/core/prompt-template.ts` (`buildCliAuditPrompt` 추가)
- Test: `src/core/prompt-template.test.ts`

**Interfaces:**
- Consumes: `webVerificationSection(lead)` (prompt-template 내부 함수)
- Produces:
  - `buildCliAuditPrompt(topicName: string, items: Array<{ id: number; question: unknown }>, resultPath: string): string`
  - `parseAuditJson(rawText: string): { ok: true; verdicts: AuditVerdict[] } | { ok: false; fatal: string }`
  - `AuditVerdict { id: number; verdict: "pass" | "fail"; comment: string | null }`

- [ ] **Step 1: 실패하는 파서 테스트 작성**

`src/core/audit-schema.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { parseAuditJson } from "./audit-schema";

describe("parseAuditJson", () => {
  it("verdicts 배열을 파싱한다", () => {
    const result = parseAuditJson(
      JSON.stringify({
        verdicts: [
          { id: 57, verdict: "fail", comment: "Prompt Management에는 네이티브 승인 워크플로가 없음" },
          { id: 58, verdict: "pass" },
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      verdicts: [
        { id: 57, verdict: "fail", comment: "Prompt Management에는 네이티브 승인 워크플로가 없음" },
        { id: 58, verdict: "pass", comment: null },
      ],
    });
  });

  it("형식이 어긋난 verdict는 건너뛴다", () => {
    const result = parseAuditJson(
      JSON.stringify({ verdicts: [{ id: "x", verdict: "fail" }, { id: 1, verdict: "pass" }] }),
    );
    expect(result).toEqual({ ok: true, verdicts: [{ id: 1, verdict: "pass", comment: null }] });
  });

  it("verdicts 배열이 없으면 실패한다", () => {
    expect(parseAuditJson(JSON.stringify({}))).toMatchObject({ ok: false });
  });

  it("JSON이 아니면 실패한다", () => {
    expect(parseAuditJson("not json")).toMatchObject({ ok: false });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/core/audit-schema.test.ts`
Expected: FAIL (모듈 없음)

- [ ] **Step 3: 파서 구현**

`src/core/audit-schema.ts` (verify-schema.ts의 패턴을 따른다):

```ts
import { z } from "zod";

const auditVerdictSchema = z.object({
  id: z.number().int().positive(),
  verdict: z.enum(["pass", "fail"]),
  comment: z.string().optional(),
});

export interface AuditVerdict {
  id: number;
  verdict: "pass" | "fail";
  comment: string | null;
}

export type AuditParseResult =
  | { ok: true; verdicts: AuditVerdict[] }
  | { ok: false; fatal: string };

export function parseAuditJson(rawText: string): AuditParseResult {
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

  const parsed: AuditVerdict[] = [];
  for (const raw of verdicts) {
    const result = auditVerdictSchema.safeParse(raw);
    // 형식이 어긋난 verdict는 건너뛴다 — 해당 문항은 unverified로 남는다.
    if (!result.success) continue;
    const comment = result.data.comment?.trim();
    parsed.push({ id: result.data.id, verdict: result.data.verdict, comment: comment ? comment : null });
  }
  return { ok: true, verdicts: parsed };
}
```

- [ ] **Step 4: 파서 테스트 통과 확인**

Run: `npx vitest run src/core/audit-schema.test.ts`
Expected: PASS

- [ ] **Step 5: 프롬프트 테스트 작성 → 실패 확인 → 구현**

`src/core/prompt-template.test.ts`에 추가:

```ts
describe("buildCliAuditPrompt", () => {
  it("문항 id를 포함하고 참고 자료 섹션은 포함하지 않는다", () => {
    const prompt = buildCliAuditPrompt(
      "주제",
      [{ id: 57, question: { type: "mcq", question: "Q", choices: ["a", "b"], answer_index: 0 } }],
      "C:/out/result.json",
    );
    expect(prompt).toContain("문항 57");
    expect(prompt).toContain("웹 검색 기반 사실 확인");
    expect(prompt).not.toContain("## 참고 자료");
    expect(prompt).toContain('"verdicts"');
    expect(prompt).toContain("C:/out/result.json");
  });
});
```

Run: `npx vitest run src/core/prompt-template.test.ts` → FAIL 확인.

`src/core/prompt-template.ts`에 추가 (`buildCliVerifyPrompt` 아래):

```ts
export function buildCliAuditPrompt(
  topicName: string,
  items: Array<{ id: number; question: unknown }>,
  resultPath: string,
): string {
  const listing = items
    .map(
      (item) =>
        `### 문항 ${item.id}\n\n\`\`\`json\n${JSON.stringify(item.question, null, 2)}\n\`\`\``,
    )
    .join("\n\n");

  return `당신은 학습용 문제 감사 전문가입니다. 주제 "${topicName}"의 이미 저장된 아래 문항들을 사실 기준으로 재감사해 주세요.

이 문항들을 만들 때 사용한 참고 자료에 오류가 있었을 수 있습니다. 참고 자료 없이, 최신 공식 웹 문서만을 사실 판단 기준으로 사용하세요.

## 판정 기준

각 문항을 다음 기준으로 판정하세요. 하나라도 어긋나면 "fail"입니다.

1. 정답 정확성: 표기된 정답이 최신 공식 문서 기준으로 사실인가? 정답 선지가 존재하지 않는 기능이나 잘못된 서비스 역할을 전제하지 않는가?
2. 해설 정확성: explanation과 choice_explanations의 사실 서술이 공식 문서와 일치하는가?
3. 복수 정답 가능성: 오답으로 표기된 선지 중 실제로는 정답인 것이 없는가?

${webVerificationSection("판정하기 전에")}
## 감사 대상 문항

${listing}

## 출력 형식

다른 설명 없이 아래 구조의 JSON만 작성하세요. 위의 모든 문항에 대해 verdict를 하나씩 내야 합니다.

{
  "verdicts": [
    { "id": 57, "verdict": "fail", "comment": "간결한 사유와 근거 공식 문서 URL" },
    { "id": 58, "verdict": "pass", "comment": "" }
  ]
}

- id는 위 "문항 N" 제목의 N을 그대로 사용하세요.
- verdict는 "pass" 또는 "fail"만 허용됩니다.
- comment는 fail이면 사유와 근거 URL을 반드시 적고, pass면 빈 문자열이나 짧은 의견을 적으세요.

## 결과 저장 (반드시 준수)

- 결과 JSON을 stdout에 출력하지 마세요.
- 결과 JSON은 다음 경로에 UTF-8 텍스트 파일로만 저장하세요: ${resultPath}
- 파일 내용은 위 출력 형식의 JSON만 포함해야 하며, 코드 펜스나 설명 문장을 추가하지 마세요.
`;
}
```

Run: `npx vitest run src/core/prompt-template.test.ts` → PASS 확인.

- [ ] **Step 6: 커밋**

```bash
npm test
git add src/core/audit-schema.ts src/core/audit-schema.test.ts src/core/prompt-template.ts src/core/prompt-template.test.ts
git commit -m "feat: 저장 문항 감사 프롬프트와 결과 파서 추가"
```

---

### Task 3: createAuditJob / runAuditJob + 라우트 + api-client

**Files:**
- Modify: `src/server/generation/generation-service.ts`
- Create: `src/app/api/generate/audit/route.ts`
- Modify: `src/lib/api-client.ts`
- Test: `src/server/generation/generation-service.test.ts`

**Interfaces:**
- Consumes: Task 2의 `buildCliAuditPrompt`, `parseAuditJson`, 기존 `summarizeQuestionPayload(type, payload)`, `runEngine(engine, prompt, dir, prefix?)`, `jobOutputDir(jobId)`
- Produces:
  - `createAuditJob(input: { topicId: number; engine: GenerationEngineDto; cursor?: number }): Promise<GenerationJobDto>`
  - `POST /api/generate/audit` — body `{ topicId, engine, cursor? }`, 202 응답 `{ job }`
  - `api.generate.audit(input)` (api-client)
  - 잡 result: `AuditItemDto[]` (questionId 오름차순)

- [ ] **Step 1: 실패하는 서비스 테스트 작성**

`src/server/generation/generation-service.test.ts`의 prismaMock에 다음을 추가한다:

```ts
const prismaMock = vi.hoisted(() => ({
  generationJob: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  generationItemRevision: {
    findMany: vi.fn(),
  },
  topic: {
    findUnique: vi.fn(),
  },
  question: {
    findMany: vi.fn(),
  },
}));
```

그리고 파일 끝에 테스트 추가:

```ts
import { createAuditJob } from "./generation-service";

describe("createAuditJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.topic.findUnique.mockResolvedValue({ id: 2, name: "주제", referenceDir: null });
    prismaMock.generationJob.findFirst.mockResolvedValue(null);
  });

  it("감사할 문항이 없으면 400 에러를 던진다", async () => {
    prismaMock.question.findMany.mockResolvedValue([]);
    await expect(createAuditJob({ topicId: 2, engine: "CLAUDE" })).rejects.toMatchObject({
      code: "NO_AUDIT_TARGETS",
      status: 400,
    });
  });

  it("주제가 없으면 404 에러를 던진다", async () => {
    prismaMock.topic.findUnique.mockResolvedValue(null);
    await expect(createAuditJob({ topicId: 99, engine: "CLAUDE" })).rejects.toMatchObject({
      code: "TOPIC_NOT_FOUND",
      status: 404,
    });
  });

  it("진행 중인 잡이 있으면 409 에러를 던진다", async () => {
    prismaMock.generationJob.findFirst.mockResolvedValue({ id: 9, status: "RUNNING" });
    await expect(createAuditJob({ topicId: 2, engine: "CLAUDE" })).rejects.toMatchObject({
      code: "JOB_ALREADY_RUNNING",
      status: 409,
    });
  });
});
```

주의: 이 테스트 파일은 `../db`를 이미 모킹하고 있다. `cursor` 없이 호출하면 `id > 0` 조건으로 조회해야 한다.

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run src/server/generation/generation-service.test.ts`
Expected: FAIL (`createAuditJob` 미존재)

- [ ] **Step 3: 서비스 구현**

`src/server/generation/generation-service.ts`에 추가한다.

상수(파일 상단, 기존 상수들 옆):

```ts
const AUDIT_BATCH_LIMIT = 20;
```

import 추가:

```ts
import { parseAuditJson } from "@/core/audit-schema";
import { buildCliAuditPrompt } from "@/core/prompt-template"; // 기존 import 블록에 항목만 추가
import type { AuditItemDto } from "@/lib/api-types"; // 기존 type import에 항목만 추가
```

`toDto`에서 Task 1의 임시 `auditItems: null,`을 실제 매핑으로 교체:

```ts
    auditItems:
      job.kind === "AUDIT" && job.status === "SUCCEEDED"
        ? (job.result as unknown as AuditItemDto[])
        : null,
```

`createKeywordTagJob` 아래에 추가:

```ts
export async function createAuditJob(input: {
  topicId: number;
  engine: GenerationEngineDto;
  cursor?: number;
}): Promise<GenerationJobDto> {
  const topic = await prisma.topic.findUnique({ where: { id: input.topicId } });
  if (!topic) {
    throw new ServiceError("TOPIC_NOT_FOUND", "주제를 찾을 수 없습니다", 404);
  }

  const running = await prisma.generationJob.findFirst({
    where: { topicId: input.topicId, status: { in: ["RUNNING", "VERIFYING"] } },
  });
  if (running) {
    throw new ServiceError("JOB_ALREADY_RUNNING", "이미 생성 중인 작업이 있습니다", 409);
  }

  const targets = await prisma.question.findMany({
    where: { topicId: input.topicId, id: { gt: input.cursor ?? 0 } },
    orderBy: { id: "asc" },
    take: AUDIT_BATCH_LIMIT,
    select: { id: true, type: true, payload: true, explanation: true },
  });
  if (targets.length === 0) {
    throw new ServiceError("NO_AUDIT_TARGETS", "감사할 문항이 없습니다", 400);
  }

  const job = await prisma.generationJob.create({
    data: {
      topicId: input.topicId,
      engine: input.engine,
      verifyEngine: input.engine,
      instructions: "",
      kind: "AUDIT",
    },
  });

  void runAuditJob(job.id, topic.name, targets).catch((e) => {
    console.error(`audit job ${job.id} failed unexpectedly`, e);
  });

  return toDto(job);
}

async function runAuditJob(
  jobId: number,
  topicName: string,
  targets: Array<{ id: number; type: "MCQ" | "CLOZE"; payload: unknown; explanation: string | null }>,
): Promise<void> {
  const dir = jobOutputDir(jobId);
  const resultPath = path.join(dir, "result.json");
  const items = targets.map((question) => ({
    id: question.id,
    question: {
      type: question.type === "MCQ" ? "mcq" : "cloze",
      ...(question.payload as Record<string, unknown>),
      ...(question.explanation ? { explanation: question.explanation } : {}),
    },
  }));
  const prompt = buildCliAuditPrompt(topicName, items, resultPath);

  const job = await prisma.generationJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RUNNING") return;

  const run = await runEngine(job.engine, prompt, dir);
  if (!run.ok) {
    await failJob(jobId, run.failureReason, null);
    return;
  }

  const parsed = parseAuditJson(extractJsonObject(run.resultText));
  if (!parsed.ok) {
    await failJob(
      jobId,
      `${parsed.fatal}; 원문 앞 300자: ${run.resultText.slice(0, 300)}`,
      run.resultText,
    );
    return;
  }

  const verdictById = new Map(parsed.verdicts.map((verdict) => [verdict.id, verdict]));
  // 요청에 없던 문항 id는 무시하고, verdict가 누락된 문항은 unverified로 남긴다.
  const resultItems: AuditItemDto[] = targets.map((question) => {
    const verdict = verdictById.get(question.id);
    return {
      questionId: question.id,
      summary: summarizeQuestionPayload(question.type, question.payload),
      verdict: verdict ? verdict.verdict : "unverified",
      comment: verdict?.comment ?? null,
    };
  });

  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      result: resultItems as unknown as Prisma.InputJsonValue,
      rawOutput: run.resultText,
      finishedAt: new Date(),
    },
  });
}
```

`approveJob` 초입의 상태 체크 아래에 AUDIT 가드 추가 (`if (job.kind === "KEYWORD_TAG")` 분기 앞):

```ts
  if (job.kind === "AUDIT") {
    throw new ServiceError("JOB_NOT_APPROVABLE", "감사 잡은 저장 대상이 아닙니다", 409);
  }
```

- [ ] **Step 4: 서비스 테스트 통과 확인**

Run: `npx vitest run src/server/generation/generation-service.test.ts`
Expected: PASS

- [ ] **Step 5: 라우트 + api-client**

`src/app/api/generate/audit/route.ts` — `src/app/api/generate/keyword-tag/route.ts`를 열어 동일한 구조(인증·에러 처리 래퍼, zod 입력 검증)를 그대로 따르되, 입력 스키마와 서비스 호출만 다음으로 바꾼다:

```ts
const inputSchema = z.object({
  topicId: z.number().int().positive(),
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
  cursor: z.number().int().positive().optional(),
});
// ...
return jsonOk({ job: await createAuditJob(input) }, 202);
```

`src/lib/api-client.ts`의 `generate` 객체에 `keywordTag` 항목(178행 근처)과 같은 형태로 추가:

```ts
    audit: (input: { topicId: number; engine: GenerationEngineDto; cursor?: number }) =>
      request<{ job: GenerationJobDto }>("/api/generate/audit", {
        method: "POST",
        body: JSON.stringify(input),
      }),
```

(`request` 호출 형태는 파일 내 `keywordTag`와 완전히 동일하게 맞춘다.)

- [ ] **Step 6: 전체 테스트·타입 확인 후 커밋**

```bash
npm test
npx tsc --noEmit
git add src/server/generation/generation-service.ts src/server/generation/generation-service.test.ts src/app/api/generate/audit src/lib/api-client.ts
git commit -m "feat: 저장 문항 사실 감사 잡 서비스와 API 추가"
```

---

### Task 4: 감사 UI — 트리거·결과 표출

**Files:**
- Modify: `src/app/questions/page.tsx` (트리거 버튼)
- Modify: `src/app/generate/[id]/page.tsx` (결과 표출)
- Modify: `src/app/generate/page.tsx` (잡 목록 배지)

**Interfaces:**
- Consumes: `api.generate.audit({ topicId, engine, cursor? })`, `GenerationJobDto.auditItems`
- Produces: 없음 (UI)

- [ ] **Step 1: 문제 목록 페이지에 감사 버튼 추가**

`src/app/questions/page.tsx`에서 키워드 태깅 트리거(197행 근처, `api.generate.keywordTag({ topicId, engine: tagEngine })` 호출부와 그 버튼)를 찾아, 같은 UX 패턴(주제 선택 필요, 엔진 선택 공유, 성공 시 `/generate/${job.id}`로 이동)으로 "사실 감사" 버튼을 추가한다:

```tsx
const handleAudit = async () => {
  if (!topicId) return;
  setAuditPending(true);
  try {
    const { job } = await api.generate.audit({ topicId, engine: tagEngine });
    router.push(`/generate/${job.id}`);
  } catch (e) {
    // 키워드 태깅 핸들러와 동일한 에러 표시 방식을 따른다
  } finally {
    setAuditPending(false);
  }
};
```

버튼 라벨: `사실 감사`. 키워드 태깅 버튼과 나란히 배치하고 상태 변수(`auditPending`)는 파일의 기존 pending 패턴을 따른다.

- [ ] **Step 2: 잡 상세 페이지에 감사 결과 표 추가**

`src/app/generate/[id]/page.tsx`에서 `job.kind === "KEYWORD_TAG"` 결과 렌더링 블록(389-404행 근처)과 같은 위치에 AUDIT 블록을 추가한다:

```tsx
{job?.status === "SUCCEEDED" && job.kind === "AUDIT" && (
  <section className="space-y-2">
    <h2 className="text-lg font-semibold">사실 감사 결과</h2>
    {(job.auditItems ?? []).length === 0 && <p>감사 결과가 없습니다.</p>}
    <ul className="space-y-2">
      {(job.auditItems ?? []).map((item) => (
        <li key={item.questionId} className="rounded-md border p-3">
          <div className="flex items-center gap-2">
            <span>{item.verdict === "pass" ? "✅ 통과" : item.verdict === "fail" ? "❌ 사실 오류 의심" : "⚠️ 미검증"}</span>
            <Link href={`/questions/${item.questionId}`} className="underline">
              문항 #{item.questionId} 편집
            </Link>
          </div>
          <p className="mt-1 text-sm">{item.summary}</p>
          {item.comment && <p className="mt-1 text-sm text-[color:var(--muted)]">{item.comment}</p>}
        </li>
      ))}
    </ul>
    {(job.auditItems ?? []).length === 20 && (
      <button
        type="button"
        onClick={handleNextAuditBatch}
        className="rounded-md border px-3 py-1"
      >
        다음 배치 감사
      </button>
    )}
  </section>
)}
```

`handleNextAuditBatch`:

```tsx
const handleNextAuditBatch = async () => {
  if (!job || !job.auditItems?.length) return;
  const cursor = Math.max(...job.auditItems.map((item) => item.questionId));
  const { job: next } = await api.generate.audit({ topicId: job.topicId, engine: job.engine, cursor });
  router.push(`/generate/${next.id}`);
};
```

클래스명·컴포넌트(`Link`, 버튼 스타일)는 파일 내 기존 KEYWORD_TAG 블록과 동일한 것을 재사용한다. 선택/승인 로직(20-21행, 172행, 204행 근처의 `job.kind === "KEYWORD_TAG"` 분기)이 AUDIT 잡에서 저장 버튼을 노출하지 않는지 확인하고, 노출된다면 AUDIT일 때 승인 UI를 숨긴다.

- [ ] **Step 3: 잡 목록 배지**

`src/app/generate/page.tsx`의 `{job.kind === "KEYWORD_TAG" && (...)}`(101행 근처)와 같은 형태로 추가:

```tsx
{job.kind === "AUDIT" && (
  <span className="rounded bg-[color:var(--surface-2)] px-1.5 py-0.5 text-xs">사실 감사</span>
)}
```

(배지 마크업은 KEYWORD_TAG 배지와 동일한 클래스를 복사해 텍스트만 바꾼다.)

- [ ] **Step 4: 수동 확인 및 커밋**

Run: `npx tsc --noEmit && npm test`
Expected: 통과

`npm run dev` 후:
1. 문제 목록에서 주제 선택 → "사실 감사" 클릭 → 잡 상세로 이동, 완료 후 결과 표 확인.
2. question 57이 포함된 배치에서 ❌ fail로 잡히는지 확인 (엔진 판단이므로 보장은 아니지만 기대 결과).

```bash
git add src/app/questions/page.tsx "src/app/generate/[id]/page.tsx" src/app/generate/page.tsx
git commit -m "feat: 사실 감사 잡 트리거와 결과 화면 추가"
```
