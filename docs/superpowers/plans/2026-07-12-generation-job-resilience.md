# Generation Job Resilience Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve original AI validation errors, remove incorrect keyword and blueprint constraints, report job status honestly, and retain every generation-job AI call in MariaDB for diagnosis from the job detail page.

**Architecture:** Pure TypeScript modules own keyword, blueprint, and generated-item validation. A `GenerationRunLog` child table stores each job-backed engine call; a tracked runner wraps `runEngine` and records prompt, response, process diagnostics, parse outcome, and timing. A separate authenticated diagnostics endpoint lazy-loads large payloads so normal job polling stays small.

**Tech Stack:** Next.js 16.2 App Router, React 19, strict TypeScript, Prisma 7, MariaDB 11, zod 4, vitest 4

## Global Constraints

- Work directly on `master`; do not create a branch or worktree.
- Execute tasks in numeric order and make one Korean conventional commit per task.
- Follow the installed Next.js Route Handler docs; dynamic `params` are promises.
- Keep `src/core/` free of Next.js, Prisma, and Node-only imports; zod is allowed.
- UI requests must go through `src/lib/api-client.ts`.
- Remove keyword count limits everywhere, but keep nonblank, 50-character, normalization, and deduplication rules.
- Store full prompts and AI responses as `MEDIUMTEXT`; retain only the last 8,000 characters of stdout/stderr.
- Track only calls belonging to a `GenerationJob`. Synchronous keyword suggestions and CLI backfill only receive the count-limit change.
- Cascade-delete run logs with their job and otherwise retain them indefinitely.
- Never store `.env`, environment variables, or CLI authentication tokens.
- Preserve the existing light emoji style in user-facing feedback.

---

### Task 1: Correct keyword and blueprint domain contracts

**Files:**
- Modify: `src/core/import-schema.ts`
- Modify: `src/core/import-schema.test.ts`
- Modify: `src/core/keyword-tag-schema.ts`
- Modify: `src/core/keyword-tag-schema.test.ts`
- Modify: `src/core/question-blueprint.ts`
- Modify: `src/core/question-blueprint.test.ts`
- Modify: `src/core/question-difficulty.ts`
- Modify: `src/core/question-difficulty.test.ts`
- Modify: `src/core/prompt-template.ts`
- Modify: `src/core/prompt-template.test.ts`

**Interfaces:**
- Consumes: `KEYWORD_MAX_LENGTH`, `dedupeKeywordNames`
- Produces: unlimited keyword arrays and `BlueprintChoice.misconception: string | null`

- [ ] **Step 1: Replace the import-schema six-keyword rejection test**

```ts
it("accepts more than five keywords", () => {
  const keywords = ["1", "2", "3", "4", "5", "6", "7"];
  const result = importMcqSchema.safeParse({ ...baseMcq, keywords });
  expect(result.success).toBe(true);
  if (result.success) expect(result.data.keywords).toEqual(keywords);
});
```

- [ ] **Step 2: Replace tag/suggestion count tests and add boundary coverage**

```ts
it("does not limit tag or suggestion keyword counts", () => {
  const keywords = ["1", "2", "3", "4", "5", "6", "7"];
  expect(parseKeywordSuggestionJson(JSON.stringify({ keywords }))).toEqual({ ok: true, keywords });
  expect(parseKeywordTagJson(JSON.stringify({ assignments: [{ id: 9, keywords }] }))).toEqual({
    ok: true,
    assignments: [{ id: 9, keywords }],
  });
});
```

Keep tests proving blank and 51-character values fail, and normalized duplicates collapse.

- [ ] **Step 3: Add correct/distractor misconception tests**

Add `it.each([undefined, null, ""])` cases to `question-blueprint.test.ts`: a correct choice normalizes each value to `null`; a distractor rejects each value. Add this difficulty-gate test:

```ts
it("allows an empty correct-choice misconception and checks distractors only", () => {
  const accepted = structuredClone(blueprint);
  accepted.choices[0].misconception = null;
  expect(assessQuestionBlueprint(accepted).violations).not.toContainEqual(
    expect.objectContaining({ code: "EMPTY_MISCONCEPTION", choiceId: "a" }),
  );
  const rejected = structuredClone(blueprint);
  rejected.choices[1].misconception = "";
  expect(assessQuestionBlueprint(rejected).violations).toContainEqual(
    expect.objectContaining({ code: "EMPTY_MISCONCEPTION", choiceId: "b" }),
  );
});
```

