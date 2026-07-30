# Common Job Unification Implementation Plan

> For agentic workers: REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Replace per-feature legacy Job tables with one fenced, retryable Job lifecycle while preserving every public Job URL and UI flow.

**Architecture:** Job owns lifecycle, target, execution token, retry lineage and run logs. Exactly one type-specific detail row owns feature data. Existing Route Handlers remain thin adapters and feature services use src/server/job-service.ts.

**Tech Stack:** Next.js 16.2 App Router, React 19, TypeScript strict, Prisma 7.8, MariaDB 11, zod 4, vitest 4, tsx.

## Global Constraints

- Work directly on master; do not create a feature branch or worktree.
- Follow docs/superpowers/plans/2026-07-07-drillup/00-overview.md and existing numbered plans.
- Before a Route Handler change read node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/route.md. Route Handler params are promises.
- Preserve existing API URLs, { job: ... } wrappers, Korean screen flow and light emoji feedback.
- All code uses PENDING -> RUNNING -> SUCCEEDED | FAILED. Retry always creates a new Job with retryOfJobId.
- src/core remains pure TS. Route Handlers stay thin. UI uses src/lib/api-client.ts rather than direct fetch.
- Production writes are permitted only below one __drillup_job_it__<runId> Topic and require the explicit opt-in and DB confirmation.
- Do not commit .env, database snapshot, generated integration ledger/report/output, or the pre-existing untracked docs/superpowers/plans/2026-07-15-question-list-search.md and generation_reference/aip-c01/common/aip-c01_service_mapping_question_generation_kb.md.
- Use explicit git add paths, never git add -A. Make one Korean conventional commit per task.

## File map

| Area | Exact files | Responsibility |
| --- | --- | --- |
| Schema/data | prisma/schema.prisma; migrations/20260730090000_add_common_job_schema/migration.sql; migrations/20260730091000_backfill_common_jobs/migration.sql; scripts/verify-common-job-backfill.sql | Parallel schema, deterministic copy, integrity proof |
| Lifecycle | src/server/job-dto.ts; src/server/job-service.ts; src/server/job-service.test.ts; src/server/job-runner.ts; src/server/job-runner.test.ts | target validation, claim/fence/heartbeat/terminal/retry/log |
| Production integration | scripts/jobs-it-prod.ts; scripts/jobs-it-prod.test.ts; scripts/jobs-it-cleanup.ts; package.json; .gitignore | safe opt-in end-to-end test and exact cleanup |

---

### Task 2: Extend schema and backfill legacy jobs

**Files:**

- Modify: prisma/schema.prisma
- Create: prisma/migrations/20260730090000_add_common_job_schema/migration.sql
- Create: prisma/migrations/20260730091000_backfill_common_jobs/migration.sql
- Create: scripts/verify-common-job-backfill.sql
- Create: scripts/job-migration-contract.test.ts

**Produces:** Prisma Job, six JobData models, JobRunLog, JobType, JobStatus, target CHECK constraints and indexes from the design.

