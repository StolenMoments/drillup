# Choice Hardening Rollback-Priority Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 원격 `d2d8621`의 오답-only 선지 강화 UX를 유지하면서 비동기 job, 동시성 fencing, 원자적 apply, 배포 drain, 복구 가능한 polling을 이식한다.

**Architecture:** 운영 DB에 이미 적용된 `choice_hardening_job` 테이블은 유지하되 `verify_engine`에는 생성 엔진을 그대로 저장하고 별도 검증 실행은 하지 않는다. API와 UI는 단일 엔진 계약을 사용하고, runner는 생성 한 단계만 fencing 조건으로 실행한다. 현재 잘못된 이력은 `d2d8621`을 기준으로 재구성하고 `force-with-lease`로 교체한다.

**Tech Stack:** Next.js 16.2.10 `after()`, React 19, Prisma 7.8, MariaDB, Vitest 4, Testing Library/jsdom, systemd user service

## Global Constraints

- 원격 `d2d8621`의 질문·정답 불변, 오답-only parser/prompt와 사실 검증 흐름을 유지한다.
- 별도 의미 검증 엔진, VERIFYING UI, 의미 보존 변형 문구를 노출하지 않는다.
- `.env`와 `generation_reference` untracked 문서를 커밋하지 않는다.
- 커밋 메시지는 English conventional type + 한국어 설명을 사용한다.
- push는 `git push --force-with-lease origin master`만 사용한다.

---

### Task 1: Master 이력 재구성과 job 저장 구조

**Files:**
- Create: `prisma/migrations/20260715000000_add_choice_hardening_job/migration.sql`
- Modify: `prisma/schema.prisma`
- Modify: `src/lib/api-types.ts`
- Create: `src/core/stable-json.ts`
- Test: `src/core/stable-json.test.ts`

**Interfaces:**
- Produces: `sha256Fingerprint(value: unknown): Promise<string>`
- Produces: `ChoiceHardeningJobDto` with `preview: HardenPreviewDto | null`

- [ ] **Step 1: 기준점과 복구점을 기록하고 master를 재구성한다**

```powershell
git rev-parse HEAD
$PLAN_COMMIT = git rev-parse HEAD
git reset --hard d2d8621
git cherry-pick 36d8de7 $PLAN_COMMIT
```

Expected: `git log`에서 `d2d8621` 다음에 설계/계획 커밋만 존재한다.

- [ ] **Step 2: fingerprint와 job schema 테스트를 먼저 복원한다**

```ts
expect(await sha256Fingerprint({ b: 2, a: 1 })).toBe(
  await sha256Fingerprint({ a: 1, b: 2 }),
);
```

- [ ] **Step 3: 운영에 적용된 migration과 Prisma schema를 동일한 내용으로 추가한다**

```prisma
@@unique([questionId, sourceHash, engine, verifyEngine], map: "ch_job_source_engine_key")
@@index([status, startedAt])
```

`verifyEngine`에는 API의 `engine`과 같은 값을 저장한다.

- [ ] **Step 4: 검증하고 커밋한다**

```powershell
npm test -- --run src/core/stable-json.test.ts
npx prisma validate
git commit -m "feat: 선지 강화 비동기 작업 저장 구조 추가"
```

### Task 2: 단일 엔진 비동기 runner와 원자적 apply

**Files:**
- Modify: `src/app/api/questions/[id]/harden-choices/route.ts`
- Create: `src/app/api/questions/[id]/harden-choices/[jobId]/route.ts`
- Create: `src/app/api/questions/[id]/harden-choices/[jobId]/apply/route.ts`
- Modify: `src/server/choice-hardening-service.ts`
- Create: `src/server/choice-hardening-runner.ts`
- Test: corresponding `*.test.ts` files

**Interfaces:**
- Produces: `startChoiceHardeningJob(questionId, engine, force): Promise<ChoiceHardeningJobDto>`
- Produces: `runChoiceHardeningJob(jobId): Promise<void>`
- Produces: `applyChoiceHardeningJob(questionId, jobId): Promise<void>`

- [ ] **Step 1: 실패 테스트를 작성한다**

```ts
expect(afterMock).toHaveBeenCalledOnce();
expect(runEngineMock).toHaveBeenCalledTimes(1);
expect(update.where).toMatchObject({ id: 11, attempt: 2, status: "RUNNING" });
```

stale 조건은 `startedAt < cutoff`와 `startedAt IS NULL AND createdAt < cutoff`를 모두 검증한다.

- [ ] **Step 2: 테스트 실패를 확인한다**

```powershell
npm test -- --run src/server/choice-hardening-service.test.ts src/server/choice-hardening-runner.test.ts
```