- [ ] **Step 4: Run tests and confirm they fail**

Run: `npx vitest run src/core/import-schema.test.ts src/core/keyword-tag-schema.test.ts src/core/question-blueprint.test.ts src/core/question-difficulty.test.ts`

Expected: new unlimited-keyword and correct-choice misconception cases fail.

- [ ] **Step 5: Implement keyword schemas**

Remove `.max(5)` from `keywordListSchema`. In `keyword-tag-schema.ts`, use this for both assignment and suggestion schemas:

```ts
const keywordArraySchema = z.array(
  z.string().trim().min(1).max(KEYWORD_MAX_LENGTH),
).min(1);
```

Change suggestion failure copy to `keywords는 비어 있지 않은 유효한 문자열 배열이어야 합니다`.

- [ ] **Step 6: Implement the blueprint union and gate**

```ts
const choiceBaseSchema = z.object({
  id: nonBlank,
  solution: nonBlank,
  serviceNames: stringList,
  satisfiedConstraintIds: stringList,
  violatedConstraintIds: stringList,
});
const choiceSchema = z.discriminatedUnion("correct", [
  choiceBaseSchema.extend({
    correct: z.literal(true),
    misconception: z.string().optional().nullable().transform((value) => value?.trim() || null),
  }),
  choiceBaseSchema.extend({ correct: z.literal(false), misconception: nonBlank }),
]);
```

In `assessQuestionBlueprint`, report `EMPTY_MISCONCEPTION` only when `!choice.correct && !choice.misconception.trim()`.

- [ ] **Step 7: Align prompts and prompt tests**

Remove all `1~3` and maximum-five keyword instructions. Say keywords must be short, directly relevant, and deduplicated. Use `"misconception": null` for correct blueprint choices and explicitly require nonblank misconception only for distractors. Test the new text and absence of count-limit text.

- [ ] **Step 8: Verify and commit**

```powershell
npx vitest run src/core/import-schema.test.ts src/core/keyword-tag-schema.test.ts src/core/question-blueprint.test.ts src/core/question-difficulty.test.ts src/core/prompt-template.test.ts
npx tsc --noEmit
git add src/core
git commit -m "fix: 생성 키워드와 설계표 검증 계약 수정"
```

---

### Task 2: Preserve original item errors and honest failure status

**Files:**
- Create: `src/core/generation-result.ts`
- Create: `src/core/generation-result.test.ts`
- Modify: `src/server/generation/generation-service.ts`

**Interfaces:**
- Produces: `prepareGeneratedItems(items): { items; validCount; failureMessage }`

- [ ] **Step 1: Write failing preservation tests**

```ts
it("does not replace an original error with an invalid type error", () => {
  const input: ImportItemResult[] = [{ index: 0, ok: false, errors: ["keywords: keyword error"] }];
  expect(prepareGeneratedItems(input)).toEqual({
    items: input,
    validCount: 0,
    failureMessage: "생성된 1개 문항이 모두 유효성 검사를 통과하지 못했습니다. 첫 오류: #1 keywords: keyword error",
  });
});
```

Also test mixed valid/invalid input and generation-only validation failures retaining the original index.

- [ ] **Step 2: Confirm failure**

Run: `npx vitest run src/core/generation-result.test.ts`

Expected: missing module failure.

- [ ] **Step 3: Implement the pure result preparation function**