- [ ] Step 1: Write failing contract tests that read schema/migration text and require all six types, PENDING status, topic/question/parent targets, retryOfJobId/runToken/heartbeatAt, six jobId primary-key details, JobRunLog cascade and type-target CHECK. Require the fixed prefix-sum range allocator: Generation IDs unchanged, then ChoiceHardeningJob, NoteTidyJob, AnswerExplanationJob and GenerationItemRevision ranges computed from prior upper bound plus COALESCE(MAX(id), 0) for every legacy source table. Require signed Int overflow SIGNAL, no overlap, and source-ID reverse mapping. Add fixtures for preserved generation ID, collision-prone Choice ID 2/Note ID 1, each source table empty in turn with later bounds still numeric, exactly four legacy GenerationRunLog RUNNING rows, and exactly 63 legacy AnswerExplanation rows.
- [ ] Step 2: Run npx vitest run scripts/job-migration-contract.test.ts. Expected: common Job schema contract is absent.
- [ ] Step 3: Add only additive Prisma models and Topic/Question reverse relations. Index status+heartbeat, topic+type+status, question+type+status, parent, retry and job-log start time. Do not remove a legacy model/enum.
- [ ] Step 4: Write the extension migration. Add enum/table/FK/CHECK/index objects only. Set Job AUTO_INCREMENT after calculating an upper bound for deterministic mapped IDs.
- [ ] Step 5: Write idempotent backfill SQL. Read MAX(id) as COALESCE(MAX(id), 0) for GenerationJob, ChoiceHardeningJob, NoteTidyJob, AnswerExplanationJob, and GenerationItemRevision before calculating any bound. Preserve GenerationJob IDs; allocate the four non-generation source ranges with previousUpperBound + legacyId; assert revisionUpper is at most 2,147,483,647; copy details and GenerationRunLog; store non-null rawOutput in LEGACY_OUTPUT logs. An assertion procedure must fail the migration unless source GenerationRunLog RUNNING count is exactly 4 and source AnswerExplanation count is exactly 63. Close those four copied RUNNING logs as FAILED with stale-run reason. Materialize all 63 caches as hash-bearing SUCCEEDED Job/details and fail if the inserted count is not 63.
- [ ] Step 6: Write validation SQL. Each query returns zero bad rows for per-type count mismatch, missing/multiple detail, invalid target, dangling FK, generation-ID mismatch, range collision/reverse-mapping mismatch, terminal timestamp inconsistency, RUNNING log below terminal Job, and cache without valid hash/detail. Add expected-count assertions that fail unless source RUNNING log count is 4, exactly 4 corresponding common logs are FAILED, source cache count is 63, and exactly 63 matching valid explanation Job/details exist.
- [ ] Step 7: Verify and commit.

    npx vitest run scripts/job-migration-contract.test.ts
    npx prisma validate
    npx prisma generate
    git add prisma/schema.prisma prisma/migrations/20260730090000_add_common_job_schema/migration.sql prisma/migrations/20260730091000_backfill_common_jobs/migration.sql scripts/job-migration-contract.test.ts scripts/verify-common-job-backfill.sql
    git commit -m "feat: 공통 Job 스키마와 이관 기반 추가"

### Task 3: Implement shared lifecycle, fencing and logging

**Files:**

- Create: src/server/job-dto.ts
- Create: src/server/job-service.ts
- Create: src/server/job-service.test.ts
- Create: src/server/job-runner.ts
- Create: src/server/job-runner.test.ts
- Modify: src/lib/api-types.ts

**Consumes:** Task 2 Prisma client.

**Produces:** createPendingJob, claimJob, heartbeatJob, completeJob, failJob, recoverStaleJobs, retryJob, writeJobRunLog and JobDtoBase.

- [ ] Step 1: Add failing unit tests for type/target rejection, atomic PENDING+detail creation, exactly-one claim, foreign token heartbeat/finish rejection, detail-save failure ending FAILED, log persistence failure not changing result, stale recovery fencing and new-ID retry lineage.
- [ ] Step 2: Run npx vitest run src/server/job-service.test.ts src/server/job-runner.test.ts. Expected: missing lifecycle modules.
- [ ] Step 3: Implement JobDtoBase with id/type/status/engine/target/retry/error and all timestamps. Never expose runToken over HTTP.
- [ ] Step 4: Implement transaction lifecycle. Claim only PENDING with a UUID token, heartbeat every 30 seconds, use token predicates for all terminal updates, save detailed result and SUCCEEDED together, and fenced-fail when result persistence throws.
- [ ] Step 5: Implement stale recovery at 2 * generationTimeoutMs() + 60,000ms, closing child RUNNING logs and clearing old token. Make JobRunLog writes best-effort only.
- [ ] Step 6: Verify and commit.

    npx vitest run src/server/job-service.test.ts src/server/job-runner.test.ts
    npx tsc --noEmit
    git add src/server/job-dto.ts src/server/job-service.ts src/server/job-service.test.ts src/server/job-runner.ts src/server/job-runner.test.ts src/lib/api-types.ts
    git commit -m "feat: 공통 Job 생명주기와 실행 로그 통합"

