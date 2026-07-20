# 주제별 학습 노트 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 풀이 화면에서 주제별 마크다운 노트를 직접 작성·열람하고, AI 정리 버튼으로 중복 제거·재구성한 초안을 비교 후 반영한다.

**Architecture:** 스펙 `docs/superpowers/specs/2026-07-20-topic-note-design.md` 기반. `topic_note`(주제당 1행) + `note_tidy_job`(AI 정리 잡, ChoiceHardeningJob 패턴 축소판) 테이블 추가. 프롬프트 빌더·결과 파서는 `src/core/`(순수 TS, vitest), 서비스는 `src/server/note-service.ts`, 잡 실행은 `src/server/note-tidy-runner.ts`가 기존 `runEngine` 재사용. Route Handler는 얇게, 프론트는 api-client 경유. UI는 학습 화면 바텀 시트 패널.

**Tech Stack:** Next.js 16 (App Router), Prisma + MariaDB, zod v4, vitest, react-markdown + remark-gfm (신규 의존성)

## Global Constraints

- **작업 시작 전 `git pull`.** feature 브랜치 만들지 말고 `master`에서 직접 작업.
- **Next.js는 훈련 데이터와 다를 수 있음** — Route Handler·서버 API 작성 전 `node_modules/next/dist/docs/`의 해당 가이드 확인. (기존 라우트 패턴: `params`는 `Promise`, 응답 후 백그라운드 작업은 `next/server`의 `after` 사용 — `src/app/api/questions/[id]/harden-choices/route.ts` 참고)
- **TypeScript strict, `any` 금지** — payload 캐스팅은 `as unknown as T`만 허용.
- **`src/core/`는 순수 TS** (zod만 허용). **`src/server/`는 Next.js import 금지** (예외: http.ts).
- **Route Handler는 얇게**: zod 파싱 → 서비스 호출 → JSON 응답.
- **화면 코드는 fetch 직접 호출 금지** — `src/lib/api-client.ts`의 `api` 객체만 사용.
- **UI 문구는 한국어**, 피드백 문구에 이모지 유지 (✅/❌ 등).
- **API 오류 응답**: `{ "error": { "code": string, "message": string } }`.
- **커밋 메시지는 한국어** + conventional commit 접두사(`feat:` 등). 태스크마다 커밋 1개.
- **테스트는 vitest**, 대상 파일 옆 `*.test.ts`. core만 자동 테스트, 서비스 계층은 curl 수동 검증.
- 검증 명령의 `curl`은 PowerShell에서 반드시 `curl.exe`.

## 파일 구조 (이 플랜에서 생성/수정)

```
prisma/schema.prisma                             # 수정: TopicNote, NoteTidyJob, enum
src/core/note-tidy-prompt.ts                     # 생성: buildNoteTidyPrompt
src/core/note-tidy-prompt.test.ts                # 생성
src/core/note-tidy-result.ts                     # 생성: parseNoteTidyResult
src/core/note-tidy-result.test.ts                # 생성
src/server/note-service.ts                       # 생성: 노트 CRUD + 잡 시작/조회/반영/폐기
src/server/note-tidy-runner.ts                   # 생성: 잡 실행 (runEngine 재사용)
src/app/api/topics/[id]/note/route.ts            # 생성: GET/PUT
src/app/api/topics/[id]/note/tidy/route.ts       # 생성: POST
src/app/api/note-tidy-jobs/[id]/route.ts         # 생성: GET
src/app/api/note-tidy-jobs/[id]/apply/route.ts   # 생성: POST
src/app/api/note-tidy-jobs/[id]/dismiss/route.ts # 생성: POST
src/lib/api-types.ts                             # 수정: TopicNoteDto, NoteTidyJobDto, StudyQuestionDto.topicId
src/lib/api-client.ts                            # 수정: api.notes.*
src/server/study-service.ts                      # 수정: StudyQuestionDto에 topicId 포함
src/components/NotePanel.tsx                     # 생성: 바텀 시트 노트 패널
src/app/study/page.tsx                           # 수정: 노트 버튼 + 패널 연결
src/app/globals.css                              # 수정: .note-markdown 스타일 추가
```

---

### Task 1: DB 스키마 — TopicNote, NoteTidyJob

**Files:**
- Modify: `prisma/schema.prisma`

**Interfaces:**
- Consumes: 기존 `GenerationEngine` enum, `Topic` 모델
- Produces: Prisma 모델 `TopicNote { id, topicId, content, createdAt, updatedAt }`, `NoteTidyJob { id, topicId, sourceHash, engine, status, preview, errorMessage, createdAt, startedAt, finishedAt, appliedAt, dismissedAt }`, enum `NoteTidyJobStatus`

참고: 스펙 §3 표에는 `started_at`/`applied_at`/`dismissed_at`이 없지만, 스펙 §4의 "반영/폐기되지 않은 잡" 판정과 §5의 ChoiceHardeningJob apply/dismiss 흐름을 구현하려면 필요하다 (스펙 의미의 구현 세부). `content`/`preview`는 한국어 장문 대비 `MEDIUMTEXT` 사용.

- [ ] **Step 1: schema.prisma에 enum과 모델 추가**

`ChoiceHardeningJobStage` enum 선언 아래에 추가:

```prisma
enum NoteTidyJobStatus {
  RUNNING
  SUCCEEDED
  FAILED
}
```

`Topic` 모델의 관계 필드에 두 줄 추가 (`generationJobs GenerationJob[]` 아래):

```prisma
  note           TopicNote?
  noteTidyJobs   NoteTidyJob[]
```

파일 끝(`QuestionKeyword` 모델 아래)에 모델 두 개 추가:

```prisma
model TopicNote {
  id        Int      @id @default(autoincrement())
  topicId   Int      @unique @map("topic_id")
  content   String   @db.MediumText
  createdAt DateTime @default(now()) @map("created_at")
  updatedAt DateTime @updatedAt @map("updated_at")
  topic     Topic    @relation(fields: [topicId], references: [id], onDelete: Cascade)

  @@map("topic_note")
}

model NoteTidyJob {
  id           Int               @id @default(autoincrement())
  topicId      Int               @map("topic_id")
  sourceHash   String            @map("source_hash") @db.Char(64)
  engine       GenerationEngine
  status       NoteTidyJobStatus @default(RUNNING)
  preview      String?           @db.MediumText
  errorMessage String?           @map("error_message") @db.Text
  createdAt    DateTime          @default(now()) @map("created_at")
  startedAt    DateTime?         @map("started_at")
  finishedAt   DateTime?         @map("finished_at")
  appliedAt    DateTime?         @map("applied_at")
  dismissedAt  DateTime?         @map("dismissed_at")
  topic        Topic             @relation(fields: [topicId], references: [id], onDelete: Cascade)

  @@index([topicId, createdAt])
  @@map("note_tidy_job")
}
```

- [ ] **Step 2: 마이그레이션 생성·적용**

Run: `npx prisma migrate dev --name add_topic_note`
Expected: `topic_note`, `note_tidy_job` 테이블 생성, Prisma Client 재생성, 오류 없음

- [ ] **Step 3: 타입 확인**

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: 주제 노트와 노트 정리 잡 스키마 추가"
```

---

### Task 2: core — 노트 정리 프롬프트 빌더 (TDD)

**Files:**
- Create: `src/core/note-tidy-prompt.ts`
- Test: `src/core/note-tidy-prompt.test.ts`

**Interfaces:**
- Consumes: 없음 (순수 함수)
- Produces: `buildNoteTidyPrompt(content: string, resultPath: string): string` — Task 5의 러너가 사용

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/note-tidy-prompt.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { buildNoteTidyPrompt } from "./note-tidy-prompt";

describe("buildNoteTidyPrompt", () => {
  const prompt = buildNoteTidyPrompt(
    "## Bedrock\n- Converse API: 모델 교체 쉬움",
    "D:/out/result.json",
  );

  it("노트 원문을 포함한다", () => {
    expect(prompt).toContain("- Converse API: 모델 교체 쉬움");
  });

  it("결과 저장 경로를 포함한다", () => {
    expect(prompt).toContain("D:/out/result.json");
  });

  it("핵심 정리 규칙을 포함한다", () => {
    expect(prompt).toContain("새로운 사실을 추가하지 마세요");
    expect(prompt).toContain("중복");
  });

  it("출력 형식으로 note 필드 JSON을 지시한다", () => {
    expect(prompt).toContain('"note"');
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/core/note-tidy-prompt.test.ts`
Expected: FAIL — `note-tidy-prompt` 모듈 없음

- [ ] **Step 3: 구현**

`src/core/note-tidy-prompt.ts`:

```typescript
export function buildNoteTidyPrompt(
  content: string,
  resultPath: string,
): string {
  return `당신은 학습 노트 정리 전문가입니다. 아래는 자격증 공부 중 사용자가 직접 작성해 쌓아 온 마크다운 노트입니다. 중복을 제거하고 간결하게 재구성하세요.

## 원본 노트

\`\`\`markdown
${content}
\`\`\`

## 정리 규칙 (반드시 준수)

- 같은 내용을 다르게 표현한 항목은 하나로 통합하세요.
- 장황한 문장은 의미를 유지한 채 간결하게 다듬으세요.
- 원본에 없는 새로운 사실을 추가하지 마세요.
- 중복 통합 외에는 내용을 삭제하지 마세요.
- 마크다운 구조(제목/목록)를 유지하되, 관련 항목이 흩어져 있으면 같은 섹션으로 모으세요.
- 한국어를 유지하고, 서비스명 등 고유명사는 원문 표기 그대로 두세요.

## 출력 형식

다른 설명 없이 아래 구조의 JSON만 작성하세요.

{
  "note": "정리된 마크다운 노트 전문"
}

## 결과 저장 (반드시 준수)

- 결과 JSON을 stdout에 출력하지 마세요.
- 결과 JSON은 다음 경로에 UTF-8 텍스트 파일로만 저장하세요: ${resultPath}
- 파일 내용은 위 출력 형식의 JSON만 포함해야 하며, 코드 펜스나 설명 문장을 추가하지 마세요.
`;
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/core/note-tidy-prompt.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/note-tidy-prompt.ts src/core/note-tidy-prompt.test.ts
git commit -m "feat: 노트 정리 프롬프트 빌더 추가"
```

---

### Task 3: core — 노트 정리 결과 파서 (TDD)

**Files:**
- Create: `src/core/note-tidy-result.ts`
- Test: `src/core/note-tidy-result.test.ts`

**Interfaces:**
- Consumes: zod
- Produces: `parseNoteTidyResult(rawText: string): NoteTidyParseResult`,
  `type NoteTidyParseResult = { ok: true; note: string } | { ok: false; fatal: string }` — Task 5의 러너가 사용

- [ ] **Step 1: 실패하는 테스트 작성**

`src/core/note-tidy-result.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { parseNoteTidyResult } from "./note-tidy-result";

describe("parseNoteTidyResult", () => {
  it("정상 결과에서 note를 추출한다", () => {
    const raw = JSON.stringify({ note: "## Bedrock\n- 핵심 정리" });
    expect(parseNoteTidyResult(raw)).toEqual({
      ok: true,
      note: "## Bedrock\n- 핵심 정리",
    });
  });

  it("note 앞뒤 공백을 잘라낸다", () => {
    const raw = JSON.stringify({ note: "\n\n내용\n" });
    expect(parseNoteTidyResult(raw)).toEqual({ ok: true, note: "내용" });
  });

  it("JSON이 아니면 실패한다", () => {
    expect(parseNoteTidyResult("not json")).toEqual({
      ok: false,
      fatal: "올바른 JSON이 아닙니다",
    });
  });

  it("note 필드가 없으면 실패한다", () => {
    expect(parseNoteTidyResult(JSON.stringify({ text: "x" }))).toEqual({
      ok: false,
      fatal: "note 필드가 필요합니다",
    });
  });

  it("note가 빈 문자열이면 실패한다", () => {
    expect(parseNoteTidyResult(JSON.stringify({ note: "  " }))).toEqual({
      ok: false,
      fatal: "정리된 노트가 비어 있습니다",
    });
  });
});
```

- [ ] **Step 2: 테스트가 실패하는지 확인**

Run: `npx vitest run src/core/note-tidy-result.test.ts`
Expected: FAIL — `note-tidy-result` 모듈 없음

- [ ] **Step 3: 구현**

`src/core/note-tidy-result.ts`:

```typescript
import { z } from "zod";

