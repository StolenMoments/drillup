# 선지 강화 자동 반영 + 선지 검토 메뉴 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 선지 강화 job이 검증 의견(factualConcern) 없이 성공하면 서버가 자동 반영하고, 확인이 필요한 항목은 새 "선지 검토" 메뉴에서 승인/거절/사실 확인/재생성 처리한다.

**Architecture:** 기존 `ChoiceHardeningJob` 테이블에 `autoApplied`, `dismissedAt` 컬럼만 추가한다. runner가 SUCCEEDED 저장 직후 concern이 없으면 기존 `applyChoiceHardeningJob`(row lock + 해시 재검사)을 호출해 자동 반영한다. 승인 대기는 "SUCCEEDED + 미적용 + 미거절"이라는 컬럼 조합으로 파생하며 JSON `preview` 컬럼은 쿼리 조건에 쓰지 않는다.

**Tech Stack:** Next.js 16.2.10 `after()`, React 19, Prisma 7.8, MariaDB, Vitest 4, Testing Library/jsdom

**Spec:** `docs/superpowers/specs/2026-07-15-choice-hardening-auto-apply-review-design.md`

## Global Constraints

- 작업 시작 전 `git pull`. master에서 직접 작업하고 feature branch를 만들지 않는다.
- 커밋 메시지는 English conventional type + 한국어 설명 (`feat:`, `fix:`, `refactor:`, `test:`, `docs:`).
- 사용자 노출 문구의 이모지(✅/❌/🎉/⚠️/🎯 등)를 제거하지 않는다.
- `.env`와 `generation_reference/` untracked 문서를 커밋하지 않는다.
- JSON `preview` 컬럼은 쿼리 WHERE 조건에 사용하지 않는다.
- 반영 이력은 최근 20건으로 제한한다.
- 자동 반영 문구: "✅ 자동 반영됨 — 다음 학습부터 새 선지가 나옵니다 🎉" (스펙 원문 유지).

---

### Task 1: job 스키마·DTO 확장 (autoApplied, dismissedAt)

**Files:**
- Create: `prisma/migrations/20260715090000_add_choice_hardening_review/migration.sql`
- Modify: `prisma/schema.prisma:107-128` (ChoiceHardeningJob 모델)
- Modify: `src/lib/api-types.ts:168-183` (`ChoiceHardeningJobDto`)
- Modify: `src/server/choice-hardening-service.ts:14-31` (`toDto`)
- Test: `src/server/choice-hardening-service.test.ts`

**Interfaces:**
- Produces: `ChoiceHardeningJobDto`에 `autoApplied: boolean`, `dismissedAt: string | null` 필드 추가. 이후 모든 태스크가 이 DTO 형태에 의존한다.

- [ ] **Step 1: 실패 테스트를 작성한다**

`src/server/choice-hardening-service.test.ts`의 `job()` 헬퍼에 새 컬럼 기본값을 추가한다 (`appliedAt: null` 다음 줄):

```ts
    appliedAt: null,
    autoApplied: false,
    dismissedAt: null,
```

같은 파일 마지막 `it` 뒤에 DTO 테스트를 추가한다:

```ts
  it("job 조회 DTO는 autoApplied와 dismissedAt을 포함한다", async () => {
    prismaMock.choiceHardeningJob.findUnique.mockResolvedValue(
      job({
        status: "SUCCEEDED",
        preview,
        autoApplied: true,
        appliedAt: new Date("2026-07-15T00:03:00.000Z"),
        dismissedAt: new Date("2026-07-15T00:04:00.000Z"),
        finishedAt: new Date("2026-07-15T00:02:00.000Z"),
      }),
    );

    await expect(getChoiceHardeningJob(7, 11)).resolves.toMatchObject({
      autoApplied: true,
      appliedAt: "2026-07-15T00:03:00.000Z",
      dismissedAt: "2026-07-15T00:04:00.000Z",
    });
  });
```

- [ ] **Step 2: 테스트 실패를 확인한다**

```powershell
npm test -- --run src/server/choice-hardening-service.test.ts
```

Expected: FAIL — DTO에 `autoApplied`, `dismissedAt`이 없어 `toMatchObject` 불일치.

- [ ] **Step 3: migration과 Prisma schema를 수정한다**

`prisma/migrations/20260715090000_add_choice_hardening_review/migration.sql` (신규):

```sql
ALTER TABLE `choice_hardening_job`
    ADD COLUMN `auto_applied` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `dismissed_at` DATETIME(3) NULL;
```

`prisma/schema.prisma`의 `ChoiceHardeningJob` 모델에서 `appliedAt` 줄 다음에 추가:

```prisma
  autoApplied   Boolean                  @default(false) @map("auto_applied")
  dismissedAt   DateTime?                @map("dismissed_at")
```

- [ ] **Step 4: DTO 타입과 toDto를 수정한다**

`src/lib/api-types.ts`의 `ChoiceHardeningJobDto`에서 `appliedAt: string | null;` 다음에 추가:

```ts
  autoApplied: boolean;
  dismissedAt: string | null;
```

`src/server/choice-hardening-service.ts`의 `toDto`에서 `appliedAt` 줄 다음에 추가:

```ts
    autoApplied: job.autoApplied,
    dismissedAt: job.dismissedAt?.toISOString() ?? null,
```

- [ ] **Step 5: prisma 클라이언트를 재생성하고 로컬 DB에 적용한다**

```powershell
npx prisma validate
npx prisma generate
npx prisma migrate deploy
```

Expected: validate/generate 성공, migrate deploy가 `20260715090000_add_choice_hardening_review` 1건 적용.

- [ ] **Step 6: 테스트 통과를 확인한다**

```powershell
npm test -- --run src/server/choice-hardening-service.test.ts
npx tsc --noEmit
```

Expected: PASS (기존 테스트 포함 전체).

- [ ] **Step 7: 커밋**

```powershell
git add prisma src/lib/api-types.ts src/server/choice-hardening-service.ts src/server/choice-hardening-service.test.ts
git commit -m "feat: 선지 강화 job에 자동 반영·거절 상태 컬럼 추가"
```

### Task 2: apply의 auto 옵션·거절 가드 + dismiss 서비스/라우트/클라이언트

**Files:**
- Modify: `src/server/choice-hardening-service.ts` (`applyChoiceHardeningJob`, `dismissChoiceHardeningJob` 신규)
- Create: `src/app/api/questions/[id]/harden-choices/[jobId]/dismiss/route.ts`
- Create: `src/app/api/questions/[id]/harden-choices/[jobId]/dismiss/route.test.ts`
- Modify: `src/lib/api-client.ts` (`questions.dismissHardenChoices`)
- Test: `src/server/choice-hardening-service.test.ts`

**Interfaces:**
- Consumes: Task 1의 `autoApplied`/`dismissedAt` 컬럼.
- Produces: `applyChoiceHardeningJob(questionId: number, jobId: number, options?: { auto?: boolean }): Promise<void>` — `options.auto === true`면 `autoApplied: true` 기록. 거절된 job이면 `CHOICE_HARDENING_DISMISSED` 409.
- Produces: `dismissChoiceHardeningJob(questionId: number, jobId: number): Promise<void>` — SUCCEEDED/FAILED job에 `dismissedAt` 기록. 이미 적용이면 `CHOICE_HARDENING_ALREADY_APPLIED` 409, RUNNING이면 `CHOICE_HARDENING_NOT_READY` 409, 중복 거절은 no-op.
- Produces: `api.questions.dismissHardenChoices(id: number, jobId: number): Promise<{ ok: true }>` — `POST /api/questions/[id]/harden-choices/[jobId]/dismiss`.

- [ ] **Step 1: 서비스 실패 테스트를 작성한다**

`src/server/choice-hardening-service.test.ts` import에 `dismissChoiceHardeningJob`을 추가한다:

```ts
import {
  applyChoiceHardeningJob,
  dismissChoiceHardeningJob,
  getChoiceHardeningJob,
  startChoiceHardeningJob,
} from "./choice-hardening-service";
```

기존 테스트 "preview 적용은 문제 수정, 해설 캐시 삭제, appliedAt 기록을 한 트랜잭션으로 처리한다"에서 job 갱신 단언을 새 필드에 맞게 수정한다:

```ts
    expect(tx.choiceHardeningJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 11 },
        data: { appliedAt: expect.any(Date), autoApplied: false },
      }),
    );
```

파일 끝에 새 테스트들을 추가한다:

```ts
  it("auto 옵션 적용은 autoApplied를 기록한다", async () => {
    const sourceHash = await sha256Fingerprint(original);
    const tx = transactionClient(
      { id: 7, type: "MCQ", payload: original },
      job({ status: "SUCCEEDED", sourceHash, preview }),
    );
    prismaMock.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<void>) => callback(tx),
    );

    await applyChoiceHardeningJob(7, 11, { auto: true });

    expect(tx.choiceHardeningJob.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { appliedAt: expect.any(Date), autoApplied: true },
      }),
    );
  });

  it("거절된 job 적용은 409로 거부한다", async () => {
    const sourceHash = await sha256Fingerprint(original);
    const tx = transactionClient(
      { id: 7, type: "MCQ", payload: original },
      job({ status: "SUCCEEDED", sourceHash, preview, dismissedAt: new Date() }),
    );
    prismaMock.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<void>) => callback(tx),
    );

    await expect(applyChoiceHardeningJob(7, 11)).rejects.toMatchObject({
      code: "CHOICE_HARDENING_DISMISSED",
      status: 409,
    });
    expect(tx.question.update).not.toHaveBeenCalled();
  });

  it("완료된 job 거절은 dismissedAt을 기록한다", async () => {
    prismaMock.choiceHardeningJob.findUnique.mockResolvedValue(
      job({ status: "SUCCEEDED", preview, finishedAt: new Date() }),
    );
    prismaMock.choiceHardeningJob.updateMany.mockResolvedValue({ count: 1 });

    await expect(dismissChoiceHardeningJob(7, 11)).resolves.toBeUndefined();

    expect(prismaMock.choiceHardeningJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: 11, appliedAt: null, dismissedAt: null },
      data: { dismissedAt: expect.any(Date) },
    });
  });

  it("이미 반영된 job 거절은 409로 거부한다", async () => {
    prismaMock.choiceHardeningJob.findUnique.mockResolvedValue(
      job({ status: "SUCCEEDED", preview, appliedAt: new Date() }),
    );

    await expect(dismissChoiceHardeningJob(7, 11)).rejects.toMatchObject({
      code: "CHOICE_HARDENING_ALREADY_APPLIED",
      status: 409,
    });
  });

  it("진행 중 job 거절은 409로 거부한다", async () => {
    prismaMock.choiceHardeningJob.findUnique.mockResolvedValue(
      job({ status: "RUNNING", startedAt: new Date() }),
    );

    await expect(dismissChoiceHardeningJob(7, 11)).rejects.toMatchObject({
      code: "CHOICE_HARDENING_NOT_READY",
      status: 409,
    });
  });

  it("이미 거절된 job 거절은 no-op 성공이다", async () => {
    prismaMock.choiceHardeningJob.findUnique.mockResolvedValue(
      job({ status: "FAILED", errorMessage: "실패", dismissedAt: new Date() }),
    );

    await expect(dismissChoiceHardeningJob(7, 11)).resolves.toBeUndefined();

    expect(prismaMock.choiceHardeningJob.updateMany).not.toHaveBeenCalled();
  });
```

주의: `dismissChoiceHardeningJob`은 `recoverStaleChoiceHardeningJobs`를 호출하지 않는다 — `findJobOrThrow`(findUnique)로 조회한 상태만으로 판단하므로, 중복 거절 no-op 케이스에서는 `updateMany` 호출이 전혀 없어야 한다.

- [ ] **Step 2: 테스트 실패를 확인한다**

```powershell
npm test -- --run src/server/choice-hardening-service.test.ts
```

Expected: FAIL — `dismissChoiceHardeningJob` export 부재, `autoApplied` 데이터 불일치.

- [ ] **Step 3: 서비스를 구현한다**

`src/server/choice-hardening-service.ts`의 `applyChoiceHardeningJob` 시그니처와 가드를 수정한다:

```ts
export async function applyChoiceHardeningJob(
  questionId: number,
  jobId: number,
  options: { auto?: boolean } = {},
): Promise<void> {
```

트랜잭션 내부에서 `if (job.appliedAt) return;` 다음 줄에 추가:

```ts
    if (job.dismissedAt) {
      throw new ServiceError(
        "CHOICE_HARDENING_DISMISSED",
        "거절된 작업은 적용할 수 없습니다",
        409,
      );
    }
```

job 갱신을 새 필드 포함으로 수정:

```ts
    await tx.choiceHardeningJob.update({
      where: { id: jobId },
      data: { appliedAt: new Date(), autoApplied: options.auto === true },
    });
```

`applyChoiceHardeningJob` 함수 뒤에 dismiss를 추가한다:

```ts
export async function dismissChoiceHardeningJob(
  questionId: number,
  jobId: number,
): Promise<void> {
  const job = await findJobOrThrow(questionId, jobId);
  if (job.appliedAt) {
    throw new ServiceError(
      "CHOICE_HARDENING_ALREADY_APPLIED",
      "이미 반영된 작업은 거절할 수 없습니다",
      409,
    );
  }
  if (job.status === "RUNNING") {
    throw new ServiceError(
      "CHOICE_HARDENING_NOT_READY",
      "진행 중인 작업은 거절할 수 없습니다",
      409,
    );
  }
  if (job.dismissedAt) return;
  await prisma.choiceHardeningJob.updateMany({
    where: { id: jobId, appliedAt: null, dismissedAt: null },
    data: { dismissedAt: new Date() },
  });
}
```

- [ ] **Step 4: dismiss 라우트와 라우트 테스트를 작성한다**

`src/app/api/questions/[id]/harden-choices/[jobId]/dismiss/route.ts` (신규):

```ts
import { dismissChoiceHardeningJob } from "@/server/choice-hardening-service";
import { handleApiError, jsonOk, parseIdParam } from "@/server/http";

type Ctx = { params: Promise<{ id: string; jobId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { id, jobId } = await ctx.params;
    await dismissChoiceHardeningJob(parseIdParam(id), parseIdParam(jobId));
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
```

`src/app/api/questions/[id]/harden-choices/[jobId]/dismiss/route.test.ts` (신규):

```ts
import { describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/server/errors";

const dismissMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/choice-hardening-service", () => ({
  dismissChoiceHardeningJob: dismissMock,
}));

import { POST } from "./route";

describe("POST /api/questions/:id/harden-choices/:jobId/dismiss", () => {
  it("거절 성공은 ok를 반환한다", async () => {
    dismissMock.mockResolvedValue(undefined);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "7", jobId: "11" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(dismissMock).toHaveBeenCalledWith(7, 11);
  });

  it("이미 반영된 job 거절은 409로 반환한다", async () => {
    dismissMock.mockRejectedValue(
      new ServiceError("CHOICE_HARDENING_ALREADY_APPLIED", "이미 반영됨", 409),
    );

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "7", jobId: "11" }),
    });

    expect(response.status).toBe(409);
  });
});
```

- [ ] **Step 5: api-client에 dismiss를 추가한다**

`src/lib/api-client.ts`의 `questions.applyHardenChoices` 다음에 추가:

```ts
    dismissHardenChoices: (id: number, jobId: number) =>
      request<{ ok: true }>(
        `/api/questions/${id}/harden-choices/${jobId}/dismiss`,
        { method: "POST" },
      ),
```

- [ ] **Step 6: 테스트 통과를 확인한다**

```powershell
npm test -- --run src/server/choice-hardening-service.test.ts "src/app/api/questions/[id]/harden-choices/[jobId]/dismiss/route.test.ts"
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 7: 커밋**

```powershell
git add src/server/choice-hardening-service.ts src/server/choice-hardening-service.test.ts "src/app/api/questions/[id]/harden-choices/[jobId]/dismiss" src/lib/api-client.ts
git commit -m "feat: 선지 강화 거절 처리와 자동 반영 기록 추가"
```

### Task 3: runner 자동 반영

**Files:**
- Modify: `src/server/choice-hardening-runner.ts`
- Test: `src/server/choice-hardening-runner.test.ts`

**Interfaces:**
- Consumes: Task 2의 `applyChoiceHardeningJob(questionId, jobId, { auto: true })`.
- Produces: `runChoiceHardeningJob`이 concern 없는 성공 직후 자동 반영. `CHOICE_HARDENING_SOURCE_CHANGED`면 job을 FAILED("원본 문제가 변경되어 자동 반영할 수 없습니다")로 마감, 그 외 오류는 SUCCEEDED 유지.

- [ ] **Step 1: 실패 테스트를 작성한다**

`src/server/choice-hardening-runner.test.ts` 상단 mock 블록에 서비스 mock을 추가한다 (`runEngineMock` 선언 다음):

```ts
const applyMock = vi.hoisted(() => vi.fn());
```

`vi.mock("./generation/run-engine", ...)` 다음에:

```ts
vi.mock("./choice-hardening-service", () => ({
  applyChoiceHardeningJob: applyMock,
}));
```

`beforeEach`에 `applyMock.mockReset(); applyMock.mockResolvedValue(undefined);`를 추가하고, `import { runChoiceHardeningJob } ...` 위에 `import { ServiceError } from "./errors";`를 추가한다.

describe 블록 끝에 테스트를 추가한다:

```ts
  it("concern 없는 성공은 자동 반영을 호출한다", async () => {
    runEngineMock.mockResolvedValueOnce(success(JSON.stringify(generated)));

    await runChoiceHardeningJob(11);

    expect(applyMock).toHaveBeenCalledWith(7, 11, { auto: true });
  });

  it("factualConcern이 있으면 자동 반영하지 않는다", async () => {
    runEngineMock.mockResolvedValueOnce(
      success(JSON.stringify({ ...generated, factual_concern: "정답 검증 필요" })),
    );

    await runChoiceHardeningJob(11);

    expect(applyMock).not.toHaveBeenCalled();
    expect(prismaMock.choiceHardeningJob.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUCCEEDED" }),
      }),
    );
  });

  it("fencing에 밀린 늦은 성공은 자동 반영하지 않는다", async () => {
    prismaMock.choiceHardeningJob.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    runEngineMock.mockResolvedValueOnce(success(JSON.stringify(generated)));

    await runChoiceHardeningJob(11);

    expect(applyMock).not.toHaveBeenCalled();
  });

  it("원본 변경 충돌은 job을 FAILED로 마감한다", async () => {
    runEngineMock.mockResolvedValueOnce(success(JSON.stringify(generated)));
    applyMock.mockRejectedValue(
      new ServiceError("CHOICE_HARDENING_SOURCE_CHANGED", "원본 변경", 409),
    );

    await runChoiceHardeningJob(11);

    expect(prismaMock.choiceHardeningJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: 11, attempt: 2, status: "SUCCEEDED", appliedAt: null },
      data: {
        status: "FAILED",
        errorMessage: "원본 문제가 변경되어 자동 반영할 수 없습니다",
        finishedAt: expect.any(Date),
      },
    });
  });

  it("자동 반영의 일시 오류는 SUCCEEDED를 유지한다", async () => {
    runEngineMock.mockResolvedValueOnce(success(JSON.stringify(generated)));
    applyMock.mockRejectedValue(new Error("DB 연결 끊김"));

    await runChoiceHardeningJob(11);

    expect(prismaMock.choiceHardeningJob.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: "SUCCEEDED" }),
      }),
    );
  });