### Task 4: Convert generation, keyword tagging and item revision

**Files:**

- Modify: src/server/generation/generation-service.ts and generation-service.test.ts
- Modify: src/server/generation/tracked-run.ts and tracked-run.test.ts
- Modify: src/server/generation/generation-diagnostics-service.ts
- Modify: src/app/api/generate/route.ts
- Modify: src/app/api/generate/[id]/route.ts
- Modify: src/app/api/generate/[id]/approve/route.ts
- Modify: src/app/api/generate/[id]/diagnostics/route.ts
- Modify: src/app/api/generate/[id]/items/[index]/revision/route.ts
- Modify: src/app/api/generate/keyword-tag/route.ts
- Modify: src/lib/api-types.ts, src/lib/api-client.ts, src/lib/generation-ux.ts, src/lib/generation-ux.test.ts, src/lib/generation-retry.ts, src/lib/generation-retry.test.ts
- Modify: src/app/generate/page.tsx, src/app/generate/new/page.tsx, src/app/generate/[id]/page.tsx, src/components/GenerationActionDock.tsx, src/components/GenerationDiagnostics.tsx

**Produces:** Existing generate routes retain { job }. GenerationJobDto.kind becomes type and stage is separate. Revision POST creates a GENERATION_ITEM_REVISION child Job; PATCH sets selectedAt.

- [ ] Step 1: Add failing tests proving same-Topic question generation/keyword tagging exclusion, existing route/wrapper compatibility, type replacing kind, new retry ID/retryOfJobId, and second item revision preserving first history.
- [ ] Step 2: Run the listed generation tests and confirm legacy DTO/lifecycle assertions fail.
- [ ] Step 3: Refactor service/tracked runner to create, claim, heartbeat and complete common Jobs; store stage/detail data; use JobRunLog; write output only at generation_output/jobs/{jobId}.
- [ ] Step 4: Refactor all generate Route Handlers to await params, preserve zod and { job }, and schedule only newly PENDING Job IDs. Keep diagnostics lazy-loaded.
- [ ] Step 5: Update api-client and UI to poll global IDs, read type/stage, and retain Korean/emoji copy.
- [ ] Step 6: Verify and commit.

    npx vitest run src/server/generation/generation-service.test.ts src/server/generation/tracked-run.test.ts src/lib/generation-ux.test.ts src/lib/generation-retry.test.ts
    npx tsc --noEmit
    git add src/server/generation/generation-service.ts src/server/generation/generation-service.test.ts src/server/generation/tracked-run.ts src/server/generation/tracked-run.test.ts src/server/generation/generation-diagnostics-service.ts src/app/api/generate/route.ts src/app/api/generate/[id]/route.ts src/app/api/generate/[id]/approve/route.ts src/app/api/generate/[id]/diagnostics/route.ts src/app/api/generate/[id]/items/[index]/revision/route.ts src/app/api/generate/keyword-tag/route.ts src/lib/api-types.ts src/lib/api-client.ts src/lib/generation-ux.ts src/lib/generation-ux.test.ts src/lib/generation-retry.ts src/lib/generation-retry.test.ts src/app/generate/page.tsx src/app/generate/new/page.tsx src/app/generate/[id]/page.tsx src/components/GenerationActionDock.tsx src/components/GenerationDiagnostics.tsx
    git commit -m "refactor: 생성 작업을 공통 Job 구조로 전환"

### Task 5: Convert choice hardening

**Files:**