```ts
export function prepareGeneratedItems(sourceItems: ImportItemResult[]) {
  const items = sourceItems.map((item): ImportItemResult => {
    if (!item.ok) return item;
    const validated = validateGeneratedQuestions([item.question])[0];
    return { ...validated, index: item.index };
  });
  const validCount = items.filter((item) => item.ok).length;
  const firstInvalid = items.find((item) => !item.ok);
  const failureMessage = validCount === 0 && firstInvalid && !firstInvalid.ok
    ? `생성된 ${items.length}개 문항이 모두 유효성 검사를 통과하지 못했습니다. 첫 오류: #${firstInvalid.index + 1} ${firstInvalid.errors[0] ?? "알 수 없는 검증 오류"}`
    : null;
  return { items, validCount, failureMessage };
}
```

- [ ] **Step 4: Replace the `{ type: "invalid" }` remapping**

Use `prepareGeneratedItems(parsed.items)`. When `validCount === 0`, update the job with `status: "FAILED"`, the complete merged result, `failureMessage`, raw output, and `finishedAt`, then return. Mixed results continue with valid items while preserving invalid entries.

- [ ] **Step 5: Verify and commit**

```powershell
npx vitest run src/core/generation-result.test.ts src/server/generation/generation-service.test.ts
npx tsc --noEmit
rg -n "type: \"invalid\"" src/server/generation/generation-service.ts
git add src/core/generation-result.ts src/core/generation-result.test.ts src/server/generation/generation-service.ts
git commit -m "fix: 생성 문항의 최초 검증 오류와 실패 상태 보존"
```

Expected: tests pass and the final `rg` has no matches.

---

### Task 3: Add the run-log database model and DTO

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260712000000_add_generation_run_log/migration.sql`
- Modify: `src/lib/api-types.ts`

**Interfaces:**
- Produces: Prisma `GenerationRunLog`, `GenerationRunStage`, `GenerationRunStatus`, and `GenerationRunLogDto`

- [ ] **Step 1: Add Prisma enums, relation, and model**

Stages: `BLUEPRINT`, `BLUEPRINT_REPAIR`, `GENERATION`, `VERIFY`, `ITEM_REPAIR`, `REPAIR_VERIFY`, `MANUAL_ITEM_REVISION`, `KEYWORD_TAG`. Statuses: `RUNNING`, `SUCCEEDED`, `FAILED`.

The model fields are: id, required job FK, stage, nullable itemIndex, attempt default 1, engine, nullable model varchar(100), status, prompt MediumText, nullable response MediumText, stdoutTail/stderrTail/errorMessage Text, nullable exitCode, timedOut default false, startedAt, nullable finishedAt, nullable durationMs. Add `@@index([generationJobId, startedAt])`, cascade relation, and `runLogs GenerationRunLog[]` to `GenerationJob`.

- [ ] **Step 2: Write the explicit migration SQL**

Create the matching MariaDB table, inline ENUM columns, composite index, and cascade foreign key. Use `MEDIUMTEXT` for prompt/response and `TEXT` for diagnostic tails/errors.

- [ ] **Step 3: Add API types**

Add exact string unions for stages/status and a `GenerationRunLogDto` containing every model field except `generationJobId`, with dates serialized as strings.

- [ ] **Step 4: Verify and commit**

```powershell
npx prisma format
npx prisma validate
npx prisma generate
npx tsc --noEmit
git add prisma/schema.prisma prisma/migrations/20260712000000_add_generation_run_log/migration.sql src/lib/api-types.ts
git commit -m "feat: 생성 엔진 실행 기록 모델 추가"
```

---

### Task 4: Return engine diagnostics and persist tracked calls

**Files:**
- Modify: `src/server/generation/run-engine.ts`
- Create: `src/server/generation/tracked-run.ts`
- Create: `src/server/generation/tracked-run.test.ts`

**Interfaces:**
- Produces: diagnostic `EngineRunResult`, `runTrackedEngine`, `completeTrackedRun`, `failTrackedRun`

- [ ] **Step 1: Write tracked-run tests**

Mock Prisma and `runEngine`. Cover: RUNNING record created before execution; successful response and diagnostics saved; timeout saved as FAILED; DB create failure does not replace an engine success; complete/fail helpers close a record.

```ts
expect(prismaMock.generationRunLog.create).toHaveBeenCalledWith({
  data: expect.objectContaining({ generationJobId: 3, status: "RUNNING", prompt: "prompt" }),
  select: { id: true },
});
expect(prismaMock.generationRunLog.update).toHaveBeenCalledWith({
  where: { id: 7 },
  data: expect.objectContaining({ response: "{\"ok\":true}", stdoutTail: "out" }),
});
```

- [ ] **Step 2: Confirm failure**

Run: `npx vitest run src/server/generation/tracked-run.test.ts`

Expected: missing module failure.

- [ ] **Step 3: Extend run-engine results**

Set `LOG_TAIL_CHARS = 8_000`. Add `stdoutTail`, `stderrTail`, `exitCode`, `timedOut`, and `durationMs` to both success and failure variants. Record `startedAt = Date.now()` immediately before spawn and spread one diagnostics object into every return. Keep current output files and failure messages.