```

- [ ] **Step 2: 테스트 실패를 확인한다**

```powershell
npm test -- --run src/server/choice-hardening-runner.test.ts
```

Expected: FAIL — `applyMock` 미호출.

- [ ] **Step 3: runner를 구현한다**

`src/server/choice-hardening-runner.ts` import에 추가:

```ts
import { applyChoiceHardeningJob } from "./choice-hardening-service";
import { ServiceError } from "./errors";
```

파일에 자동 반영 헬퍼를 추가한다 (`markFailed` 다음):

```ts
async function autoApply(questionId: number, token: ClaimToken): Promise<void> {
  try {
    await applyChoiceHardeningJob(questionId, token.id, { auto: true });
  } catch (error) {
    if (
      error instanceof ServiceError &&
      error.code === "CHOICE_HARDENING_SOURCE_CHANGED"
    ) {
      await prisma.choiceHardeningJob.updateMany({
        where: {
          id: token.id,
          attempt: token.attempt,
          status: "SUCCEEDED",
          appliedAt: null,
        },
        data: {
          status: "FAILED",
          errorMessage: "원본 문제가 변경되어 자동 반영할 수 없습니다",
          finishedAt: new Date(),
        },
      });
      return;
    }
    // 일시 오류: SUCCEEDED를 유지해 선지 검토 대기함에서 수동 승인할 수 있게 한다
    console.error("choice hardening auto-apply failed", error);
  }
}
```

`runChoiceHardeningJob`의 SUCCEEDED 갱신을 반환값을 받아 fencing 결과를 확인하도록 바꾸고, concern이 없으면 자동 반영한다:

```ts
    const succeeded = await prisma.choiceHardeningJob.updateMany({
      where: claimedWhere(token),
      data: {
        status: "SUCCEEDED",
        preview: {
          engine: job.engine,
          comment: parsed.comment,
          factualConcern: parsed.factualConcern,
          payload: {
            question: parsed.payload.question,
            choices: parsed.payload.choices,
            answer_indices: parsed.payload.answer_indices ?? [],
            choice_explanations: parsed.payload.choice_explanations ?? [],
          },
        } as unknown as Prisma.InputJsonValue,
        errorMessage: null,
        finishedAt: new Date(),
      },
    });
    if (succeeded.count === 0 || parsed.factualConcern !== null) return;
    await autoApply(job.questionId, token);
```

주의: `autoApply`는 내부에서 모든 예외를 처리하므로 outer try/catch의 `markFailed`로 흘러가지 않는다 (`markFailed`는 RUNNING fencing이라 어차피 no-op).

- [ ] **Step 4: 테스트 통과를 확인한다**

```powershell
npm test -- --run src/server/choice-hardening-runner.test.ts src/server/choice-hardening-service.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: 커밋**

```powershell
git add src/server/choice-hardening-runner.ts src/server/choice-hardening-runner.test.ts
git commit -m "feat: 검증 의견 없는 선지 강화 결과 자동 반영"
```

### Task 4: 목록·대기 건수 API

**Files:**
- Modify: `src/lib/api-types.ts` (목록 DTO 추가)
- Modify: `src/server/choice-hardening-service.ts` (`listChoiceHardeningJobs`, `countPendingChoiceHardeningJobs`)
- Create: `src/app/api/harden-jobs/route.ts`
- Create: `src/app/api/harden-jobs/route.test.ts`
- Create: `src/app/api/harden-jobs/pending-count/route.ts`
- Modify: `src/lib/api-client.ts` (`api.hardenJobs`)
- Test: `src/server/choice-hardening-service.test.ts`

**Interfaces:**
- Produces: `ChoiceHardeningJobListItemDto extends ChoiceHardeningJobDto` + `{ questionPreview: string; topicName: string; source: { question: string; choices: string[] } }`.
- Produces: `ChoiceHardeningJobListDto { pending; running; failed; recentApplied: ChoiceHardeningJobListItemDto[] }`.
- Produces: `listChoiceHardeningJobs(): Promise<ChoiceHardeningJobListDto>`, `countPendingChoiceHardeningJobs(): Promise<number>`.
- Produces: `api.hardenJobs.list(): Promise<ChoiceHardeningJobListDto>`, `api.hardenJobs.pendingCount(): Promise<{ count: number }>`.

- [ ] **Step 1: DTO 타입을 추가한다**

`src/lib/api-types.ts`의 `ChoiceHardeningJobDto` 정의 다음에 추가:

```ts
export interface ChoiceHardeningSourceDto {
  question: string;
  choices: string[];
}

export interface ChoiceHardeningJobListItemDto extends ChoiceHardeningJobDto {
  questionPreview: string;
  topicName: string;
  source: ChoiceHardeningSourceDto;
}

export interface ChoiceHardeningJobListDto {
  pending: ChoiceHardeningJobListItemDto[];
  running: ChoiceHardeningJobListItemDto[];
  failed: ChoiceHardeningJobListItemDto[];
  recentApplied: ChoiceHardeningJobListItemDto[];
}
```

- [ ] **Step 2: 서비스 실패 테스트를 작성한다**

`src/server/choice-hardening-service.test.ts`의 `prismaMock.choiceHardeningJob`에 `findMany: vi.fn(), count: vi.fn()`을 추가하고, import에 `listChoiceHardeningJobs`, `countPendingChoiceHardeningJobs`를 추가한다. 파일 끝에 테스트 추가:

```ts
  it("목록은 4개 분류를 조건에 맞게 조회한다", async () => {
    const withTopic = { question: { topic: { name: "주제" } } };
    prismaMock.choiceHardeningJob.findMany.mockResolvedValue([
      { ...job({ status: "SUCCEEDED", preview, finishedAt: new Date() }), ...withTopic },
    ]);

    const result = await listChoiceHardeningJobs();

    expect(result.pending).toHaveLength(1);
    const wheres = prismaMock.choiceHardeningJob.findMany.mock.calls.map(
      ([arg]) => (arg as { where: Record<string, unknown> }).where,
    );
    expect(wheres).toContainEqual({
      status: "SUCCEEDED",
      appliedAt: null,
      dismissedAt: null,
    });
    expect(wheres).toContainEqual({ status: "RUNNING" });
    expect(wheres).toContainEqual({ status: "FAILED", dismissedAt: null });
    expect(wheres).toContainEqual({ appliedAt: { not: null } });
  });

  it("반영 이력은 최근 20건으로 제한한다", async () => {
    prismaMock.choiceHardeningJob.findMany.mockResolvedValue([]);

    await listChoiceHardeningJobs();

    const appliedCall = prismaMock.choiceHardeningJob.findMany.mock.calls.find(
      ([arg]) =>
        JSON.stringify((arg as { where: unknown }).where) ===
        JSON.stringify({ appliedAt: { not: null } }),
    );
    expect(appliedCall?.[0]).toMatchObject({
      take: 20,
      orderBy: { appliedAt: "desc" },
    });
  });

  it("목록 항목은 questionPreview, topicName, source를 포함한다", async () => {
    prismaMock.choiceHardeningJob.findMany.mockResolvedValue([
      {
        ...job({ status: "SUCCEEDED", preview, finishedAt: new Date() }),
        question: { topic: { name: "AWS" } },
      },
    ]);

    const result = await listChoiceHardeningJobs();

    expect(result.pending[0]).toMatchObject({
      questionPreview: original.question,
      topicName: "AWS",
      source: { question: original.question, choices: original.choices },
    });
  });

  it("승인 대기 건수를 센다", async () => {
    prismaMock.choiceHardeningJob.count.mockResolvedValue(3);

    await expect(countPendingChoiceHardeningJobs()).resolves.toBe(3);

    expect(prismaMock.choiceHardeningJob.count).toHaveBeenCalledWith({
      where: { status: "SUCCEEDED", appliedAt: null, dismissedAt: null },
    });
  });
```