- Modify: src/server/choice-hardening-service.ts, choice-hardening-service.test.ts, choice-hardening-runner.ts, choice-hardening-runner.test.ts
- Modify: src/app/api/questions/[id]/harden-choices/route.ts and route.test.ts
- Modify: src/app/api/questions/[id]/harden-choices/[jobId]/route.ts and route.test.ts
- Modify: src/app/api/questions/[id]/harden-choices/[jobId]/apply/route.ts and route.test.ts
- Modify: src/app/api/questions/[id]/harden-choices/[jobId]/dismiss/route.ts and route.test.ts
- Modify: src/app/api/harden-jobs/route.ts, route.test.ts, pending-count/route.ts
- Modify: src/lib/api-types.ts, src/lib/api-client.ts, src/components/ResultPanel.tsx, src/components/ResultPanel.test.tsx, src/components/HardeningJobList.tsx, src/components/HardeningPendingCard.tsx, src/app/hardening/page.tsx, src/app/hardening/page.test.tsx, src/app/hardening/[status]/HardeningStatusPage.tsx, src/app/hardening/[status]/HardeningStatusPage.test.tsx, src/app/hardening/[status]/page.tsx, src/app/hardening/[status]/page.test.tsx

- [ ] Step 1: Write failing tests for Question lock, active Job reuse, force/new retry IDs, no public attempt, automatic/manual apply, dismiss idempotency and explanation invalidation rather than deletion.
- [ ] Step 2: Convert service/runner to common claim/token/heartbeat/log APIs. Store source hash/preview in ChoiceHardeningJobData; never reset a completed row.
- [ ] Step 3: Convert routes/client/UI without changing URL/wrapper. List/count joins common Job+detail and polling uses global IDs.
- [ ] Step 4: Verify and commit.

    npx vitest run src/server/choice-hardening-service.test.ts src/server/choice-hardening-runner.test.ts src/app/api/harden-jobs/route.test.ts src/app/api/questions/[id]/harden-choices/route.test.ts src/app/api/questions/[id]/harden-choices/[jobId]/route.test.ts src/app/api/questions/[id]/harden-choices/[jobId]/apply/route.test.ts src/app/api/questions/[id]/harden-choices/[jobId]/dismiss/route.test.ts src/components/ResultPanel.test.tsx src/app/hardening/page.test.tsx src/app/hardening/[status]/HardeningStatusPage.test.tsx src/app/hardening/[status]/page.test.tsx
    git add src/server/choice-hardening-service.ts src/server/choice-hardening-service.test.ts src/server/choice-hardening-runner.ts src/server/choice-hardening-runner.test.ts src/app/api/questions/[id]/harden-choices/route.ts src/app/api/questions/[id]/harden-choices/route.test.ts src/app/api/questions/[id]/harden-choices/[jobId]/route.ts src/app/api/questions/[id]/harden-choices/[jobId]/route.test.ts src/app/api/questions/[id]/harden-choices/[jobId]/apply/route.ts src/app/api/questions/[id]/harden-choices/[jobId]/apply/route.test.ts src/app/api/questions/[id]/harden-choices/[jobId]/dismiss/route.ts src/app/api/questions/[id]/harden-choices/[jobId]/dismiss/route.test.ts src/app/api/harden-jobs/route.ts src/app/api/harden-jobs/route.test.ts src/app/api/harden-jobs/pending-count/route.ts src/lib/api-types.ts src/lib/api-client.ts src/components/ResultPanel.tsx src/components/ResultPanel.test.tsx src/components/HardeningJobList.tsx src/components/HardeningPendingCard.tsx src/app/hardening/page.tsx src/app/hardening/page.test.tsx src/app/hardening/[status]/HardeningStatusPage.tsx src/app/hardening/[status]/HardeningStatusPage.test.tsx src/app/hardening/[status]/page.tsx src/app/hardening/[status]/page.test.tsx
    git commit -m "refactor: 선지 강화 작업을 공통 Job 구조로 전환"

### Task 6: Convert note tidy

**Files:**