- [ ] **Step 4: Implement tracked-run**

`runTrackedEngine` creates a RUNNING row, invokes `runEngine`, saves response and process diagnostics, immediately closes engine failures, and returns `runLogId: number | null`. Successful engine execution remains RUNNING until parsing/validation calls one of:

```ts
export async function completeTrackedRun(runLogId: number | null): Promise<void>;
export async function failTrackedRun(runLogId: number | null, errorMessage: string): Promise<void>;
```

All diagnostic create/update operations catch errors, log `generation run log persistence failed`, and preserve the original generation result. Null ids are no-ops.

- [ ] **Step 5: Verify and commit**

```powershell
npx vitest run src/server/generation/tracked-run.test.ts
npx tsc --noEmit
git add src/server/generation/run-engine.ts src/server/generation/tracked-run.ts src/server/generation/tracked-run.test.ts
git commit -m "feat: 생성 엔진 호출 진단 정보 추적"
```

---

### Task 5: Track every generation-job engine call

**Files:**
- Modify: `src/server/generation/generation-service.ts`
- Modify: `src/server/generation/generation-service.test.ts`

**Interfaces:**
- Consumes: Task 4 tracked runner
- Produces: stage-complete run history and orphan cleanup

- [ ] **Step 1: Add an orphan-run failing test**

Add `generationRunLog.updateMany` to the Prisma mock. For a stale RUNNING job, assert `getJob()` closes all RUNNING child records as FAILED with an error and `finishedAt`.

- [ ] **Step 2: Confirm failure**

Run: `npx vitest run src/server/generation/generation-service.test.ts`

Expected: missing `updateMany` call.

- [ ] **Step 3: Replace direct runEngine calls**

Use stages: keyword tag=`KEYWORD_TAG`; blueprint=`BLUEPRINT`; blueprint repair=`BLUEPRINT_REPAIR`; final generation=`GENERATION`; verify=`VERIFY`; automatic repair=`ITEM_REPAIR` with item index; repair verify=`REPAIR_VERIFY`; user revision=`MANUAL_ITEM_REVISION` with item index. Preserve file prefixes and explicit Codex model in tracked-run inputs.

- [ ] **Step 4: Close records from domain outcomes**

Engine failure is already closed. JSON/schema failure calls `failTrackedRun`. Successful parse and domain validation call `completeTrackedRun`. Structural blueprint failure and partially invalid generated items mark their call FAILED with the real violation summary; mixed generated items may continue the job. Verify-engine failure retains the existing `verifyWarning` behavior.

- [ ] **Step 5: Close orphan records**

Before stale RUNNING/VERIFYING job updates, call `generationRunLog.updateMany` for RUNNING child rows with FAILED, `시간 초과 또는 서버 재시작으로 실행 기록이 중단되었습니다`, and `finishedAt`.

- [ ] **Step 6: Verify and commit**

```powershell
npx vitest run src/server/generation/generation-service.test.ts src/server/generation/tracked-run.test.ts
npx tsc --noEmit
rg -n "runEngine\(" src/server/generation/generation-service.ts
git add src/server/generation/generation-service.ts src/server/generation/generation-service.test.ts
git commit -m "feat: 생성 작업의 AI 호출 단계별 기록 추가"
```

Expected: tests pass and `rg` returns no matches.

---

### Task 6: Add diagnostics service, route, and API client

**Files:**
- Create: `src/server/generation/generation-diagnostics-service.ts`
- Create: `src/server/generation/generation-diagnostics-service.test.ts`
- Create: `src/app/api/generate/[id]/diagnostics/route.ts`
- Create: `src/app/api/generate/[id]/diagnostics/route.test.ts`
- Modify: `src/lib/api-client.ts`

**Interfaces:**
- Produces: `getJobDiagnostics(jobId)`, `GET /api/generate/{id}/diagnostics`, `api.generate.diagnostics(id)`

- [ ] **Step 1: Write service tests**

Mock Prisma. Missing job throws `JOB_NOT_FOUND` 404. Existing job queries `orderBy: [{ startedAt: "asc" }, { id: "asc" }]` and serializes both dates to ISO strings.

- [ ] **Step 2: Confirm failure and implement service**