- [ ] **Step 3: 테스트 실패를 확인한다**

```powershell
npm test -- --run src/server/choice-hardening-service.test.ts
```

Expected: FAIL — `listChoiceHardeningJobs` export 부재.

- [ ] **Step 4: 서비스를 구현한다**

`src/server/choice-hardening-service.ts` import를 확장한다:

```ts
import type { McqPayload } from "@/core/types";
import type {
  ChoiceHardeningJobDto,
  ChoiceHardeningJobListDto,
  ChoiceHardeningJobListItemDto,
  HardenPreviewDto,
} from "@/lib/api-types";
```

파일 끝(export 문 위)에 추가:

```ts
const APPLIED_HISTORY_LIMIT = 20;

const listInclude = {
  question: { select: { topic: { select: { name: true } } } },
} as const;

type JobWithTopic = ChoiceHardeningJob & {
  question: { topic: { name: string } };
};

function toListItem(job: JobWithTopic): ChoiceHardeningJobListItemDto {
  const source = job.sourcePayload as unknown as McqPayload;
  return {
    ...toDto(job),
    questionPreview:
      source.question.length > 80
        ? `${source.question.slice(0, 80)}...`
        : source.question,
    topicName: job.question.topic.name,
    source: { question: source.question, choices: source.choices },
  };
}

export async function listChoiceHardeningJobs(): Promise<ChoiceHardeningJobListDto> {
  await recoverStaleChoiceHardeningJobs();
  const [pending, running, failed, recentApplied] = await Promise.all([
    prisma.choiceHardeningJob.findMany({
      where: { status: "SUCCEEDED", appliedAt: null, dismissedAt: null },
      orderBy: { finishedAt: "desc" },
      include: listInclude,
    }),
    prisma.choiceHardeningJob.findMany({
      where: { status: "RUNNING" },
      orderBy: { createdAt: "desc" },
      include: listInclude,
    }),
    prisma.choiceHardeningJob.findMany({
      where: { status: "FAILED", dismissedAt: null },
      orderBy: { finishedAt: "desc" },
      include: listInclude,
    }),
    prisma.choiceHardeningJob.findMany({
      where: { appliedAt: { not: null } },
      orderBy: { appliedAt: "desc" },
      take: APPLIED_HISTORY_LIMIT,
      include: listInclude,
    }),
  ]);
  return {
    pending: pending.map(toListItem),
    running: running.map(toListItem),
    failed: failed.map(toListItem),
    recentApplied: recentApplied.map(toListItem),
  };
}

export async function countPendingChoiceHardeningJobs(): Promise<number> {
  return prisma.choiceHardeningJob.count({
    where: { status: "SUCCEEDED", appliedAt: null, dismissedAt: null },
  });
}
```

- [ ] **Step 5: 라우트 2개와 라우트 테스트를 작성한다**

`src/app/api/harden-jobs/route.ts` (신규):

```ts
import { listChoiceHardeningJobs } from "@/server/choice-hardening-service";
import { handleApiError, jsonOk } from "@/server/http";

export async function GET() {
  try {
    return jsonOk(await listChoiceHardeningJobs());
  } catch (error) {
    return handleApiError(error);
  }
}
```

`src/app/api/harden-jobs/pending-count/route.ts` (신규):

```ts
import { countPendingChoiceHardeningJobs } from "@/server/choice-hardening-service";
import { handleApiError, jsonOk } from "@/server/http";

export async function GET() {
  try {
    return jsonOk({ count: await countPendingChoiceHardeningJobs() });
  } catch (error) {
    return handleApiError(error);
  }
}
```

`src/app/api/harden-jobs/route.test.ts` (신규):

```ts
import { describe, expect, it, vi } from "vitest";

const listMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/choice-hardening-service", () => ({
  listChoiceHardeningJobs: listMock,
}));

import { GET } from "./route";

describe("GET /api/harden-jobs", () => {
  it("4개 분류 목록을 반환한다", async () => {
    const payload = { pending: [], running: [], failed: [], recentApplied: [] };
    listMock.mockResolvedValue(payload);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
  });
});
```

- [ ] **Step 6: api-client에 hardenJobs를 추가한다**

`src/lib/api-client.ts` import 타입에 `ChoiceHardeningJobListDto`를 추가하고, `keywords:` 그룹 앞에 추가:

```ts
  hardenJobs: {
    list: () => request<ChoiceHardeningJobListDto>("/api/harden-jobs"),
    pendingCount: () =>
      request<{ count: number }>("/api/harden-jobs/pending-count"),
  },
```

- [ ] **Step 7: 테스트 통과를 확인한다**

```powershell
npm test -- --run src/server/choice-hardening-service.test.ts src/app/api/harden-jobs/route.test.ts
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 8: 커밋**

```powershell
git add src/lib/api-types.ts src/lib/api-client.ts src/server/choice-hardening-service.ts src/server/choice-hardening-service.test.ts src/app/api/harden-jobs
git commit -m "feat: 선지 강화 작업 목록·대기 건수 API 추가"
```

### Task 5: FactualConcernBanner 분리 + ResultPanel 단순화

**Files:**
- Create: `src/lib/engine-label.ts`
- Create: `src/components/FactualConcernBanner.tsx`
- Modify: `src/components/ResultPanel.tsx`
- Test: `src/components/ResultPanel.test.tsx`

**Interfaces:**
- Produces: `engineLabel(engine: GenerationEngineDto): string` (`src/lib/engine-label.ts`).
- Produces: `FactualConcernBanner` 컴포넌트 — props `{ questionId: number; original: { question: string; choices: string[] }; concern: string; onApplied: () => void }`. `original.choices`는 **원본 인덱스 순서**의 선지 텍스트 배열이다. Task 6의 검토 카드가 이 컴포넌트를 재사용한다.
- Produces: ResultPanel 선지 강화 섹션 — 미리보기/적용하기 UI 제거, 자동 반영/검토 안내 상태 표시.

- [ ] **Step 1: ResultPanel 실패 테스트를 작성한다**

`src/components/ResultPanel.test.tsx`의 `job()` 헬퍼에 `autoApplied: false, dismissedAt: null`을 추가하고, 파일에 preview 픽스처를 추가한다 (`result` 상수 다음):

```ts
const preview = {
  engine: "CLAUDE" as const,
  comment: "오답을 더 어렵게 바꿨습니다",
  factualConcern: null,
  payload: {
    question: "원본 질문",
    choices: ["정답", "강화 오답 1", "강화 오답 2", "강화 오답 3"],
    answer_indices: [0],
    choice_explanations: ["근거", "근거", "근거", "근거"],
  },
};
```

describe 블록에 테스트를 추가한다:

```ts
  it("자동 반영이 확인되면 자동 반영 문구를 보여준다", async () => {
    apiMock.getHardenChoices.mockResolvedValue({
      job: job({
        status: "SUCCEEDED",
        preview,
        appliedAt: "2026-07-15T00:05:00.000Z",
        autoApplied: true,
      }),
    });
    await startTracking();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(
      screen.getByText("✅ 자동 반영됨 — 다음 학습부터 새 선지가 나옵니다 🎉"),
    ).toBeVisible();
  });

  it("검증 의견이 있으면 선지 검토 링크를 보여준다", async () => {
    apiMock.getHardenChoices.mockResolvedValue({
      job: job({
        status: "SUCCEEDED",
        preview: { ...preview, factualConcern: "정답이 최신 문서와 다릅니다" },
      }),
    });
    await startTracking();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getByText(/검증 의견이 있어요/)).toBeVisible();
    expect(screen.getByRole("link", { name: "선지 검토" })).toHaveAttribute(
      "href",
      "/hardening",
    );
  });

  it("concern 없이 미반영이 지속되면 3회 폴링 후 수동 승인 안내로 전환한다", async () => {
    apiMock.getHardenChoices.mockResolvedValue({
      job: job({ status: "SUCCEEDED", preview }),
    });
    await startTracking();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.queryByText(/수동으로 승인할 수 있어요/)).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByText(/수동으로 승인할 수 있어요/)).toBeVisible();
  });

  it("적용하기 버튼을 렌더하지 않는다", async () => {
    apiMock.getHardenChoices.mockResolvedValue({
      job: job({ status: "SUCCEEDED", preview }),
    });
    await startTracking();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(
      screen.queryByRole("button", { name: "✅ 적용하기" }),
    ).not.toBeInTheDocument();
  });

  it("거절된 job을 받으면 새로 생성 안내로 전환한다", async () => {
    apiMock.hardenChoices.mockResolvedValue({
      job: job({
        status: "SUCCEEDED",
        preview,
        dismissedAt: "2026-07-15T00:06:00.000Z",
      }),
    });
    render(
      <ResultPanel question={question} result={result} onNext={vi.fn()} isLast={false} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Claude로 올리기" }));
    });

    expect(screen.getByText(/이전 결과를 거절했습니다/)).toBeVisible();
    expect(screen.getByRole("button", { name: "새로 생성" })).toBeVisible();
  });