- Modify: src/server/note-service.ts, note-service.test.ts, note-tidy-runner.ts, note-tidy-runner.test.ts
- Modify: src/app/api/topics/[id]/note/route.ts, src/app/api/topics/[id]/note/tidy/route.ts
- Modify: src/app/api/note-tidy-jobs/[id]/route.ts, apply/route.ts, dismiss/route.ts
- Modify: src/lib/api-types.ts, src/lib/api-client.ts, src/components/NotePanel.tsx, src/components/NotePanel.test.tsx

- [ ] Step 1: Add failing tests for source hash at start/apply, active draft reuse, new retry lineage, apply/dismiss rules and panel re-entry polling of global Job ID.
- [ ] Step 2: Implement common Job/detail reads and writes. Lock Topic/TopicNote for creation/apply; preserve source hash/preview; schedule only new PENDING Jobs.
- [ ] Step 3: Update routes/client/panel while retaining URLs/wrappers and using after() for scheduling only.
- [ ] Step 4: Verify and commit.

    npx vitest run src/server/note-service.test.ts src/server/note-tidy-runner.test.ts src/components/NotePanel.test.tsx
    git add src/server/note-service.ts src/server/note-service.test.ts src/server/note-tidy-runner.ts src/server/note-tidy-runner.test.ts src/app/api/topics/[id]/note/route.ts src/app/api/topics/[id]/note/tidy/route.ts src/app/api/note-tidy-jobs/[id]/route.ts src/app/api/note-tidy-jobs/[id]/apply/route.ts src/app/api/note-tidy-jobs/[id]/dismiss/route.ts src/lib/api-types.ts src/lib/api-client.ts src/components/NotePanel.tsx src/components/NotePanel.test.tsx
    git commit -m "refactor: 노트 정리 작업을 공통 Job 구조로 전환"

### Task 7: Convert answer explanation and cache invalidation

**Files:**

- Modify: src/server/explanation-job-service.ts, explanation-job-service.test.ts, explanation-job-runner.ts, explanation-job-runner.test.ts, explanation-service.ts
- Modify: src/server/question-service.ts
- Modify: src/app/api/questions/[id]/route.ts, src/app/api/questions/[id]/explain/route.ts, src/app/api/questions/[id]/explain/[jobId]/route.ts
- Modify: src/lib/api-types.ts, src/lib/api-client.ts, src/components/ResultPanel.tsx, src/components/ResultPanel.test.tsx

- [ ] Step 1: Add failing tests for valid source-hash cache hit returning a real SUCCEEDED Job, invalidated cache creating a retry Job, no id: 0, active reuse, token fencing, and Question PATCH/choice apply recording invalidatedAt rather than deleting rows.
- [ ] Step 2: Persist cache/result/source hash/invalidation on AnswerExplanationJobData and use common Job logs and terminal transaction rules.
- [ ] Step 3: Update Question mutation, routes and client without changing URL/wrapper. Route params remain awaited and after() runs only new PENDING Jobs.
- [ ] Step 4: Update ResultPanel polling of real global IDs and preserve Korean/emoji feedback.
- [ ] Step 5: Verify and commit.

    npx vitest run src/server/explanation-job-service.test.ts src/server/explanation-job-runner.test.ts src/components/ResultPanel.test.tsx src/app/api/questions/[id]/harden-choices/[jobId]/apply/route.test.ts
    git add src/server/explanation-job-service.ts src/server/explanation-job-service.test.ts src/server/explanation-job-runner.ts src/server/explanation-job-runner.test.ts src/server/explanation-service.ts src/server/question-service.ts src/app/api/questions/[id]/route.ts src/app/api/questions/[id]/explain/route.ts src/app/api/questions/[id]/explain/[jobId]/route.ts src/lib/api-types.ts src/lib/api-client.ts src/components/ResultPanel.tsx src/components/ResultPanel.test.tsx
    git commit -m "refactor: 해설 생성과 캐시를 공통 Job 구조로 전환"

### Task 8: Add production DB integration-test harness

**Files:**