Expected: job API와 fencing 구현 부재로 FAIL.

- [ ] **Step 3: 생성 한 단계 runner를 구현한다**

```ts
const claimed = await prisma.choiceHardeningJob.updateMany({
  where: { id: jobId, status: "RUNNING", startedAt: null },
  data: { startedAt: claimedAt, stage: "GENERATING" },
});
```

`parseHardenJson`은 원격 버전을 사용하며 성공 preview에는 `engine`, `comment`, `factualConcern`, `payload`만 저장한다. 모든 terminal update는 `id + attempt + startedAt + RUNNING`으로 fencing한다.

- [ ] **Step 4: apply를 transaction 내부 row lock과 fingerprint 재검사로 구현한다**

```ts
await tx.$queryRaw`SELECT id FROM question WHERE id = ${questionId} FOR UPDATE`;
await tx.$queryRaw`SELECT id FROM choice_hardening_job WHERE id = ${jobId} FOR UPDATE`;
```

- [ ] **Step 5: 관련 테스트를 통과시키고 커밋한다**

```powershell
npm test -- --run src/app/api/questions/[id]/harden-choices/route.test.ts src/server/choice-hardening-service.test.ts src/server/choice-hardening-runner.test.ts
git commit -m "feat: 오답 선지 강화 작업 비동기 실행 안정화"
```

### Task 3: 원격 UX를 유지한 polling 복구

**Files:**
- Modify: `src/lib/api-client.ts`
- Modify: `src/components/ResultPanel.tsx`
- Create: `src/components/ResultPanel.test.tsx`
- Modify: `package.json`, `package-lock.json`, `vitest.config.ts`

**Interfaces:**
- Consumes: `startChoiceHardeningJob`의 단일 `engine` 계약
- Produces: `tracking` state with `pollError: string | null`

- [ ] **Step 1: 원격 UX 회귀 테스트와 polling 실패 테스트를 작성한다**

```ts
expect(screen.getByRole("button", { name: "Claude로 올리기" })).toBeVisible();
expect(screen.queryByText("의미 검증 엔진")).not.toBeInTheDocument();
expect(apiMock.getHardenChoices).toHaveBeenCalledWith(7, 11);
```

- [ ] **Step 2: 테스트 실패를 확인한다**

```powershell
npm test -- --run src/components/ResultPanel.test.tsx
```

- [ ] **Step 3: 단일 엔진 버튼, 5초 polling, visibility/pageshow, 비종결 네트워크 경고를 구현한다**

```ts
if (error instanceof ApiError && error.code === "NETWORK_ERROR") {
  return { ...current, pollError: userFacingError(error, "진행 상태 확인 실패") };
}
```

원격 `FactualConcernBanner`와 사실 교정 성공 메시지는 그대로 유지한다.

- [ ] **Step 4: 테스트 후 커밋한다**

```powershell
npm test -- --run src/components/ResultPanel.test.tsx src/lib/api-client.test.ts
git commit -m "fix: 오답 선지 강화 폴링 복구 개선"
```

### Task 4: 배포 drain과 최종 교체

**Files:**
- Modify: `scripts/drain-lib.mjs`, `scripts/drain-lib.test.ts`
- Modify: `scripts/wait-for-generation-drain.mjs`, `scripts/deploy-remote.sh`
- Modify: `deploy/drillup.service`

**Interfaces:**
- Produces: `activeJobsQuery(hasChoiceHardeningTable, cutoff)`

- [ ] **Step 1: migration 부재/존재 SQL과 64자 identifier 테스트를 작성한다**

```ts
expect(activeJobsQuery(false, cutoff).sql).not.toContain("choice_hardening_job");
expect(activeJobsQuery(true, cutoff).params).toHaveLength(4);
expect(overlongIdentifiers).toEqual([]);
```

- [ ] **Step 2: drain과 systemd 설정을 구현한다**

```ini
TimeoutStopSec=25min
```

- [ ] **Step 3: 전체 검증 후 커밋한다**

```powershell
npm test
npx prisma validate
npx tsc --noEmit
npm run lint
npm run build
git diff --check
git commit -m "fix: 선지 강화 작업 배포 드레인 안정화"
```

- [ ] **Step 4: 원격 변동을 확인하고 force-with-lease push한다**

```powershell
git fetch origin
git push --force-with-lease origin master
```

- [ ] **Step 5: GitHub Actions를 끝까지 확인한다**

```powershell
$RUN_ID = gh run list --branch master --json databaseId --jq '.[0].databaseId' --limit 1
gh run watch $RUN_ID --exit-status --interval 10
```

Expected: test와 deploy job 모두 success, 원격 systemd `active (running)`.