```

기존 테스트 중 preview/적용하기 상태를 단언하는 테스트가 있으면 (예: SUCCEEDED에서 "✅ 적용하기" 노출 단언) 새 UX에 맞게 문구 단언을 교체한다 — SUCCEEDED + 미반영은 "생성 중" 유지, 반영되면 자동 반영 문구.

- [ ] **Step 2: 테스트 실패를 확인한다**

```powershell
npm test -- --run src/components/ResultPanel.test.tsx
```

Expected: FAIL — 자동 반영 문구/링크 부재.

- [ ] **Step 3: engineLabel 공용 유틸을 만든다**

`src/lib/engine-label.ts` (신규):

```ts
import type { GenerationEngineDto } from "./api-types";

export function engineLabel(engine: GenerationEngineDto): string {
  if (engine === "CLAUDE") return "Claude";
  if (engine === "CODEX") return "Codex";
  return "Antigravity";
}
```

- [ ] **Step 4: FactualConcernBanner를 분리·일반화한다**

`src/components/FactualConcernBanner.tsx` (신규) — ResultPanel의 배너 로직을 이식하되 `question: StudyQuestionDto` 대신 `original`을 받는다:

```tsx
"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { engineLabel } from "@/lib/engine-label";
import type { FactualReviewDto, GenerationEngineDto } from "@/lib/api-types";

const ENGINES: GenerationEngineDto[] = ["CLAUDE", "CODEX", "ANTIGRAVITY"];

type FactualReviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "result"; result: FactualReviewDto; applying: boolean }
  | { status: "error"; message: string };

export interface FactualConcernOriginal {
  question: string;
  choices: string[];
}

interface FactualConcernBannerProps {
  questionId: number;
  original: FactualConcernOriginal;
  concern: string;
  onApplied: () => void;
}