- Create: scripts/jobs-it-prod.ts
- Create: scripts/jobs-it-prod.test.ts
- Create: scripts/jobs-it-cleanup.ts
- Modify: package.json
- Modify: .gitignore

**Produces:** npm run jobs:it:prod -- --confirm-db <DB_NAME> and npm run jobs:it:cleanup -- --confirm-db <DB_NAME>. Both reject unsafe execution before a production write.

- [ ] Step 1: Write failing mocked tests for each gate, ledger before first write, exact-ID cleanup, finally cleanup after failure, exact output deletion, polling/timeouts, one retry only and report redaction.
- [ ] Step 2: Implement preflight. Require JOB_IT_ALLOW_PRODUCTION_WRITE=YES_I_UNDERSTAND, matching --confirm-db/DB_NAME, contract migration, zero active non-test Job and zero old test Topic. Ledger/report cannot contain secret, cookie, prompt or AI output.
- [ ] Step 3: Implement authenticated HTTP + Prisma scenario. Create only __drillup_job_it__<runId> Topic/seed MCQ/note; poll at 3 seconds; verify Antigravity generation/revision/select/approve, keyword tagging/approve, hardening/apply, tidy/source-hash guard, explanation/cache/invalidation; run one completed/logged/applied Claude and Codex tidy smoke each.
- [ ] Step 4: Implement retry/cleanup. First AI failure retries once with new Job and retryOfJobId; second fails run. finally deletes only ledger Topic ID, proves cascade zero and non-test counts unchanged, permits AUTO_INCREMENT gap, then deletes only ledger Job output directories.
- [ ] Step 5: Add package scripts using tsx and keep generated output ignored.
- [ ] Step 6: Verify and commit.

    npx vitest run scripts/jobs-it-prod.test.ts
    npm run jobs:it:prod -- --help
    npm run jobs:it:cleanup -- --help
    git add scripts/jobs-it-prod.ts scripts/jobs-it-prod.test.ts scripts/jobs-it-cleanup.ts package.json .gitignore
    git commit -m "test: 운영 DB Job 통합테스트 하네스 추가"

### Task 9: Remove legacy schema and final verification

**Files:**