Run: `npx vitest run src/server/generation/generation-diagnostics-service.test.ts`

Expected: missing module. Then implement explicit field-by-field DTO mapping.

- [ ] **Step 3: Implement Route Handler and route tests**

```ts
type Ctx = { params: Promise<{ id: string }> };
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    return jsonOk({ runs: await getJobDiagnostics(parseIdParam(id)) });
  } catch (error) {
    return handleApiError(error);
  }
}
```

Test 200 `{ runs }` and invalid-id 400. Rely on `src/proxy.ts` for shared authentication.

- [ ] **Step 4: Add API client method**

```ts
diagnostics: (id: number) =>
  request<{ runs: GenerationRunLogDto[] }>(`/api/generate/${id}/diagnostics`),
```

- [ ] **Step 5: Verify and commit**

```powershell
npx vitest run src/server/generation/generation-diagnostics-service.test.ts "src/app/api/generate/[id]/diagnostics/route.test.ts"
npx tsc --noEmit
git add src/server/generation/generation-diagnostics-service.ts src/server/generation/generation-diagnostics-service.test.ts "src/app/api/generate/[id]/diagnostics/route.ts" "src/app/api/generate/[id]/diagnostics/route.test.ts" src/lib/api-client.ts
git commit -m "feat: 생성 작업 진단 기록 조회 API 추가"
```

---

### Task 7: Add lazy diagnostics UI and partial-failure warning

**Files:**
- Create: `src/components/GenerationDiagnostics.tsx`
- Modify: `src/app/generate/[id]/page.tsx`

**Interfaces:**
- Consumes: `api.generate.diagnostics(jobId)` and `GenerationRunLogDto[]`
- Produces: collapsed, lazy-loaded run diagnostics

- [ ] **Step 1: Implement the client component**

Fetch only on the first open of the outer `<details>`. Define a complete `Record<GenerationRunStageDto, string>` for all eight stages. Show status, engine/model, time, duration, item index, attempt, and error first. Show prompt, response, stdout, and stderr in separate nested details with wrapped preformatted text; omit null values.

Use clipboard feedback:

```ts
try {
  await navigator.clipboard.writeText(value);
  setMessage(`✅ ${label}을 복사했습니다.`);
} catch {
  setMessage(`❌ ${label}을 복사하지 못했습니다.`);
}
```

Show explicit loading, empty, and API-error states.

- [ ] **Step 2: Integrate into the job detail page**

Render `<GenerationDiagnostics jobId={job.id} />` after the job summary for every status. For successful QUESTION jobs with any invalid item, show `⚠️ 일부 문항 생성에 실패했습니다. 오류가 있는 문항은 저장 대상에서 제외됩니다.` using warning tokens.

- [ ] **Step 3: Verify and commit**

```powershell
npx tsc --noEmit
npm run lint
npm run build
git add src/components/GenerationDiagnostics.tsx "src/app/generate/[id]/page.tsx"
git commit -m "feat: 생성 작업 상세에 AI 진단 기록 표시"
```

---

### Task 8: Full regression and deployment verification

**Files:**
- Modify only files from Tasks 1-7 if verification reveals a defect

**Interfaces:**
- Produces: deployable, verified master state

- [ ] **Step 1: Run the full automated suite**

```powershell
npm test
npx tsc --noEmit
npm run lint
npm run build
git diff --check
git status --short
```

Expected: all checks pass and the worktree is clean.

- [ ] **Step 2: Apply and verify migration locally**

```powershell
npx prisma migrate status
npx prisma migrate dev
```

Expected: `20260712000000_add_generation_run_log` applied, no pending migration, `.env` absent from git status.

- [ ] **Step 3: Manually verify behavior**

Confirm: six-plus-keyword import succeeds; blank correct-choice misconception parses; all-invalid fixture makes the job FAILED with original path; mixed fixture remains SUCCEEDED with warning and original error; diagnostics show and copy each stage's prompt/response/stderr; deleting the job removes child run logs.

- [ ] **Step 4: Perform server smoke test after normal deployment**

After pushing `master` and GitHub Actions deployment, use the PowerShell profile `opc` connection. Confirm `prisma migrate deploy`, run one new generation job, and compare UI stage order with `generation_run_log`. Do not print prompts, responses, or `.env` values into shared terminal output.