export default function FactualConcernBanner({
  questionId,
  original,
  concern,
  onApplied,
}: FactualConcernBannerProps) {
  const [engine, setEngine] = useState<GenerationEngineDto>("CLAUDE");
  const [state, setState] = useState<FactualReviewState>({ status: "idle" });

  async function requestReview() {
    setState({ status: "loading" });
    try {
      const result = await api.questions.reviewFact(questionId, engine, concern);
      setState({ status: "result", result, applying: false });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "요청 실패",
      });
    }
  }

  async function applyReview() {
    if (state.status !== "result" || state.applying || !state.result.payload) return;
    const payload = state.result.payload;
    setState({ ...state, applying: true });
    try {
      await api.questions.update(questionId, { payload, explanation: null });
      // 부모가 관련 상태를 리셋하면서 이 배너는 언마운트되고,
      // 성공 메시지는 부모의 안정적인 위치에서 렌더된다.
      onApplied();
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "적용 실패",
      });
    }
  }

  const busy = state.status === "loading" || (state.status === "result" && state.applying);

  return (
    <div className="space-y-2">
      <p className="rounded-[12px] border border-[color:var(--warning)] bg-[color:var(--warning-soft)] px-3 py-2 text-sm">
        ⚠️ 사실 확인 필요: {concern}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={engine}
          onChange={(event) => setEngine(event.target.value as GenerationEngineDto)}
          disabled={busy}
          className="field"
        >
          {ENGINES.map((value) => (
            <option key={value} value={value}>
              {engineLabel(value)}
            </option>
          ))}
        </select>
        <button
          onClick={requestReview}
          disabled={busy}
          className="btn btn-secondary text-sm"
        >
          {state.status === "loading" ? "확인 중..." : "🔍 사실 확인 요청"}
        </button>
      </div>
      {state.status === "error" && (
        <p className="text-[color:var(--danger)]">❌ {state.message}</p>
      )}
      {state.status === "result" && state.result.verdict === "rejected" && (
        <div className="surface surface-pad space-y-1">
          <p className="text-[color:var(--success)]">✅ 문제에 이상이 없습니다</p>
          <p className="text-[color:var(--muted)]">{state.result.comment}</p>
          {state.result.evidenceUrl && (
            <a
              href={state.result.evidenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-[color:var(--brand-strong)] underline underline-offset-2 hover:text-[color:var(--brand)]"
            >
              근거 문서 보기
            </a>
          )}
        </div>
      )}
      {state.status === "result" && state.result.verdict === "unverifiable" && (
        <div className="surface surface-pad space-y-1">
          <p>판단 불가</p>
          <p className="text-[color:var(--muted)]">{state.result.comment}</p>
        </div>
      )}
      {state.status === "result" &&
        state.result.verdict === "confirmed" &&
        state.result.payload &&
        (() => {
          const payload = state.result.payload;
          const applying = state.applying;
          return (
            <div className="surface surface-pad space-y-2">
              <p className="text-[color:var(--muted)]">{state.result.comment}</p>
              {state.result.evidenceUrl && (
                <a
                  href={state.result.evidenceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex text-[color:var(--brand-strong)] underline underline-offset-2 hover:text-[color:var(--brand)]"
                >
                  근거 문서 보기
                </a>
              )}
              <div className="diff-comparison" aria-label="문제와 선지 원본 및 교정 비교">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="section-title">원본 ↔ 교정 비교</h3>
                    <p className="muted mt-1 text-xs">사실 오류를 바로잡은 내용을 확인하세요.</p>
                  </div>
                  <div className="diff-legend" aria-label="변경 범례">
                    <span className="diff-legend-item"><del className="diff-deleted">원본</del></span>
                    <span className="diff-legend-item"><ins className="diff-added">교정</ins></span>
                  </div>
                </div>
                <div className="diff-comparison-grid">
                  <section className="diff-panel">
                    <h4 className="diff-panel-title">문제 본문</h4>
                    <del className="diff-deleted">{original.question}</del>
                    <ins className="diff-added ml-1">{payload.question}</ins>
                  </section>
                </div>
                <ul className="space-y-2 text-sm">
                  {payload.choices.map((newText, i) => {
                    const oldText = original.choices[i] ?? "(원본 없음)";
                    const isAnswer = payload.answer_indices.includes(i);
                    if (oldText === newText) {
                      return (
                        <li key={i} className="diff-panel">
                          <p className="font-medium">
                            선지 {i + 1} {isAnswer && <span className="chip ml-1">정답 ✅</span>}
                          </p>
                          <p className="text-[color:var(--muted)]">변경 없음: {newText}</p>
                        </li>
                      );
                    }
                    return (
                      <li key={i} className="diff-panel space-y-1">
                        <p className="font-medium">
                          선지 {i + 1} {isAnswer && <span className="chip ml-1">정답 ✅</span>}
                        </p>
                        <p><del className="diff-deleted">{oldText}</del></p>
                        <p><ins className="diff-added">{newText}</ins></p>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <button
                onClick={applyReview}
                disabled={applying}
                className="btn btn-primary text-sm"
              >
                {applying ? "적용 중..." : "✅ 적용하기"}
              </button>
            </div>
          );
        })()}
    </div>
  );
}
```

- [ ] **Step 5: ResultPanel을 수정한다**

`src/components/ResultPanel.tsx`에서:

(a) 인라인 `FactualConcernBanner` 함수, `FactualConcernBannerProps`, `FactualReviewState` 타입, 로컬 `engineLabel` 함수를 삭제하고 import를 정리한다:

```ts
import FactualConcernBanner from "./FactualConcernBanner";
import { engineLabel } from "@/lib/engine-label";
```

`FactualReviewDto`, `HardenPreviewDto` 타입 import는 더 이상 쓰지 않으면 제거한다.

(b) `HardenState`와 `hardenStateForJob`을 교체한다:

```ts
type HardenState =
  | { status: "idle" }
  | { status: "loading"; engine: GenerationEngineDto }
  | {
      status: "tracking";
      job: ChoiceHardeningJobDto;
      pollError: string | null;
      succeededPolls: number;
    }
  | { status: "autoApplied" }
  | { status: "needsReview"; kind: "concern" | "manual" }
  | { status: "error"; message: string; job?: ChoiceHardeningJobDto };

const MANUAL_REVIEW_POLL_THRESHOLD = 3;

function hardenStateForJob(
  job: ChoiceHardeningJobDto,
  succeededPolls = 0,
): HardenState {
  if (job.status === "FAILED") {
    return { status: "error", message: job.errorMessage ?? "작업이 실패했습니다", job };
  }
  if (job.status === "SUCCEEDED") {
    if (job.appliedAt) return { status: "autoApplied" };
    if (job.dismissedAt) {
      return { status: "error", message: "이전 결과를 거절했습니다 — 새로 생성해 주세요", job };
    }
    if (job.preview?.factualConcern) return { status: "needsReview", kind: "concern" };
    if (succeededPolls >= MANUAL_REVIEW_POLL_THRESHOLD) {
      return { status: "needsReview", kind: "manual" };
    }
    return { status: "tracking", job, pollError: null, succeededPolls };
  }
  return { status: "tracking", job, pollError: null, succeededPolls: 0 };
}
```

(c) `pollHardenJob`에서 성공 시 분기를 교체한다:

```ts
      setHarden((current) => {
        if (current.status !== "tracking" || current.job.id !== jobId) return current;
        const nextPolls =
          job.status === "SUCCEEDED" && !job.appliedAt && !job.preview?.factualConcern
            ? current.succeededPolls + 1
            : 0;
        return hardenStateForJob(job, nextPolls);
      });
```

(d) `applyHarden` 함수를 삭제한다.

(e) 배너용 원본 헬퍼를 추가한다 (`mcqAnswerText` 다음):

```ts
function bannerOriginal(
  question: Extract<StudyQuestionDto, { type: "MCQ" }>,
): { question: string; choices: string[] } {
  const choices: string[] = [];
  for (const choice of question.choices) {
    choices[choice.original_index] = choice.text;
  }
  return { question: question.question, choices };
}
```

(f) 해설 섹션의 배너 호출부를 새 시그니처로 교체한다 (MCQ일 때만 렌더):

```tsx
                {state.factualConcern && question.type === "MCQ" && (
                  <FactualConcernBanner
                    questionId={question.id}
                    original={bannerOriginal(question)}
                    concern={state.factualConcern}
                    onApplied={resetAfterFactualApply}
                  />
                )}
```

(g) 선지 강화 섹션 JSX 전체를 교체한다:

```tsx
      {question.type === "MCQ" && (
        <div className="space-y-2 border-t border-[color:var(--border)] pt-3">
          <p className="section-title">🎯 선지 난이도 올리기</p>
          {(harden.status === "idle" ||
            harden.status === "loading" ||
            harden.status === "error") && (
            <div className="flex flex-wrap gap-2">
              {ENGINES.map(({ value }) => (
                <button
                  key={value}
                  onClick={() => requestHarden(value)}
                  disabled={harden.status === "loading"}
                  className="btn btn-secondary text-sm"
                >
                  {harden.status === "loading" && harden.engine === value
                    ? "요청 중..."
                    : `${engineLabel(value)}로 올리기`}
                </button>
              ))}
            </div>
          )}
          {harden.status === "tracking" && (
            <div
              className="rounded-[10px] border border-[color:var(--brand)] bg-[color:var(--brand-soft)] px-3 py-2 text-sm"
              role="status"
              aria-live="polite"
            >
              <p className="font-semibold">생성 중 — 완료되면 자동 반영됩니다</p>
              <p className="mt-1 text-[color:var(--muted)]">
                페이지를 떠나도 작업은 서버에서 계속 진행돼요.
              </p>
              {harden.pollError && (
                <p
                  className="mt-2 rounded-[10px] bg-[color:var(--warning-soft)] px-3 py-2 text-[color:var(--text)]"
                  role="alert"
                >
                  ⚠️ {harden.pollError} 자동 확인은 계속됩니다.
                </p>
              )}
            </div>
          )}
          {harden.status === "autoApplied" && (
            <p className="text-[color:var(--success)]">
              ✅ 자동 반영됨 — 다음 학습부터 새 선지가 나옵니다 🎉
            </p>
          )}
          {harden.status === "needsReview" && (
            <p className="rounded-[10px] bg-[color:var(--warning-soft)] px-3 py-2 text-sm">
              {harden.kind === "concern"
                ? "⚠️ 검증 의견이 있어요 — "
                : "⏳ 아직 반영되지 않았어요 — "}
              <a
                href="/hardening"
                className="font-medium underline underline-offset-2"
              >
                선지 검토
              </a>
              {harden.kind === "concern"
                ? "에서 승인해 주세요"
                : "에서 수동으로 승인할 수 있어요"}
            </p>
          )}
          {harden.status === "error" && (
            <div className="space-y-2">
              <p className="text-[color:var(--danger)]">❌ {harden.message}</p>
              {harden.job && (
                <button
                  onClick={() => requestHarden(harden.job!.engine, true)}
                  className="btn btn-secondary text-sm"
                >
                  새로 생성
                </button>
              )}
            </div>
          )}
        </div>
      )}
```

- [ ] **Step 6: 테스트 통과를 확인한다**

```powershell
npm test -- --run src/components/ResultPanel.test.tsx
npx tsc --noEmit
npm run lint
```

Expected: PASS. lint에서 미사용 import가 나오면 제거한다.

- [ ] **Step 7: 커밋**

```powershell
git add src/lib/engine-label.ts src/components/FactualConcernBanner.tsx src/components/ResultPanel.tsx src/components/ResultPanel.test.tsx
git commit -m "refactor: 사실 확인 배너 분리 및 학습 화면 선지 강화 자동 반영 UX 적용"
```

### Task 6: 선지 검토 페이지 `/hardening`

**Files:**
- Create: `src/components/HardeningPendingCard.tsx`
- Create: `src/app/hardening/page.tsx`
- Create: `src/app/hardening/page.test.tsx`

**Interfaces:**
- Consumes: `api.hardenJobs.list()`, `api.questions.applyHardenChoices / dismissHardenChoices / hardenChoices(force)`, `FactualConcernBanner`, `engineLabel`.
- Produces: `HardeningPendingCard({ item: ChoiceHardeningJobListItemDto, onChanged: () => void })`.

- [ ] **Step 1: 실패 테스트를 작성한다**

`src/app/hardening/page.test.tsx` (신규):

```tsx
// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const questionsMock = vi.hoisted(() => ({
  applyHardenChoices: vi.fn(),
  dismissHardenChoices: vi.fn(),
  hardenChoices: vi.fn(),
  reviewFact: vi.fn(),
  update: vi.fn(),
}));
const hardenJobsMock = vi.hoisted(() => ({
  list: vi.fn(),
  pendingCount: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
  api: { questions: questionsMock, hardenJobs: hardenJobsMock },
}));

import HardeningReviewPage from "./page";

function listItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    questionId: 7,
    sourceHash: "a".repeat(64),
    engine: "CLAUDE" as const,
    verifyEngine: "CLAUDE" as const,
    attempt: 1,
    status: "SUCCEEDED" as const,
    stage: "GENERATING" as const,
    preview: {
      engine: "CLAUDE" as const,
      comment: "오답을 더 어렵게 바꿨습니다",
      factualConcern: null,
      payload: {
        question: "원본 질문",
        choices: ["정답", "강화 오답 1", "강화 오답 2", "강화 오답 3"],
        answer_indices: [0],
        choice_explanations: ["근거", "근거", "근거", "근거"],
      },
    },
    errorMessage: null,
    createdAt: "2026-07-15T00:00:00.000Z",
    startedAt: "2026-07-15T00:00:01.000Z",
    finishedAt: "2026-07-15T00:01:00.000Z",
    appliedAt: null,
    autoApplied: false,
    dismissedAt: null,
    questionPreview: "원본 질문",
    topicName: "AWS",
    source: {
      question: "원본 질문",
      choices: ["정답", "오답 1", "오답 2", "오답 3"],
    },
    ...overrides,
  };
}

function emptyList() {
  return { pending: [], running: [], failed: [], recentApplied: [] };
}