- Modify: prisma/schema.prisma, scripts/verify-common-job-backfill.sql, src/lib/api-types.ts, src/lib/api-client.ts
- Modify: src/server/generation/generation-service.ts, src/server/generation/generation-service.test.ts, src/server/generation/tracked-run.ts, src/server/generation/tracked-run.test.ts, src/server/generation/generation-diagnostics-service.ts
- Modify: src/server/choice-hardening-service.ts, src/server/choice-hardening-service.test.ts, src/server/choice-hardening-runner.ts, src/server/choice-hardening-runner.test.ts
- Modify: src/server/note-service.ts, src/server/note-service.test.ts, src/server/note-tidy-runner.ts, src/server/note-tidy-runner.test.ts
- Modify: src/server/explanation-job-service.ts, src/server/explanation-job-service.test.ts, src/server/explanation-job-runner.ts, src/server/explanation-job-runner.test.ts, src/server/explanation-service.ts, src/server/question-service.ts
- Modify: src/app/api/generate/route.ts, src/app/api/generate/[id]/route.ts, src/app/api/generate/[id]/approve/route.ts, src/app/api/generate/[id]/diagnostics/route.ts, src/app/api/generate/[id]/items/[index]/revision/route.ts, src/app/api/generate/keyword-tag/route.ts
- Modify: src/app/api/harden-jobs/route.ts, src/app/api/harden-jobs/route.test.ts, src/app/api/harden-jobs/pending-count/route.ts, src/app/api/questions/[id]/harden-choices/route.ts, src/app/api/questions/[id]/harden-choices/route.test.ts, src/app/api/questions/[id]/harden-choices/[jobId]/route.ts, src/app/api/questions/[id]/harden-choices/[jobId]/route.test.ts, src/app/api/questions/[id]/harden-choices/[jobId]/apply/route.ts, src/app/api/questions/[id]/harden-choices/[jobId]/apply/route.test.ts, src/app/api/questions/[id]/harden-choices/[jobId]/dismiss/route.ts, src/app/api/questions/[id]/harden-choices/[jobId]/dismiss/route.test.ts
- Modify: src/app/api/topics/[id]/note/route.ts, src/app/api/topics/[id]/note/tidy/route.ts, src/app/api/note-tidy-jobs/[id]/route.ts, src/app/api/note-tidy-jobs/[id]/apply/route.ts, src/app/api/note-tidy-jobs/[id]/dismiss/route.ts, src/app/api/questions/[id]/route.ts, src/app/api/questions/[id]/explain/route.ts, src/app/api/questions/[id]/explain/[jobId]/route.ts
- Modify: src/app/generate/page.tsx, src/app/generate/new/page.tsx, src/app/generate/[id]/page.tsx, src/app/hardening/page.tsx, src/app/hardening/page.test.tsx, src/app/hardening/[status]/HardeningStatusPage.tsx, src/app/hardening/[status]/HardeningStatusPage.test.tsx, src/app/hardening/[status]/page.tsx, src/app/hardening/[status]/page.test.tsx
- Modify: src/components/GenerationActionDock.tsx, src/components/GenerationDiagnostics.tsx, src/components/HardeningJobList.tsx, src/components/HardeningPendingCard.tsx, src/components/NotePanel.tsx, src/components/NotePanel.test.tsx, src/components/ResultPanel.tsx, src/components/ResultPanel.test.tsx, src/lib/generation-ux.ts, src/lib/generation-ux.test.ts, src/lib/generation-retry.ts, src/lib/generation-retry.test.ts
- Create: prisma/migrations/20260730170000_remove_legacy_job_schema/migration.sql