const noteTidySchema = z.object({ note: z.string() });

export type NoteTidyParseResult =
  | { ok: true; note: string }
  | { ok: false; fatal: string };

export function parseNoteTidyResult(rawText: string): NoteTidyParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return { ok: false, fatal: "올바른 JSON이 아닙니다" };
  }
  const parsed = noteTidySchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fatal: "note 필드가 필요합니다" };
  }
  const note = parsed.data.note.trim();
  if (note.length === 0) {
    return { ok: false, fatal: "정리된 노트가 비어 있습니다" };
  }
  return { ok: true, note };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run src/core/note-tidy-result.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/note-tidy-result.ts src/core/note-tidy-result.test.ts
git commit -m "feat: 노트 정리 결과 파서 추가"
```

---

### Task 4: DTO + note-service

**Files:**
- Modify: `src/lib/api-types.ts` (파일 끝에 추가)
- Create: `src/server/note-service.ts`

**Interfaces:**
- Consumes: `sha256Fingerprint(value: unknown): Promise<string>` (`@/core/stable-json`), `prisma`, `ServiceError`, `generationTimeoutMs()` (`@/server/generation/run-engine`), Task 1의 Prisma 모델
- Produces (Task 5·6·7이 사용):
  - `TopicNoteDto { content: string; updatedAt: string | null; activeTidyJob: { id: number; status: NoteTidyJobStatusDto } | null }`
  - `NoteTidyJobDto { id, topicId, sourceHash, engine, status, preview, errorMessage, createdAt, startedAt, finishedAt, appliedAt, dismissedAt }`
  - `getTopicNote(topicId: number): Promise<TopicNoteDto>`
  - `saveTopicNote(topicId: number, content: string): Promise<TopicNoteDto>`
  - `startNoteTidyJob(topicId: number, engine: GenerationEngine): Promise<NoteTidyJobDto>`
  - `getNoteTidyJob(jobId: number): Promise<NoteTidyJobDto>`
  - `applyNoteTidyJob(jobId: number): Promise<TopicNoteDto>`
  - `dismissNoteTidyJob(jobId: number): Promise<void>`

- [ ] **Step 1: api-types.ts에 DTO 추가**

`src/lib/api-types.ts` 파일 끝에 추가:

```typescript
export type NoteTidyJobStatusDto = "RUNNING" | "SUCCEEDED" | "FAILED";

export interface NoteTidyJobDto {
  id: number;
  topicId: number;
  sourceHash: string;
  engine: GenerationEngineDto;
  status: NoteTidyJobStatusDto;
  preview: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  appliedAt: string | null;
  dismissedAt: string | null;
}

export interface TopicNoteDto {
  content: string;
  updatedAt: string | null;
  activeTidyJob: { id: number; status: NoteTidyJobStatusDto } | null;
}
```

- [ ] **Step 2: note-service.ts 작성**

`src/server/note-service.ts`:

```typescript
import type { GenerationEngine, NoteTidyJob } from "@prisma/client";
import { sha256Fingerprint } from "@/core/stable-json";
import type { NoteTidyJobDto, TopicNoteDto } from "@/lib/api-types";
import { prisma } from "./db";
import { ServiceError } from "./errors";
import { generationTimeoutMs } from "./generation/run-engine";

const STALE_GRACE_MS = 60_000;
const STALE_JOB_MESSAGE = "서버 재시작 또는 시간 초과로 작업이 중단되었습니다";
const MAX_NOTE_LENGTH = 100_000;

function toJobDto(job: NoteTidyJob): NoteTidyJobDto {
  return {
    id: job.id,
    topicId: job.topicId,
    sourceHash: job.sourceHash,
    engine: job.engine,
    status: job.status,
    preview: job.preview,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    appliedAt: job.appliedAt?.toISOString() ?? null,
    dismissedAt: job.dismissedAt?.toISOString() ?? null,
  };
}

async function recoverStaleNoteTidyJobs(): Promise<void> {
  const staleBefore = new Date(
    Date.now() - generationTimeoutMs() - STALE_GRACE_MS,
  );
  await prisma.noteTidyJob.updateMany({
    where: {
      status: "RUNNING",
      OR: [
        { startedAt: { lt: staleBefore } },
        { startedAt: null, createdAt: { lt: staleBefore } },
      ],
    },
    data: {
      status: "FAILED",
      errorMessage: STALE_JOB_MESSAGE,
      finishedAt: new Date(),
    },
  });
}

async function requireTopic(topicId: number): Promise<void> {
  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    select: { id: true },
  });
  if (!topic) {
    throw new ServiceError("NOT_FOUND", "주제를 찾을 수 없습니다", 404);
  }
}

// RUNNING이거나, SUCCEEDED인데 아직 반영/폐기되지 않은 최신 잡 (스펙 §4·§7)
async function findActiveTidyJob(topicId: number): Promise<NoteTidyJob | null> {
  return prisma.noteTidyJob.findFirst({
    where: {
      topicId,
      OR: [
        { status: "RUNNING" },
        { status: "SUCCEEDED", appliedAt: null, dismissedAt: null },
      ],
    },
    orderBy: { createdAt: "desc" },
  });
}