describe("선지 검토 페이지", () => {
  beforeEach(() => {
    for (const mock of Object.values(questionsMock)) mock.mockReset();
    for (const mock of Object.values(hardenJobsMock)) mock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("4개 섹션을 렌더한다", async () => {
    hardenJobsMock.list.mockResolvedValue(emptyList());

    await act(async () => {
      render(<HardeningReviewPage />);
    });

    expect(screen.getByText("⏳ 승인 대기")).toBeVisible();
    expect(screen.getByText("🔄 진행 중")).toBeVisible();
    expect(screen.getByText("❌ 실패")).toBeVisible();
    expect(screen.getByText("📜 최근 반영 이력")).toBeVisible();
  });

  it("승인 대기 카드에서 승인하면 apply를 호출하고 목록을 갱신한다", async () => {
    hardenJobsMock.list.mockResolvedValue({ ...emptyList(), pending: [listItem()] });
    questionsMock.applyHardenChoices.mockResolvedValue({ ok: true });

    await act(async () => {
      render(<HardeningReviewPage />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "✅ 승인" }));
    });

    expect(questionsMock.applyHardenChoices).toHaveBeenCalledWith(7, 11);
    expect(hardenJobsMock.list).toHaveBeenCalledTimes(2);
  });

  it("거절 버튼은 dismiss를 호출한다", async () => {
    hardenJobsMock.list.mockResolvedValue({ ...emptyList(), pending: [listItem()] });
    questionsMock.dismissHardenChoices.mockResolvedValue({ ok: true });

    await act(async () => {
      render(<HardeningReviewPage />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "🗑 거절" }));
    });

    expect(questionsMock.dismissHardenChoices).toHaveBeenCalledWith(7, 11);
  });

  it("검증 의견이 있으면 사실 확인 배너를 보여준다", async () => {
    const item = listItem();
    (item.preview as { factualConcern: string | null }).factualConcern =
      "정답이 최신 문서와 다릅니다";
    hardenJobsMock.list.mockResolvedValue({ ...emptyList(), pending: [item] });

    await act(async () => {
      render(<HardeningReviewPage />);
    });

    expect(screen.getByText(/사실 확인 필요/)).toBeVisible();
    expect(screen.getByRole("button", { name: "🔍 사실 확인 요청" })).toBeVisible();
  });

  it("승인 409 충돌은 안내 메시지를 보여준다", async () => {
    const { ApiError } = await import("@/lib/api-client");
    hardenJobsMock.list.mockResolvedValue({ ...emptyList(), pending: [listItem()] });
    questionsMock.applyHardenChoices.mockRejectedValue(
      new ApiError("CHOICE_HARDENING_SOURCE_CHANGED", "원본 변경", 409),
    );

    await act(async () => {
      render(<HardeningReviewPage />);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "✅ 승인" }));
    });

    expect(
      screen.getByText(/원본이 변경되어 적용할 수 없습니다/),
    ).toBeVisible();
  });

  it("실패 항목은 재시도와 거절 버튼을 보여준다", async () => {
    hardenJobsMock.list.mockResolvedValue({
      ...emptyList(),
      failed: [listItem({ status: "FAILED", preview: null, errorMessage: "CLI 실행 실패" })],
    });

    await act(async () => {
      render(<HardeningReviewPage />);
    });

    expect(screen.getByText(/CLI 실행 실패/)).toBeVisible();
    expect(screen.getByRole("button", { name: "🔁 재시도" })).toBeVisible();
  });

  it("반영 이력은 자동/수동 배지를 구분한다", async () => {
    hardenJobsMock.list.mockResolvedValue({
      ...emptyList(),
      recentApplied: [
        listItem({ appliedAt: "2026-07-15T00:05:00.000Z", autoApplied: true }),
        listItem({ id: 12, appliedAt: "2026-07-15T00:06:00.000Z", autoApplied: false }),
      ],
    });

    await act(async () => {
      render(<HardeningReviewPage />);
    });

    expect(screen.getByText("자동 반영")).toBeVisible();
    expect(screen.getByText("수동 반영")).toBeVisible();
  });
});
```

- [ ] **Step 2: 테스트 실패를 확인한다**

```powershell
npm test -- --run src/app/hardening/page.test.tsx
```

Expected: FAIL — `./page` 모듈 부재.

- [ ] **Step 3: 승인 대기 카드 컴포넌트를 구현한다**

`src/components/HardeningPendingCard.tsx` (신규):

```tsx
"use client";

import { useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { engineLabel } from "@/lib/engine-label";
import type { ChoiceHardeningJobListItemDto } from "@/lib/api-types";
import FactualConcernBanner from "./FactualConcernBanner";

interface HardeningPendingCardProps {
  item: ChoiceHardeningJobListItemDto;
  onChanged: () => void;
}

function actionError(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.code === "CHOICE_HARDENING_SOURCE_CHANGED") {
    return "원본이 변경되어 적용할 수 없습니다 — 거절 후 새로 생성해 주세요";
  }
  return error instanceof Error ? error.message : fallback;
}

export default function HardeningPendingCard({
  item,
  onChanged,
}: HardeningPendingCardProps) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const preview = item.preview;
  if (!preview) return null;

  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      onChanged();
    } catch (error) {
      setMessage(actionError(error, fallback));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface surface-pad space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="subtle">#{item.id}</span>
        <span className="font-bold">{item.topicName}</span>
        <span className="chip">{engineLabel(item.engine)}</span>
      </div>
      <p className="font-medium">{item.source.question}</p>
      {preview.factualConcern && (
        <FactualConcernBanner
          questionId={item.questionId}
          original={item.source}
          concern={preview.factualConcern}
          onApplied={() =>
            void run(
              () => api.questions.dismissHardenChoices(item.questionId, item.id),
              "처리 실패",
            )
          }
        />
      )}
      <p className="text-[color:var(--muted)]">{preview.comment}</p>
      <ul className="space-y-2 text-sm">
        {preview.payload.choices.map((newText, i) => {
          const oldText = item.source.choices[i];
          const isAnswer = preview.payload.answer_indices.includes(i);
          if (isAnswer) {
            return (
              <li key={i}>
                <span className="font-medium text-[color:var(--text)]">{newText}</span>{" "}
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
              <p className="text-[color:var(--muted)] line-through">{oldText}</p>
              <p className="font-medium text-[color:var(--text)]">→ {newText}</p>
            </li>
          );
        })}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button
          onClick={() =>
            void run(
              () => api.questions.applyHardenChoices(item.questionId, item.id),
              "승인 실패",
            )
          }
          disabled={busy}
          className="btn btn-primary text-sm"
        >
          ✅ 승인
        </button>
        <button
          onClick={() =>
            void run(
              () => api.questions.dismissHardenChoices(item.questionId, item.id),
              "거절 실패",
            )
          }
          disabled={busy}
          className="btn btn-secondary text-sm"
        >
          🗑 거절
        </button>
        <button
          onClick={() =>
            void run(
              () => api.questions.hardenChoices(item.questionId, item.engine, true),
              "재생성 실패",
            )
          }
          disabled={busy}
          className="btn btn-secondary text-sm"
        >
          🔁 재생성
        </button>
      </div>
      {message && <p className="text-[color:var(--danger)]">❌ {message}</p>}
    </div>
  );
}
```

주의: 사실 교정이 적용되면(`onApplied`) 이 job은 원본이 바뀌어 영영 적용 불가이므로 자동으로 거절 처리 후 목록을 갱신한다 (스펙 요구).

- [ ] **Step 4: 페이지를 구현한다**

`src/app/hardening/page.tsx` (신규):

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { engineLabel } from "@/lib/engine-label";
import type { ChoiceHardeningJobListDto, ChoiceHardeningJobListItemDto } from "@/lib/api-types";
import HardeningPendingCard from "@/components/HardeningPendingCard";

const POLL_INTERVAL_MS = 5000;

function jobLine(item: ChoiceHardeningJobListItemDto): string {
  return `#${item.id} · ${item.topicName} · ${engineLabel(item.engine)}`;
}