- [ ] Step 1: Search src, scripts and prisma for GenerationJob, GenerationRunLog, GenerationItemRevision, ChoiceHardeningJob, NoteTidyJob, AnswerExplanationJob, AnswerExplanation and all former dedicated status/stage enums. Replace production references with common names before removal.
- [ ] Step 2: Run backfill verification SQL on rehearsal DB after migration deploy. It must return zero bad rows before a drop migration is applied.
- [ ] Step 3: Drop legacy FKs/tables/enums only after proof. Keep Topic, Question, TopicNote, Keyword, QuestionKeyword, ReviewLog and all common Job tables. Standardize outputs at generation_output/jobs/{jobId}.
- [ ] Step 4: Regenerate Prisma, rerun search and require zero legacy production references. Run the Task 4, 5, 6 and 7 test lists plus the migration contract test before the complete suite.
- [ ] Step 5: Verify and commit.

    npx prisma validate
    npx prisma generate
    npx vitest run scripts/job-migration-contract.test.ts src/server/job-service.test.ts src/server/job-runner.test.ts src/server/generation/generation-service.test.ts src/server/generation/tracked-run.test.ts src/lib/generation-ux.test.ts src/lib/generation-retry.test.ts src/server/choice-hardening-service.test.ts src/server/choice-hardening-runner.test.ts src/app/api/harden-jobs/route.test.ts src/app/api/questions/[id]/harden-choices/route.test.ts src/app/api/questions/[id]/harden-choices/[jobId]/route.test.ts src/app/api/questions/[id]/harden-choices/[jobId]/apply/route.test.ts src/app/api/questions/[id]/harden-choices/[jobId]/dismiss/route.test.ts src/components/ResultPanel.test.tsx src/app/hardening/page.test.tsx src/app/hardening/[status]/HardeningStatusPage.test.tsx src/app/hardening/[status]/page.test.tsx src/server/note-service.test.ts src/server/note-tidy-runner.test.ts src/components/NotePanel.test.tsx src/server/explanation-job-service.test.ts src/server/explanation-job-runner.test.ts
    npm test
    npx tsc --noEmit
    npm run lint
    npm run build
    git add prisma/schema.prisma prisma/migrations/20260730170000_remove_legacy_job_schema/migration.sql scripts/verify-common-job-backfill.sql src/lib/api-types.ts src/lib/api-client.ts src/lib/generation-ux.ts src/lib/generation-ux.test.ts src/lib/generation-retry.ts src/lib/generation-retry.test.ts src/server/generation/generation-service.ts src/server/generation/generation-service.test.ts src/server/generation/tracked-run.ts src/server/generation/tracked-run.test.ts src/server/generation/generation-diagnostics-service.ts src/server/choice-hardening-service.ts src/server/choice-hardening-service.test.ts src/server/choice-hardening-runner.ts src/server/choice-hardening-runner.test.ts src/server/note-service.ts src/server/note-service.test.ts src/server/note-tidy-runner.ts src/server/note-tidy-runner.test.ts src/server/explanation-job-service.ts src/server/explanation-job-service.test.ts src/server/explanation-job-runner.ts src/server/explanation-job-runner.test.ts src/server/explanation-service.ts src/server/question-service.ts src/app/api/generate/route.ts src/app/api/generate/[id]/route.ts src/app/api/generate/[id]/approve/route.ts src/app/api/generate/[id]/diagnostics/route.ts src/app/api/generate/[id]/items/[index]/revision/route.ts src/app/api/generate/keyword-tag/route.ts src/app/api/harden-jobs/route.ts src/app/api/harden-jobs/route.test.ts src/app/api/harden-jobs/pending-count/route.ts src/app/api/questions/[id]/harden-choices/route.ts src/app/api/questions/[id]/harden-choices/route.test.ts src/app/api/questions/[id]/harden-choices/[jobId]/route.ts src/app/api/questions/[id]/harden-choices/[jobId]/route.test.ts src/app/api/questions/[id]/harden-choices/[jobId]/apply/route.ts src/app/api/questions/[id]/harden-choices/[jobId]/apply/route.test.ts src/app/api/questions/[id]/harden-choices/[jobId]/dismiss/route.ts src/app/api/questions/[id]/harden-choices/[jobId]/dismiss/route.test.ts src/app/api/topics/[id]/note/route.ts src/app/api/topics/[id]/note/tidy/route.ts src/app/api/note-tidy-jobs/[id]/route.ts src/app/api/note-tidy-jobs/[id]/apply/route.ts src/app/api/note-tidy-jobs/[id]/dismiss/route.ts src/app/api/questions/[id]/route.ts src/app/api/questions/[id]/explain/route.ts src/app/api/questions/[id]/explain/[jobId]/route.ts src/app/generate/page.tsx src/app/generate/new/page.tsx src/app/generate/[id]/page.tsx src/app/hardening/page.tsx src/app/hardening/page.test.tsx src/app/hardening/[status]/HardeningStatusPage.tsx src/app/hardening/[status]/HardeningStatusPage.test.tsx src/app/hardening/[status]/page.tsx src/app/hardening/[status]/page.test.tsx src/components/GenerationActionDock.tsx src/components/GenerationDiagnostics.tsx src/components/HardeningJobList.tsx src/components/HardeningPendingCard.tsx src/components/NotePanel.tsx src/components/NotePanel.test.tsx src/components/ResultPanel.tsx src/components/ResultPanel.test.tsx
    git commit -m "chore: 구 Job 스키마 제거와 이관 검증 완료"

## Deployment gate

Before the production migration, confirm managed snapshot creation/restoration, stop the app and verify active legacy Jobs are zero. Rehearse prisma migrate deploy plus backfill SQL on a clone. After migration verify per-type counts, one detail per Job, target constraints, zero orphan FKs, terminal result/timestamp consistency and zero RUNNING logs below terminal Jobs. If integrity validation fails, do not restart the app: forward-fix code defects, but restore snapshot and redeploy the previous commit for schema/data damage.