async function toNoteDto(topicId: number): Promise<TopicNoteDto> {
  const [note, activeJob] = await Promise.all([
    prisma.topicNote.findUnique({ where: { topicId } }),
    findActiveTidyJob(topicId),
  ]);
  return {
    content: note?.content ?? "",
    updatedAt: note?.updatedAt.toISOString() ?? null,
    activeTidyJob: activeJob
      ? { id: activeJob.id, status: activeJob.status }
      : null,
  };
}

export async function getTopicNote(topicId: number): Promise<TopicNoteDto> {
  await recoverStaleNoteTidyJobs();
  await requireTopic(topicId);
  return toNoteDto(topicId);
}

export async function saveTopicNote(
  topicId: number,
  content: string,
): Promise<TopicNoteDto> {
  await requireTopic(topicId);
  if (content.length > MAX_NOTE_LENGTH) {
    throw new ServiceError("VALIDATION", "노트가 너무 깁니다", 400);
  }
  await prisma.topicNote.upsert({
    where: { topicId },
    create: { topicId, content },
    update: { content },
  });
  return toNoteDto(topicId);
}

export async function startNoteTidyJob(
  topicId: number,
  engine: GenerationEngine,
): Promise<NoteTidyJobDto> {
  await recoverStaleNoteTidyJobs();
  await requireTopic(topicId);

  const note = await prisma.topicNote.findUnique({ where: { topicId } });
  if (!note || note.content.trim().length === 0) {
    throw new ServiceError("VALIDATION", "정리할 노트가 없습니다", 400);
  }

  const active = await findActiveTidyJob(topicId);
  if (active) {
    throw new ServiceError(
      "NOTE_TIDY_ACTIVE_EXISTS",
      active.status === "RUNNING"
        ? "이미 진행 중인 정리 작업이 있습니다"
        : "처리하지 않은 정리 결과가 있습니다. 먼저 반영하거나 폐기해 주세요",
      409,
    );
  }

  const sourceHash = await sha256Fingerprint(note.content);
  const job = await prisma.noteTidyJob.create({
    data: { topicId, sourceHash, engine },
  });
  return toJobDto(job);
}

export async function getNoteTidyJob(jobId: number): Promise<NoteTidyJobDto> {
  await recoverStaleNoteTidyJobs();
  const job = await prisma.noteTidyJob.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new ServiceError("NOT_FOUND", "노트 정리 작업을 찾을 수 없습니다", 404);
  }
  return toJobDto(job);
}