export default function HardeningReviewPage() {
  const [data, setData] = useState<ChoiceHardeningJobListDto | null>(null);
  const [message, setMessage] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setData(await api.hardenJobs.list());
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "목록을 불러오지 못했습니다",
      );
    }
  }, []);

  useEffect(() => {
    void refresh();
    const tick = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    const interval = window.setInterval(tick, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", tick);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [refresh]);

  async function runAction(action: () => Promise<unknown>, fallback: string) {
    setActionBusy(true);
    try {
      await action();
      await refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : fallback);
    } finally {
      setActionBusy(false);
    }
  }

  return (
    <div className="app-page space-y-6">
      <div className="page-header">
        <h1 className="page-title">선지 검토</h1>
        <p className="page-subtitle">
          선지 강화 결과를 승인하고 진행 상황을 확인합니다. 검증 의견이 없는
          결과는 자동 반영됩니다.
        </p>
      </div>

      {message && (
        <p className="text-sm text-[color:var(--danger)]" role="alert">
          ❌ {message}
        </p>
      )}
      {data === null && !message && <p className="muted text-sm">불러오는 중...</p>}

      {data !== null && (
        <>
          <section className="space-y-2">
            <h2 className="section-title">⏳ 승인 대기</h2>
            {data.pending.length === 0 && (
              <p className="muted text-sm">승인이 필요한 항목이 없습니다 🎉</p>
            )}
            {data.pending.map((item) => (
              <HardeningPendingCard key={item.id} item={item} onChanged={() => void refresh()} />
            ))}
          </section>

          <section className="space-y-2">
            <h2 className="section-title">🔄 진행 중</h2>
            {data.running.length === 0 && (
              <p className="muted text-sm">진행 중인 작업이 없습니다.</p>
            )}
            {data.running.map((item) => (
              <div key={item.id} className="surface surface-pad text-sm">
                <p className="font-medium">{item.questionPreview}</p>
                <p className="subtle mt-1 text-xs">
                  {jobLine(item)} · 시작{" "}
                  {new Date(item.startedAt ?? item.createdAt).toLocaleString()}
                </p>
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <h2 className="section-title">❌ 실패</h2>
            {data.failed.length === 0 && (
              <p className="muted text-sm">실패한 작업이 없습니다.</p>
            )}
            {data.failed.map((item) => (
              <div key={item.id} className="surface surface-pad space-y-2 text-sm">
                <p className="font-medium">{item.questionPreview}</p>
                <p className="break-all text-[color:var(--danger)]">
                  {item.errorMessage ?? "알 수 없는 오류"}
                </p>
                <p className="subtle text-xs">{jobLine(item)}</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() =>
                      void runAction(
                        () => api.questions.hardenChoices(item.questionId, item.engine, true),
                        "재시도 실패",
                      )
                    }
                    disabled={actionBusy}
                    className="btn btn-secondary text-sm"
                  >
                    🔁 재시도
                  </button>
                  <button
                    onClick={() =>
                      void runAction(
                        () => api.questions.dismissHardenChoices(item.questionId, item.id),
                        "거절 실패",
                      )
                    }
                    disabled={actionBusy}
                    className="btn btn-secondary text-sm"
                  >
                    🗑 거절
                  </button>
                </div>
              </div>
            ))}
          </section>

          <section className="space-y-2">
            <h2 className="section-title">📜 최근 반영 이력</h2>
            {data.recentApplied.length === 0 && (
              <p className="muted text-sm">반영된 항목이 없습니다.</p>
            )}
            {data.recentApplied.map((item) => (
              <div key={item.id} className="surface surface-pad text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="chip">
                    {item.autoApplied ? "자동 반영" : "수동 반영"}
                  </span>
                  <p className="min-w-0 flex-1 font-medium">{item.questionPreview}</p>
                </div>
                <p className="subtle mt-1 text-xs">
                  {jobLine(item)} · 반영{" "}
                  {item.appliedAt ? new Date(item.appliedAt).toLocaleString() : "-"}
                </p>
              </div>
            ))}
          </section>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: 테스트 통과를 확인한다**

```powershell
npm test -- --run src/app/hardening/page.test.tsx
npx tsc --noEmit
npm run lint
```

Expected: PASS.

- [ ] **Step 6: 커밋**

```powershell
git add src/components/HardeningPendingCard.tsx src/app/hardening
git commit -m "feat: 선지 검토 페이지 추가"
```

### Task 7: AppNav 메뉴와 승인 대기 배지

**Files:**
- Modify: `src/components/AppNav.tsx`
- Create: `src/components/AppNav.test.tsx`

**Interfaces:**
- Consumes: `api.hardenJobs.pendingCount()`.
- Produces: "/hardening" nav 항목(라벨 "선지 검토") + 대기 건수 배지.

- [ ] **Step 1: 실패 테스트를 작성한다**

`src/components/AppNav.test.tsx` (신규):

```tsx
// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pendingCountMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/api-client", () => ({
  api: { hardenJobs: { pendingCount: pendingCountMock } },
}));

import AppNav from "./AppNav";

describe("AppNav", () => {
  beforeEach(() => {
    pendingCountMock.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("선지 검토 메뉴를 렌더한다", async () => {
    pendingCountMock.mockResolvedValue({ count: 0 });

    await act(async () => {
      render(<AppNav />);
    });

    expect(screen.getByRole("link", { name: "선지 검토" })).toHaveAttribute(
      "href",
      "/hardening",
    );
  });

  it("승인 대기가 있으면 배지를 보여준다", async () => {
    pendingCountMock.mockResolvedValue({ count: 3 });

    await act(async () => {
      render(<AppNav />);
    });

    expect(screen.getByText("3")).toBeVisible();
  });

  it("배지 조회 실패는 조용히 무시한다", async () => {
    pendingCountMock.mockRejectedValue(new Error("네트워크"));

    await act(async () => {
      render(<AppNav />);
    });

    expect(screen.getByRole("link", { name: /drillup/ })).toBeVisible();
  });
});
```

- [ ] **Step 2: 테스트 실패를 확인한다**

```powershell
npm test -- --run src/components/AppNav.test.tsx
```

Expected: FAIL — "선지 검토" 링크 부재.

- [ ] **Step 3: AppNav를 구현한다**

`src/components/AppNav.tsx`를 다음으로 교체한다:

```tsx
"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

type NavItem = {
  href: string;
  label: string;
  basePath: string;
  brand?: boolean;
};

const navItems: NavItem[] = [
  { href: "/", label: "drillup", basePath: "/", brand: true },
  { href: "/study?mode=srs", label: "학습", basePath: "/study" },
  { href: "/import", label: "가져오기", basePath: "/import" },
  { href: "/generate", label: "AI 생성", basePath: "/generate" },
  { href: "/questions", label: "문제 목록", basePath: "/questions" },
  { href: "/hardening", label: "선지 검토", basePath: "/hardening" },
  { href: "/keywords", label: "키워드", basePath: "/keywords" },
  { href: "/stats", label: "통계", basePath: "/stats" },
] as const;

function isActivePath(pathname: string, basePath: string): boolean {
  if (basePath === "/") {
    return pathname === "/";
  }

  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

export default function AppNav() {
  const pathname = usePathname();
  const [pendingCount, setPendingCount] = useState(0);

  useEffect(() => {
    let ignore = false;
    async function refresh() {
      try {
        const { count } = await api.hardenJobs.pendingCount();
        if (!ignore) setPendingCount(count);
      } catch {
        // 배지는 부가 정보 — 조회 실패는 조용히 무시한다
      }
    }
    void refresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      ignore = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [pathname]);

  return (
    <>
      {navItems.map((item) => {
        const active = isActivePath(pathname, item.basePath);
        const baseClass =
          "relative rounded-lg px-3 py-2 transition-colors duration-150 after:absolute after:inset-x-2 after:-bottom-[3px] after:h-px after:rounded-full after:transition-colors after:duration-150";
        const inactiveClass =
          "text-[color:var(--muted)] after:bg-transparent hover:bg-[color:var(--surface)] hover:text-[color:var(--text)]";
        const activeClass =
          "bg-[color:var(--brand-soft)] text-[color:var(--text)] after:bg-[color:var(--brand)]";
        const brandClass = item.brand ? "mr-3 font-bold" : "";

        return (
          <a
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`${baseClass} ${active ? activeClass : inactiveClass} ${brandClass}`}
          >
            {item.label}
            {item.basePath === "/hardening" && pendingCount > 0 && (
              <span className="ml-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-[color:var(--brand)] px-1.5 text-xs font-bold text-white">
                {pendingCount}
              </span>
            )}
          </a>
        );
      })}
    </>
  );
}
```

주의: 로그인 페이지에서도 AppNav가 렌더될 수 있다 — pendingCount 401 실패는 catch로 조용히 무시되고, api-client의 401 리다이렉트는 `/login` 경로에서 발동하지 않는다.

- [ ] **Step 4: 테스트 통과를 확인한다**

```powershell
npm test -- --run src/components/AppNav.test.tsx
npx tsc --noEmit
```

Expected: PASS.

- [ ] **Step 5: 커밋**

```powershell
git add src/components/AppNav.tsx src/components/AppNav.test.tsx
git commit -m "feat: 내비게이션에 선지 검토 메뉴와 대기 배지 추가"
```

### Task 8: 전체 검증과 배포

**Files:**
- 없음 (검증 전용; 수정이 나오면 해당 파일)

- [ ] **Step 1: 전체 검증을 실행한다**

```powershell
npm test
npx prisma validate
npx tsc --noEmit
npm run lint
npm run build
git diff --check
```

Expected: 모두 성공. 실패 시 원인을 고치고 `fix:` 커밋을 만든다.

- [ ] **Step 2: 원격 변동을 확인하고 push한다**

```powershell
git fetch origin
git status
git pull --rebase origin master
git push origin master
```

Expected: push 성공.

- [ ] **Step 3: GitHub Actions를 끝까지 확인한다**

```powershell
$RUN_ID = gh run list --branch master --json databaseId --jq '.[0].databaseId' --limit 1
gh run watch $RUN_ID --exit-status --interval 10
```

Expected: test와 deploy job 모두 success. 배포 후 원격 DB에는 CI의 `prisma migrate deploy`가 `auto_applied`/`dismissed_at` 컬럼을 적용한다.