export async function applyNoteTidyJob(jobId: number): Promise<TopicNoteDto> {
  const topicId = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM note_tidy_job WHERE id = ${jobId} FOR UPDATE`;
    const job = await tx.noteTidyJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new ServiceError("NOT_FOUND", "노트 정리 작업을 찾을 수 없습니다", 404);
    }
    if (job.appliedAt) return job.topicId;
    if (job.dismissedAt) {
      throw new ServiceError(
        "NOTE_TIDY_DISMISSED",
        "폐기된 작업은 반영할 수 없습니다",
        409,
      );
    }
    if (job.status !== "SUCCEEDED" || job.preview === null) {
      throw new ServiceError(
        "NOTE_TIDY_NOT_READY",
        "완료된 정리 결과만 반영할 수 있습니다",
        409,
      );
    }

    await tx.$queryRaw`SELECT id FROM topic_note WHERE topic_id = ${job.topicId} FOR UPDATE`;
    const note = await tx.topicNote.findUnique({
      where: { topicId: job.topicId },
    });
    const currentHash = note ? await sha256Fingerprint(note.content) : null;
    if (!note || currentHash !== job.sourceHash) {
      throw new ServiceError(
        "NOTE_TIDY_SOURCE_CHANGED",
        "노트가 그 사이 수정되어 반영할 수 없습니다. 초안을 폐기하고 다시 실행해 주세요",
        409,
      );
    }

    await tx.topicNote.update({
      where: { topicId: job.topicId },
      data: { content: job.preview },
    });
    await tx.noteTidyJob.update({
      where: { id: jobId },
      data: { appliedAt: new Date() },
    });
    return job.topicId;
  });
  return toNoteDto(topicId);
}

export async function dismissNoteTidyJob(jobId: number): Promise<void> {
  const job = await prisma.noteTidyJob.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new ServiceError("NOT_FOUND", "노트 정리 작업을 찾을 수 없습니다", 404);
  }
  if (job.appliedAt) {
    throw new ServiceError(
      "NOTE_TIDY_ALREADY_APPLIED",
      "이미 반영된 작업은 폐기할 수 없습니다",
      409,
    );
  }
  if (job.status === "RUNNING") {
    throw new ServiceError(
      "NOTE_TIDY_NOT_READY",
      "진행 중인 작업은 폐기할 수 없습니다",
      409,
    );
  }
  if (job.dismissedAt) return;
  await prisma.noteTidyJob.updateMany({
    where: { id: jobId, appliedAt: null, dismissedAt: null },
    data: { dismissedAt: new Date() },
  });
}
```

- [ ] **Step 3: 타입·기존 테스트 확인**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 오류 없음, 기존 테스트 전부 PASS

- [ ] **Step 4: Commit**

```bash
git add src/lib/api-types.ts src/server/note-service.ts
git commit -m "feat: 주제 노트 서비스와 DTO 추가"
```

---

### Task 5: 러너 + API 라우트 5개

**Files:**
- Create: `src/server/note-tidy-runner.ts`
- Create: `src/app/api/topics/[id]/note/route.ts`
- Create: `src/app/api/topics/[id]/note/tidy/route.ts`
- Create: `src/app/api/note-tidy-jobs/[id]/route.ts`
- Create: `src/app/api/note-tidy-jobs/[id]/apply/route.ts`
- Create: `src/app/api/note-tidy-jobs/[id]/dismiss/route.ts`

**Interfaces:**
- Consumes: Task 2 `buildNoteTidyPrompt`, Task 3 `parseNoteTidyResult`, Task 4 서비스 함수 전부, `runEngine(engine, prompt, dir)` (`@/server/generation/run-engine`), `extractJsonObject` (`@/core/json-extract`), `jsonOk`/`handleApiError`/`parseBody`/`parseIdParam` (`@/server/http`), `after` (`next/server`)
- Produces: `runNoteTidyJob(jobId: number): Promise<void>`, REST API 6개 엔드포인트 (Task 6의 api-client가 호출)

- [ ] **Step 1: note-tidy-runner.ts 작성**

`src/server/note-tidy-runner.ts`:

```typescript
import path from "node:path";
import { extractJsonObject } from "@/core/json-extract";
import { buildNoteTidyPrompt } from "@/core/note-tidy-prompt";
import { parseNoteTidyResult } from "@/core/note-tidy-result";
import { prisma } from "./db";
import { runEngine } from "./generation/run-engine";

function outputDir(jobId: number): string {
  return path.resolve("generation_output", "note-tidy", "jobs", String(jobId));
}

async function markFailed(jobId: number, errorMessage: string): Promise<void> {
  await prisma.noteTidyJob.updateMany({
    where: { id: jobId, status: "RUNNING" },
    data: { status: "FAILED", errorMessage, finishedAt: new Date() },
  });
}

export async function runNoteTidyJob(jobId: number): Promise<void> {
  const claimed = await prisma.noteTidyJob.updateMany({
    where: { id: jobId, status: "RUNNING", startedAt: null },
    data: { startedAt: new Date() },
  });
  if (claimed.count === 0) return;

  const job = await prisma.noteTidyJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RUNNING") return;

  const note = await prisma.topicNote.findUnique({
    where: { topicId: job.topicId },
  });
  if (!note) {
    await markFailed(jobId, "노트를 찾을 수 없습니다");
    return;
  }

  try {
    const dir = outputDir(job.id);
    const prompt = buildNoteTidyPrompt(
      note.content,
      path.join(dir, "result.json"),
    );
    const run = await runEngine(job.engine, prompt, dir);
    if (!run.ok) {
      await markFailed(jobId, run.failureReason);
      return;
    }
    const parsed = parseNoteTidyResult(extractJsonObject(run.resultText));
    if (!parsed.ok) {
      await markFailed(jobId, `정리 결과를 해석하지 못했습니다: ${parsed.fatal}`);
      return;
    }
    await prisma.noteTidyJob.updateMany({
      where: { id: jobId, status: "RUNNING" },
      data: {
        status: "SUCCEEDED",
        preview: parsed.note,
        errorMessage: null,
        finishedAt: new Date(),
      },
    });
  } catch (error) {
    await markFailed(
      jobId,
      error instanceof Error
        ? error.message
        : "노트 정리 작업 중 알 수 없는 오류가 발생했습니다",
    );
  }
}
```

- [ ] **Step 2: 노트 GET/PUT 라우트 작성**

`src/app/api/topics/[id]/note/route.ts`:

```typescript
import { z } from "zod";
import { getTopicNote, saveTopicNote } from "@/server/note-service";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";

const putSchema = z.object({ content: z.string().max(100_000) });

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    return jsonOk(await getTopicNote(parseIdParam(id)));
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { content } = await parseBody(req, putSchema);
    return jsonOk(await saveTopicNote(parseIdParam(id), content));
  } catch (e) {
    return handleApiError(e);
  }
}
```

- [ ] **Step 3: 정리 잡 시작 라우트 작성**

`src/app/api/topics/[id]/note/tidy/route.ts`:

```typescript
import { z } from "zod";
import { after } from "next/server";
import { runNoteTidyJob } from "@/server/note-tidy-runner";
import { startNoteTidyJob } from "@/server/note-service";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";

const bodySchema = z.object({
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { engine } = await parseBody(req, bodySchema);
    const job = await startNoteTidyJob(parseIdParam(id), engine);
    after(async () => {
      try {
        await runNoteTidyJob(job.id);
      } catch (error) {
        console.error("note tidy runner failed", error);
      }
    });
    return jsonOk({ job }, 202);
  } catch (e) {
    return handleApiError(e);
  }
}
```

- [ ] **Step 4: 잡 조회/반영/폐기 라우트 작성**

`src/app/api/note-tidy-jobs/[id]/route.ts`:

```typescript
import { getNoteTidyJob } from "@/server/note-service";
import { handleApiError, jsonOk, parseIdParam } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    return jsonOk({ job: await getNoteTidyJob(parseIdParam(id)) });
  } catch (e) {
    return handleApiError(e);
  }
}
```

`src/app/api/note-tidy-jobs/[id]/apply/route.ts`:

```typescript
import { applyNoteTidyJob } from "@/server/note-service";
import { handleApiError, jsonOk, parseIdParam } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    return jsonOk(await applyNoteTidyJob(parseIdParam(id)));
  } catch (e) {
    return handleApiError(e);
  }
}
```

`src/app/api/note-tidy-jobs/[id]/dismiss/route.ts`:

```typescript
import { dismissNoteTidyJob } from "@/server/note-service";
import { handleApiError, jsonOk, parseIdParam } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await dismissNoteTidyJob(parseIdParam(id));
    return jsonOk({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
```

- [ ] **Step 5: 타입 확인**

Run: `npx tsc --noEmit`
Expected: 오류 없음

- [ ] **Step 6: curl 수동 검증**

개발 서버를 켜고 (`npm run dev`), PowerShell에서 (topicId 1이 존재한다고 가정 — 없으면 실제 존재하는 주제 id 사용):

```powershell
# 로그인 (쿠키 저장)
curl.exe -s -c cookies.txt -X POST http://localhost:3000/api/auth/login -H "Content-Type: application/json" -d "{\"password\":\"<APP_PASSWORD 값>\"}"

# 1) 빈 노트 조회 → {"content":"","updatedAt":null,"activeTidyJob":null}
curl.exe -s -b cookies.txt http://localhost:3000/api/topics/1/note

# 2) 노트 저장 → content가 저장된 응답
curl.exe -s -b cookies.txt -X PUT http://localhost:3000/api/topics/1/note -H "Content-Type: application/json" -d "{\"content\":\"## Bedrock\n- Converse API: 모델 교체 쉬움\n- Converse API를 쓰면 모델을 갈아끼우기 쉽다\"}"

# 3) 정리 잡 시작 → 202, {"job":{...,"status":"RUNNING"}}
curl.exe -s -b cookies.txt -X POST http://localhost:3000/api/topics/1/note/tidy -H "Content-Type: application/json" -d "{\"engine\":\"CLAUDE\"}"

# 4) 같은 주제에 잡 재시작 시도 → 409 NOTE_TIDY_ACTIVE_EXISTS
curl.exe -s -b cookies.txt -X POST http://localhost:3000/api/topics/1/note/tidy -H "Content-Type: application/json" -d "{\"engine\":\"CLAUDE\"}"

# 5) 잡 폴링 (jobId는 3번 응답의 id) → SUCCEEDED가 될 때까지 반복, preview에 정리 초안
curl.exe -s -b cookies.txt http://localhost:3000/api/note-tidy-jobs/<jobId>

# 6) source_hash 충돌 재현: 노트를 수정한 뒤 반영 시도 → 409 NOTE_TIDY_SOURCE_CHANGED
curl.exe -s -b cookies.txt -X PUT http://localhost:3000/api/topics/1/note -H "Content-Type: application/json" -d "{\"content\":\"수정된 노트\"}"
curl.exe -s -b cookies.txt -X POST http://localhost:3000/api/note-tidy-jobs/<jobId>/apply

# 7) 폐기 → {"ok":true}
curl.exe -s -b cookies.txt -X POST http://localhost:3000/api/note-tidy-jobs/<jobId>/dismiss

# 8) 정상 반영 플로우: 다시 잡 시작(3) → SUCCEEDED 대기(5) → 반영 → 노트가 preview로 교체된 TopicNoteDto 응답
curl.exe -s -b cookies.txt -X POST http://localhost:3000/api/note-tidy-jobs/<새 jobId>/apply
```

Expected: 각 주석의 결과. 6번에서 409, 8번에서 노트 내용이 초안으로 바뀌어야 함.

- [ ] **Step 7: Commit**

```bash
git add src/server/note-tidy-runner.ts "src/app/api/topics/[id]/note" "src/app/api/note-tidy-jobs"
git commit -m "feat: 노트 정리 러너와 노트 API 라우트 추가"
```

---

### Task 6: api-client + 학습 큐에 topicId 추가

**Files:**
- Modify: `src/lib/api-types.ts` (`StudyQuestionDto`)
- Modify: `src/lib/api-client.ts`
- Modify: `src/server/study-service.ts`

**Interfaces:**
- Consumes: Task 4 DTO, Task 5 엔드포인트
- Produces (Task 7이 사용):
  - `StudyQuestionDto`에 `topicId: number` 추가 (MCQ/CLOZE 양쪽)
  - `api.notes.get(topicId): Promise<TopicNoteDto>`
  - `api.notes.save(topicId, content): Promise<TopicNoteDto>`
  - `api.notes.tidy(topicId, engine): Promise<{ job: NoteTidyJobDto }>`
  - `api.notes.tidyJob(jobId): Promise<{ job: NoteTidyJobDto }>`
  - `api.notes.applyTidy(jobId): Promise<TopicNoteDto>`
  - `api.notes.dismissTidy(jobId): Promise<{ ok: true }>`

- [ ] **Step 1: StudyQuestionDto에 topicId 추가**

`src/lib/api-types.ts`의 `StudyQuestionDto`를 다음으로 교체:

```typescript
export type StudyQuestionDto =
  | { id: number; topicId: number; type: "MCQ"; question: string; choices: McqChoiceDto[]; selectionCount: 1 | 2 }
  | {
      id: number;
      topicId: number;
      type: "CLOZE";
      text: string;
      blankIds: number[];
      wordBank: string[];
    };
```

- [ ] **Step 2: study-service.ts의 toStudyDto에 topicId 반영**

`src/server/study-service.ts`의 `toStudyDto` 함수를 다음으로 교체 (파라미터 타입에 `topicId` 추가, 반환 객체 양쪽에 `topicId` 포함):

```typescript
function toStudyDto(question: {
  id: number;
  topicId: number;
  type: "MCQ" | "CLOZE";
  payload: unknown;
}): StudyQuestionDto {
  if (question.type === "MCQ") {
    const payload = question.payload as unknown as McqPayload;
    return {
      id: question.id,
      topicId: question.topicId,
      type: "MCQ",
      question: payload.question,
      selectionCount: mcqAnswerIndices(payload).length === 2 ? 2 : 1,
      choices: shuffle(
        payload.choices.map((text, original_index) => ({
          text,
          original_index,
        })),
      ),
    };
  }

  const payload = question.payload as unknown as ClozePayload;
  return {
    id: question.id,
    topicId: question.topicId,
    type: "CLOZE",
    text: payload.text,
    blankIds: payload.blanks.map((blank) => blank.id),
    wordBank: shuffle([
      ...payload.blanks.map((blank) => blank.answer),
      ...payload.distractors,
    ]),
  };
}
```

호출부는 전부 Prisma `question` 전체 행(항상 `topicId` 포함)을 넘기므로 다른 수정은 필요 없다.

- [ ] **Step 3: api-client에 notes 섹션 추가**

`src/lib/api-client.ts`:

1. import 목록에 `NoteTidyJobDto`, `TopicNoteDto` 추가 (알파벳 순서 위치: `KeywordSuggestionDto` 뒤, `QuestionDetailDto` 앞에 `NoteTidyJobDto`, `TopicDto` 뒤에 `TopicNoteDto`).
2. `api` 객체의 `hardenJobs` 섹션 아래에 추가:

```typescript
  notes: {
    get: (topicId: number) =>
      request<TopicNoteDto>(`/api/topics/${topicId}/note`),
    save: (topicId: number, content: string) =>
      request<TopicNoteDto>(`/api/topics/${topicId}/note`, {
        method: "PUT",
        body: JSON.stringify({ content }),
      }),
    tidy: (topicId: number, engine: GenerationEngineDto) =>
      request<{ job: NoteTidyJobDto }>(`/api/topics/${topicId}/note/tidy`, {
        method: "POST",
        body: JSON.stringify({ engine }),
      }),
    tidyJob: (jobId: number) =>
      request<{ job: NoteTidyJobDto }>(`/api/note-tidy-jobs/${jobId}`),
    applyTidy: (jobId: number) =>
      request<TopicNoteDto>(`/api/note-tidy-jobs/${jobId}/apply`, {
        method: "POST",
      }),
    dismissTidy: (jobId: number) =>
      request<{ ok: true }>(`/api/note-tidy-jobs/${jobId}/dismiss`, {
        method: "POST",
      }),
  },
```

- [ ] **Step 4: 타입·기존 테스트 확인**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 오류 없음, 전부 PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/api-types.ts src/lib/api-client.ts src/server/study-service.ts
git commit -m "feat: 노트 api-client와 학습 큐 topicId 추가"
```

---

### Task 7: NotePanel + 학습 화면 통합

**Files:**
- Create: `src/components/NotePanel.tsx`
- Modify: `src/app/study/page.tsx`
- Modify: `src/app/globals.css` (파일 끝에 추가)
- Modify: `package.json` (react-markdown, remark-gfm 설치)

**Interfaces:**
- Consumes: Task 6의 `api.notes.*`, `StudyQuestionDto.topicId`, `TopicNoteDto`, `NoteTidyJobDto`, `GenerationEngineDto`, `ApiError` (`@/lib/api-client`)
- Produces: `<NotePanel topicId={number} onClose={() => void} />`

- [ ] **Step 1: 의존성 설치**

Run: `npm install react-markdown remark-gfm`
Expected: 설치 성공 (react-markdown v10+, React 19 호환)

- [ ] **Step 2: globals.css에 마크다운 스타일 추가**

`src/app/globals.css` 파일 끝에 추가:

```css
/* 노트 패널 마크다운 렌더링 */
.note-markdown {
  font-size: 0.875rem;
  line-height: 1.6;
}
.note-markdown h1,
.note-markdown h2,
.note-markdown h3 {
  font-weight: 700;
  margin: 1em 0 0.4em;
}
.note-markdown h1 { font-size: 1.15rem; }
.note-markdown h2 { font-size: 1.05rem; }
.note-markdown h3 { font-size: 0.95rem; }
.note-markdown ul,
.note-markdown ol {
  padding-left: 1.25rem;
  margin: 0.4em 0;
}
.note-markdown ul { list-style: disc; }
.note-markdown ol { list-style: decimal; }
.note-markdown li { margin: 0.15em 0; }
.note-markdown p { margin: 0.4em 0; }
.note-markdown code {
  font-size: 0.8rem;
  padding: 0.1em 0.3em;
  border-radius: 4px;
  background: color-mix(in srgb, currentColor 10%, transparent);
}
.note-markdown table {
  border-collapse: collapse;
  margin: 0.5em 0;
  width: 100%;
}
.note-markdown th,
.note-markdown td {
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  padding: 0.3em 0.5em;
  text-align: left;
}
```

- [ ] **Step 3: NotePanel.tsx 작성**

`src/components/NotePanel.tsx`:

```tsx
"use client";

import { useCallback, useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, ApiError } from "@/lib/api-client";
import type {
  GenerationEngineDto,
  NoteTidyJobDto,
  TopicNoteDto,
} from "@/lib/api-types";

const ENGINES: GenerationEngineDto[] = ["CLAUDE", "CODEX", "ANTIGRAVITY"];
const POLL_MS = 3_000;

function Markdown({ content }: { content: string }) {
  if (content.trim().length === 0) {
    return (
      <p className="muted">
        아직 노트가 없습니다. 편집을 눌러 첫 내용을 적어 보세요.
      </p>
    );
  }
  return (
    <div className="note-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

export default function NotePanel({
  topicId,
  onClose,
}: {
  topicId: number;
  onClose: () => void;
}) {
  const [note, setNote] = useState<TopicNoteDto | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [engine, setEngine] = useState<GenerationEngineDto>("CLAUDE");
  const [job, setJob] = useState<NoteTidyJobDto | null>(null);
  const [comparing, setComparing] = useState<"draft" | "current">("draft");

  const loadJob = useCallback(async (jobId: number) => {
    try {
      const { job: loaded } = await api.notes.tidyJob(jobId);
      setJob(loaded);
    } catch (err) {
      setError(err instanceof Error ? err.message : "정리 작업 조회에 실패했습니다");
    }
  }, []);

  useEffect(() => {
    let ignore = false;
    api.notes
      .get(topicId)
      .then((loaded) => {
        if (ignore) return;
        setNote(loaded);
        if (loaded.activeTidyJob) void loadJob(loaded.activeTidyJob.id);
      })
      .catch((err: unknown) => {
        if (!ignore) {
          setError(err instanceof Error ? err.message : "노트를 불러오지 못했습니다");
        }
      });
    return () => {
      ignore = true;
    };
  }, [topicId, loadJob]);

  useEffect(() => {
    if (job?.status !== "RUNNING") return;
    const timer = setInterval(() => void loadJob(job.id), POLL_MS);
    return () => clearInterval(timer);
  }, [job?.status, job?.id, loadJob]);

  function startEdit() {
    if (!note) return;
    setDraft(note.content);
    setMode("edit");
    setFeedback("");
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const saved = await api.notes.save(topicId, draft);
      setNote(saved);
      setMode("view");
      setFeedback("저장했습니다 ✅");
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다");
    } finally {
      setSaving(false);
    }
  }

  async function startTidy() {
    setError("");
    setFeedback("");
    try {
      const { job: started } = await api.notes.tidy(topicId, engine);
      setJob(started);
    } catch (err) {
      setError(err instanceof Error ? err.message : "정리 작업 시작에 실패했습니다");
    }
  }

  async function applyTidy() {
    if (!job) return;
    setError("");
    try {
      const applied = await api.notes.applyTidy(job.id);
      setNote(applied);
      setJob(null);
      setFeedback("정리 결과를 반영했습니다 ✅");
    } catch (err) {
      if (err instanceof ApiError && err.code === "NOTE_TIDY_SOURCE_CHANGED") {
        setError("노트가 그 사이 수정되어 반영할 수 없습니다 ❌ 초안을 폐기하고 다시 실행해 주세요");
      } else {
        setError(err instanceof Error ? err.message : "반영에 실패했습니다");
      }
    }
  }

  async function dismissTidy() {
    if (!job) return;
    setError("");
    try {
      await api.notes.dismissTidy(job.id);
      setJob(null);
      setFeedback("정리 초안을 폐기했습니다");
    } catch (err) {
      setError(err instanceof Error ? err.message : "폐기에 실패했습니다");
    }
  }

  const pendingDraft = job?.status === "SUCCEEDED" && job.preview !== null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="surface flex max-h-[85vh] w-full max-w-3xl flex-col gap-3 overflow-y-auto rounded-t-2xl p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <span className="font-semibold">📝 주제 노트</span>
          <button onClick={onClose} className="btn btn-secondary text-sm">
            닫기
          </button>
        </div>

        {error && <p className="text-sm text-[color:var(--danger)]">{error}</p>}
        {feedback && <p className="text-sm">{feedback}</p>}

        {!note && !error && <p className="muted">불러오는 중...</p>}

        {note && !pendingDraft && mode === "view" && (
          <>
            <Markdown content={note.content} />
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={startEdit} className="btn btn-secondary text-sm">
                ✏️ 편집
              </button>
              {job?.status === "RUNNING" ? (
                <span className="chip">🤖 AI 정리 중...</span>
              ) : (
                <>
                  <select
                    value={engine}
                    onChange={(event) =>
                      setEngine(event.target.value as GenerationEngineDto)
                    }
                    className="rounded border px-2 py-1 text-sm"
                  >
                    {ENGINES.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={startTidy}
                    disabled={note.content.trim().length === 0}
                    className="btn btn-secondary text-sm"
                  >
                    🤖 AI 정리
                  </button>
                </>
              )}
              {job?.status === "FAILED" && (
                <span className="text-sm text-[color:var(--danger)]">
                  정리 실패 ❌ {job.errorMessage}
                </span>
              )}
            </div>
          </>
        )}

        {note && !pendingDraft && mode === "edit" && (
          <>
            <textarea
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              rows={14}
              className="w-full rounded border p-2 font-mono text-sm"
            />
            <div className="flex items-center gap-2">
              <button
                onClick={save}
                disabled={saving}
                className="btn btn-primary text-sm"
              >
                {saving ? "저장 중..." : "저장"}
              </button>
              <button
                onClick={() => setMode("view")}
                disabled={saving}
                className="btn btn-secondary text-sm"
              >
                취소
              </button>
            </div>
          </>
        )}

        {note && pendingDraft && job && (
          <>
            <div className="flex items-center gap-2">
              <span className="chip">🤖 정리 초안 도착</span>
              <button
                onClick={() =>
                  setComparing(comparing === "draft" ? "current" : "draft")
                }
                className="btn btn-secondary text-sm"
              >
                {comparing === "draft" ? "현재 노트 보기" : "정리 초안 보기"}
              </button>
            </div>
            <Markdown
              content={comparing === "draft" ? (job.preview ?? "") : note.content}
            />
            <div className="flex items-center gap-2">
              <button onClick={applyTidy} className="btn btn-primary text-sm">
                반영
              </button>
              <button onClick={dismissTidy} className="btn btn-danger text-sm">
                폐기
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 학습 화면에 노트 버튼·패널 연결**

`src/app/study/page.tsx` 수정:

1. import 추가:

```typescript
import NotePanel from "@/components/NotePanel";
```

2. `StudySession` 컴포넌트의 state 선언에 추가 (`keywordName` 아래):

```typescript
  const [noteOpen, setNoteOpen] = useState(false);
```

3. 헤더의 버튼 영역(`<div className="flex items-center gap-3">` 안, 문제 삭제 버튼 앞)에 노트 버튼 추가:

```tsx
          <button
            onClick={() => setNoteOpen(true)}
            className="btn btn-secondary text-sm"
          >
            📝 노트
          </button>
```

4. 컴포넌트 반환 JSX의 마지막(`{result && (...)}` 블록 아래, 최상위 `div` 닫히기 전)에 패널 렌더링 추가:

```tsx
      {noteOpen && current && (
        <NotePanel topicId={current.topicId} onClose={() => setNoteOpen(false)} />
      )}
```

- [ ] **Step 5: 타입·전체 테스트 확인**

Run: `npx tsc --noEmit && npx vitest run`
Expected: 오류 없음, 전부 PASS

- [ ] **Step 6: 수동 검증 (브라우저)**

`npm run dev` 후 브라우저에서:

1. `/study?mode=practice`로 진입 → 헤더에 "📝 노트" 버튼 표시
2. 버튼 클릭 → 바텀 시트 열림, 빈 노트 안내 문구
3. 편집 → 마크다운 입력(제목/목록 포함) → 저장 → "저장했습니다 ✅" → 보기 모드에서 렌더링 확인
4. 다음 문제로 넘어가도 패널 재오픈 시 같은 노트 유지 (같은 주제일 때)
5. AI 정리 클릭 → "🤖 AI 정리 중..." → 완료 후 "정리 초안 도착" → 현재/초안 토글 비교 → 반영 → 노트 갱신 확인
6. 다시 AI 정리 실행 후 초안 도착 상태에서 폐기 → 원본 유지 확인

Expected: 각 단계 정상 동작. 5번에서 반영 후 보기 모드 내용이 초안으로 교체.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json src/components/NotePanel.tsx src/app/study/page.tsx src/app/globals.css
git commit -m "feat: 학습 화면에 주제 노트 패널과 AI 정리 UI 추가"
```
