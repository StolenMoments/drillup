# AI 생성 작업 목록·상세 페이지 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** AI 문제 생성의 시작·확인을 분리해, 생성 폼(`/generate/new`) → 상세·승인(`/generate/[id]`) → 작업 목록(`/generate`) 세 페이지로 재구성한다.

**Architecture:** 기존 잡 실행 파이프라인(`generation-service.runJob`, `run-engine`, 검증)은 그대로 두고, 그 위에 잡 생명주기의 조회(목록)·승인(저장)·삭제 표층만 추가한다. `GenerationJob`에 `approvedAt`·`savedCount` 컬럼 2개를 더하고, API 3개(`GET /api/generate`, `POST /api/generate/[id]/approve`, `DELETE /api/generate/[id]`)를 추가한 뒤, 현재 단일 `/generate` 페이지를 목록/폼/상세로 분해한다.

**Tech Stack:** Next.js 15+ (App Router, TypeScript), React, Prisma 7 + MariaDB, zod, Tailwind.

**선행 문서:** 설계서 `docs/superpowers/specs/2026-07-09-generation-job-pages-design.md`

## Global Constraints

- **TypeScript strict**, `any` 금지 — payload 캐스팅은 `as unknown as T`만 허용.
- **`src/core/`는 순수 TS** (Next/Prisma/Node import 금지), **`src/server/`는 Next import 금지** (단 `http.ts`는 예외).
- **Route Handler는 얇게**: zod 파싱 → 서비스 호출 → JSON 응답. 비즈니스 로직 금지.
- **화면은 `src/lib/api-client.ts`의 `api` 객체만 사용** (fetch 직접 호출 금지). 서버 컴포넌트에서 `src/server/` 직접 호출 금지 — 데이터 페이지는 `"use client"` + api-client.
- **문제 payload 키는 snake_case** (`answer_index`, `blanks`, `distractors`).
- **DB 삽입은 `import-service`의 `importQuestions` 단일 경로만 사용** — 새 삽입 경로 금지.
- **API 오류 응답 형식**: `{ "error": { "code": string, "message": string } }` (`http.ts`의 `jsonError`/`ServiceError`가 처리).
- **UI 문구는 한국어.** 답안/완료 이모지(✅/❌/⚠️/🎉) 유지.
- **커밋은 conventional commits** (`feat:`/`fix:`/`docs:` …), 태스크마다 1커밋, **커밋 메시지는 한국어**(타입 접두사만 영어). 커밋 메시지 끝에 `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.
- **서비스 계층·Route Handler·화면은 프로젝트 규약상 자동 테스트를 두지 않는다** — 각 태스크는 빌드(`npx tsc`)와 curl/브라우저 수동 검증으로 마무리한다. 신규 core 순수 함수가 없으므로 vitest 추가 없음.
- **Next.js 주의(AGENTS.md)**: 이 저장소의 Next는 학습 데이터와 다를 수 있다. 클라이언트 내비게이션(`useRouter`, `useParams` from `next/navigation`)을 쓰기 전에 `node_modules/next/dist/docs/`의 App Router 가이드를 확인한다. (기존 페이지는 이미 `"use client"` 패턴을 쓴다 — 그 패턴을 따른다.)

**검증 공통 준비:** dev 서버를 백그라운드로 띄워 둔다.
```bash
npm run dev   # http://localhost:3000
```
curl 예시는 인증 쿠키가 필요할 수 있다(미들웨어 가드). 로그인 후 브라우저 세션으로 확인하거나, `curl.exe -b cookie.txt` 형태로 세션 쿠키를 전달한다. (Windows에서 `curl`은 반드시 `curl.exe`.)

---

### Task 1: 승인 컬럼 추가 (스키마 + 마이그레이션 + DTO + toDto)

`GenerationJob`에 승인 추적 컬럼 2개를 더하고, 상세 DTO와 `toDto`가 이를 노출하게 한다. 신규 API·화면은 없다 — 기존 `GET /api/generate/[id]`가 두 필드를 더 반환하게 되는 것이 관찰 가능한 변화다.

**Files:**
- Modify: `prisma/schema.prisma:84-101` (`GenerationJob` 모델)
- Create: `prisma/migrations/<timestamp>_add_generation_approval/migration.sql` (migrate 명령이 생성)
- Modify: `src/lib/api-types.ts` (`GenerationJobDto`에 필드 2개 추가, 대략 125-136행)
- Modify: `src/server/generation/generation-service.ts:21-37` (`toDto`)

**Interfaces:**
- Produces: `GenerationJobDto`에 `approvedAt: string | null`, `savedCount: number` 추가. `GenerationJob` Prisma 모델에 `approvedAt: DateTime?`, `savedCount: Int @default(0)`.

- [ ] **Step 1: 스키마에 컬럼 추가**

`prisma/schema.prisma`의 `GenerationJob` 모델에서 `finishedAt` 줄 아래에 추가:

```prisma
  createdAt     DateTime         @default(now()) @map("created_at")
  finishedAt    DateTime?        @map("finished_at")
  approvedAt    DateTime?        @map("approved_at")
  savedCount    Int              @default(0) @map("saved_count")
  topic         Topic            @relation(fields: [topicId], references: [id], onDelete: Cascade)
```

- [ ] **Step 2: 마이그레이션 생성·적용**

Run:
```bash
npx prisma migrate dev --name add_generation_approval
```
Expected: `Applying migration ...add_generation_approval`, Prisma Client 재생성 성공. 새 마이그레이션 폴더가 `prisma/migrations/`에 생김.

- [ ] **Step 3: 상세 DTO에 필드 추가**

`src/lib/api-types.ts`의 `GenerationJobDto`에 `finishedAt` 아래로 추가:

```ts
export interface GenerationJobDto {
  id: number;
  topicId: number;
  engine: GenerationEngineDto;
  verifyEngine: GenerationEngineDto;
  status: GenerationStatusDto;
  items: GenerationItemDto[] | null;
  errorMessage: string | null;
  verifyWarning: string | null;
  createdAt: string;
  finishedAt: string | null;
  approvedAt: string | null;
  savedCount: number;
}
```

- [ ] **Step 4: `toDto`가 새 필드를 반환하게 수정**

`src/server/generation/generation-service.ts`의 `toDto` 반환 객체에 추가:

```ts
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    approvedAt: job.approvedAt?.toISOString() ?? null,
    savedCount: job.savedCount,
  };
```

- [ ] **Step 5: 타입 체크**

Run:
```bash
npx tsc --noEmit
```
Expected: 오류 없음 (exit 0).

- [ ] **Step 6: 수동 검증**

브라우저(또는 curl)로 기존 잡 하나 조회: `GET /api/generate/<기존 잡 id>` 응답 JSON에 `approvedAt: null`, `savedCount: 0`이 포함되는지 확인.

- [ ] **Step 7: 커밋**

```bash
git add prisma/schema.prisma prisma/migrations src/lib/api-types.ts src/server/generation/generation-service.ts
git commit -m "$(printf 'feat: 생성 잡에 승인 추적 컬럼(approvedAt, savedCount) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 2: 작업 목록 조회 (서비스 + GET /api/generate + api-client)

최근 50개 잡을 요약 DTO로 반환하는 목록 엔드포인트를 추가한다.

**Files:**
- Modify: `src/lib/api-types.ts` (`GenerationJobSummaryDto` 추가)
- Modify: `src/server/generation/generation-service.ts` (`toSummaryDto`, `listJobs` 추가)
- Modify: `src/app/api/generate/route.ts` (`GET` 핸들러 추가 — 기존 `POST`는 유지)
- Modify: `src/lib/api-client.ts:117-131` (`generate.list` 추가)

**Interfaces:**
- Consumes: `toDto`의 필드 규칙(Task 1).
- Produces: `GenerationJobSummaryDto`; 서비스 `listJobs(): Promise<GenerationJobSummaryDto[]>`; `api.generate.list(): Promise<{ jobs: GenerationJobSummaryDto[] }>`.

- [ ] **Step 1: 요약 DTO 추가**

`src/lib/api-types.ts`의 `GenerationJobDto` 아래에 추가:

```ts
export interface GenerationJobSummaryDto {
  id: number;
  topicId: number;
  topicName: string;
  engine: GenerationEngineDto;
  verifyEngine: GenerationEngineDto;
  status: GenerationStatusDto;
  itemCount: number | null;
  savedCount: number;
  approvedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
}
```

- [ ] **Step 2: 서비스에 `toSummaryDto` + `listJobs` 추가**

`src/server/generation/generation-service.ts` 상단 import에 타입 추가:

```ts
import type {
  GenerationEngineDto,
  GenerationItemDto,
  GenerationJobDto,
  GenerationJobSummaryDto,
} from "@/lib/api-types";
```

`toDto` 아래에 추가 (Prisma가 반환하는 topic 조인 형태를 인라인 타입으로 받는다):

```ts
function toSummaryDto(
  job: GenerationJob & { topic: { name: string } },
): GenerationJobSummaryDto {
  const items = job.result as unknown as GenerationItemDto[] | null;
  return {
    id: job.id,
    topicId: job.topicId,
    topicName: job.topic.name,
    engine: job.engine,
    verifyEngine: job.verifyEngine,
    status: job.status,
    itemCount: job.status === "SUCCEEDED" && items ? items.length : null,
    savedCount: job.savedCount,
    approvedAt: job.approvedAt?.toISOString() ?? null,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

export async function listJobs(): Promise<GenerationJobSummaryDto[]> {
  const jobs = await prisma.generationJob.findMany({
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { topic: { select: { name: true } } },
  });
  return jobs.map(toSummaryDto);
}
```

- [ ] **Step 3: GET 라우트 추가**

`src/app/api/generate/route.ts`에 import과 핸들러 추가 (기존 POST 위/아래 어디든):

```ts
import { z } from "zod";
import { createJob, listJobs } from "@/server/generation/generation-service";
import { handleApiError, jsonOk, parseBody } from "@/server/http";

// ...기존 createSchema, POST...

export async function GET() {
  try {
    return jsonOk({ jobs: await listJobs() });
  } catch (e) {
    return handleApiError(e);
  }
}
```

- [ ] **Step 4: api-client에 list 추가**

`src/lib/api-client.ts`의 `generate` 객체에 `get` 아래로 추가:

```ts
    get: (id: number) =>
      request<{ job: GenerationJobDto }>(`/api/generate/${id}`),
    list: () =>
      request<{ jobs: GenerationJobSummaryDto[] }>("/api/generate"),
```

파일 상단 타입 import에 `GenerationJobSummaryDto`를 추가한다.

- [ ] **Step 5: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 오류 없음.

- [ ] **Step 6: 수동 검증**

브라우저 세션으로 `http://localhost:3000/api/generate` 열기(또는 `curl.exe -b cookie.txt http://localhost:3000/api/generate`). 응답이 `{ "jobs": [ ... ] }`이고 각 항목에 `topicName`, `status`, `itemCount`가 있는지 확인. 잡이 하나도 없으면 `{ "jobs": [] }`.

- [ ] **Step 7: 커밋**

```bash
git add src/lib/api-types.ts src/server/generation/generation-service.ts src/app/api/generate/route.ts src/lib/api-client.ts
git commit -m "$(printf 'feat: 생성 작업 목록 조회 API(GET /api/generate) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 3: 승인(저장) 엔드포인트 (서비스 + POST /api/generate/[id]/approve + api-client)

상세에서 선택한 인덱스만 받아, 서버가 `job.result`의 항목을 기존 import 경로로 저장하고 `approvedAt`·`savedCount`를 갱신한다.

**Files:**
- Modify: `src/server/generation/generation-service.ts` (`approveJob` 추가)
- Create: `src/app/api/generate/[id]/approve/route.ts`
- Modify: `src/lib/api-client.ts` (`generate.approve` 추가)

**Interfaces:**
- Consumes: `importQuestions(topicId: number, questions: ImportQuestion[]): Promise<number>` (`src/server/import-service.ts`); `toDto`(Task 1); `GenerationItemDto`(api-types).
- Produces: `approveJob(id: number, indices: number[]): Promise<{ savedCount: number; job: GenerationJobDto }>`; `api.generate.approve(id, indices): Promise<{ savedCount: number; job: GenerationJobDto }>`.

- [ ] **Step 1: 서비스에 `approveJob` 추가**

`src/server/generation/generation-service.ts` 상단 import에 추가:

```ts
import type { ImportQuestion } from "@/core/import-schema";
import { importQuestions } from "../import-service";
```

`getJob` 아래에 추가:

```ts
export async function approveJob(
  id: number,
  indices: number[],
): Promise<{ savedCount: number; job: GenerationJobDto }> {
  const job = await prisma.generationJob.findUnique({ where: { id } });
  if (!job) {
    throw new ServiceError("JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다", 404);
  }
  if (job.status !== "SUCCEEDED") {
    throw new ServiceError(
      "JOB_NOT_APPROVABLE",
      "완료된 작업만 저장할 수 있습니다",
      409,
    );
  }

  const items = job.result as unknown as GenerationItemDto[] | null;
  const byIndex = new Map(items?.map((item) => [item.index, item]) ?? []);
  const questions: ImportQuestion[] = [];
  for (const index of indices) {
    const item = byIndex.get(index);
    if (!item || !item.ok) {
      throw new ServiceError(
        "INVALID_ITEMS",
        "저장할 수 없는 항목이 포함되어 있습니다",
        400,
      );
    }
    questions.push(item.question as unknown as ImportQuestion);
  }
  if (questions.length === 0) {
    throw new ServiceError("INVALID_ITEMS", "저장할 항목이 없습니다", 400);
  }

  const savedCount = await importQuestions(job.topicId, questions);
  const updated = await prisma.generationJob.update({
    where: { id },
    data: { approvedAt: new Date(), savedCount: { increment: savedCount } },
  });
  return { savedCount, job: toDto(updated) };
}
```

- [ ] **Step 2: approve 라우트 생성**

Create `src/app/api/generate/[id]/approve/route.ts`:

```ts
import { z } from "zod";
import { approveJob } from "@/server/generation/generation-service";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";

const approveSchema = z.object({
  indices: z.array(z.number().int().nonnegative()).min(1).max(200),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { indices } = await parseBody(req, approveSchema);
    return jsonOk(await approveJob(parseIdParam(id), indices));
  } catch (e) {
    return handleApiError(e);
  }
}
```

- [ ] **Step 3: api-client에 approve 추가**

`src/lib/api-client.ts`의 `generate` 객체 `list` 아래에 추가:

```ts
    approve: (id: number, indices: number[]) =>
      request<{ savedCount: number; job: GenerationJobDto }>(
        `/api/generate/${id}/approve`,
        { method: "POST", body: JSON.stringify({ indices }) },
      ),
```

- [ ] **Step 4: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 오류 없음.

- [ ] **Step 5: 수동 검증**

`SUCCEEDED` 상태 잡 하나를 대상으로 (없으면 새로 생성해 완료시킨 뒤):
```bash
curl.exe -b cookie.txt -X POST http://localhost:3000/api/generate/<id>/approve \
  -H "Content-Type: application/json" -d "{\"indices\":[0]}"
```
Expected: `{ "savedCount": 1, "job": { ... "approvedAt": "<ISO>", "savedCount": 1 } }`.
`npx prisma studio`로 `question` 테이블에 해당 문제가 들어갔고 `generation_job.saved_count`가 증가했는지 확인. 무효 인덱스(`{"indices":[999]}`)는 400 `INVALID_ITEMS`.

- [ ] **Step 6: 커밋**

```bash
git add src/server/generation/generation-service.ts "src/app/api/generate/[id]/approve/route.ts" src/lib/api-client.ts
git commit -m "$(printf 'feat: 생성 결과 승인 저장 API(POST /api/generate/[id]/approve) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 4: 삭제 엔드포인트 (서비스 + DELETE /api/generate/[id] + api-client)

터미널 상태 잡을 삭제하고 온디스크 출력 디렉터리를 정리한다. 진행 중 잡은 거부한다.

**Files:**
- Modify: `src/server/generation/generation-service.ts` (`deleteJob` 추가)
- Modify: `src/app/api/generate/[id]/route.ts` (`DELETE` 추가 — 기존 `GET` 유지)
- Modify: `src/lib/api-client.ts` (`generate.remove` 추가)

**Interfaces:**
- Consumes: `jobOutputDir(jobId: number): string` (`./run-engine`, 이미 import됨).
- Produces: `deleteJob(id: number): Promise<void>`; `api.generate.remove(id): Promise<{ ok: true }>`.

- [ ] **Step 1: 서비스에 `deleteJob` 추가**

`src/server/generation/generation-service.ts` 상단 import에 추가:

```ts
import { rm } from "node:fs/promises";
```

`jobOutputDir`는 이미 `./run-engine`에서 import되어 있다(파일 상단 확인). `approveJob` 아래에 추가:

```ts
export async function deleteJob(id: number): Promise<void> {
  const job = await prisma.generationJob.findUnique({ where: { id } });
  if (!job) {
    throw new ServiceError("JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다", 404);
  }
  if (job.status === "RUNNING" || job.status === "VERIFYING") {
    throw new ServiceError(
      "JOB_RUNNING",
      "진행 중인 작업은 삭제할 수 없습니다",
      409,
    );
  }
  await prisma.generationJob.delete({ where: { id } });
  await rm(jobOutputDir(id), { recursive: true, force: true }).catch(() => {
    // 출력 디렉터리 정리는 best-effort — 실패해도 삭제는 완료된 것으로 본다.
  });
}
```

- [ ] **Step 2: DELETE 라우트 추가**

`src/app/api/generate/[id]/route.ts`에 import과 핸들러 추가:

```ts
import { deleteJob, getJob } from "@/server/generation/generation-service";
import { handleApiError, jsonOk, parseIdParam } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

// ...기존 GET...

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteJob(parseIdParam(id));
    return jsonOk({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
```

- [ ] **Step 3: api-client에 remove 추가**

`src/lib/api-client.ts`의 `generate` 객체 `approve` 아래에 추가:

```ts
    remove: (id: number) =>
      request<{ ok: true }>(`/api/generate/${id}`, { method: "DELETE" }),
```

- [ ] **Step 4: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 오류 없음.

- [ ] **Step 5: 수동 검증**

- 진행 중 잡: `curl.exe -b cookie.txt -X DELETE http://localhost:3000/api/generate/<running id>` → 409 `JOB_RUNNING`.
- 완료/실패 잡: `curl.exe -b cookie.txt -X DELETE http://localhost:3000/api/generate/<terminal id>` → `{ "ok": true }`. `npx prisma studio`로 행이 사라졌고, `generation_output/jobs/<id>/` 디렉터리도 없어졌는지 확인.

- [ ] **Step 6: 커밋**

```bash
git add src/server/generation/generation-service.ts "src/app/api/generate/[id]/route.ts" src/lib/api-client.ts
git commit -m "$(printf 'feat: 생성 작업 삭제 API(DELETE /api/generate/[id]) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 5: 상세·승인 페이지 (`/generate/[id]`)

진행 중이면 폴링, 완료면 미리보기+승인, 실패면 오류를 보여주는 상세 페이지를 새로 만든다. (이 시점까지 기존 `/generate` 단일 페이지는 그대로 동작한다 — 이 태스크는 새 라우트만 추가.)

**Files:**
- Create: `src/app/generate/[id]/page.tsx`

**Interfaces:**
- Consumes: `api.generate.get(id)`, `api.generate.approve(id, indices)` (Task 3); `QuestionPreview` (`@/components/QuestionPreview`); `GenerationJobDto`, `GenerationItemDto`, `ImportQuestion` 타입.

- [ ] **Step 1: 상세 페이지 작성**

먼저 `node_modules/next/dist/docs/`에서 App Router의 `useParams`/`useRouter`(from `next/navigation`) 사용법을 확인한다(AGENTS.md). 그런 다음 Create `src/app/generate/[id]/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import QuestionPreview from "@/components/QuestionPreview";
import type { ImportQuestion } from "@/core/import-schema";
import { api } from "@/lib/api-client";
import type { GenerationJobDto } from "@/lib/api-types";

const POLL_INTERVAL_MS = 3000;

function selectValidItems(job: GenerationJobDto): Set<number> {
  if (job.status !== "SUCCEEDED" || !job.items) return new Set<number>();
  return new Set(
    job.items
      .filter((item) => item.ok && item.verdict !== "fail")
      .map((item) => item.index),
  );
}

export default function GenerationDetailPage() {
  const params = useParams<{ id: string }>();
  const jobId = Number(params.id);

  const [job, setJob] = useState<GenerationJobDto | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const { job: loaded } = await api.generate.get(jobId);
        if (ignore) return;
        setJob(loaded);
        if (loaded.status === "SUCCEEDED") setSelected(selectValidItems(loaded));
      } catch (error) {
        if (!ignore) {
          setMessage(
            error instanceof Error ? error.message : "작업을 불러오지 못했습니다",
          );
        }
      }
    }
    void load();
    return () => {
      ignore = true;
    };
  }, [jobId]);

  const inProgress = job?.status === "RUNNING" || job?.status === "VERIFYING";

  useEffect(() => {
    if (!job || (job.status !== "RUNNING" && job.status !== "VERIFYING")) return;
    const startedAt = new Date(job.createdAt).getTime();
    const timer = setInterval(async () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
      try {
        const { job: next } = await api.generate.get(job.id);
        if (next.status !== job.status) {
          setJob(next);
          if (next.status === "SUCCEEDED") setSelected(selectValidItems(next));
        }
      } catch {
        // 폴링 일시 오류는 다음 주기에 재시도한다.
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [job]);

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function save() {
    if (!job || job.status !== "SUCCEEDED") return;
    if (selected.size === 0) return;
    if (job.approvedAt && !window.confirm("이미 저장한 작업입니다. 다시 저장할까요?")) {
      return;
    }
    setSaving(true);
    try {
      const { savedCount, job: updated } = await api.generate.approve(job.id, [
        ...selected,
      ]);
      setJob(updated);
      setMessage(`✅ ${savedCount}개 문제를 저장했습니다`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장에 실패했습니다");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app-page space-y-4">
      <div>
        <Link href="/generate" className="text-sm text-[color:var(--muted)] hover:text-[color:var(--text)]">
          ← 작업 목록
        </Link>
      </div>
      <h1 className="page-title">생성 작업 #{jobId}</h1>

      {job === null && !message && <p className="muted text-sm">불러오는 중...</p>}

      {inProgress && (
        <section className="surface surface-pad">
          <p className="text-sm">
            {job?.status === "VERIFYING"
              ? `검증 중... (경과 ${elapsed}초)`
              : `생성 중... (경과 ${elapsed}초)`}
          </p>
        </section>
      )}

      {job?.status === "FAILED" && (
        <section className="space-y-3">
          <p className="whitespace-pre-wrap break-all rounded-[12px] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] p-3 text-sm">
            ❌ 생성에 실패했습니다: {job.errorMessage}
          </p>
          <Link href="/generate/new" className="btn btn-secondary inline-block">
            다시 시도
          </Link>
        </section>
      )}

      {job?.status === "SUCCEEDED" && job.items && (
        <section className="space-y-3">
          <h2 className="section-title">미리보기 및 저장</h2>
          {job.approvedAt && (
            <p className="rounded-[12px] border border-[color:var(--warning)] bg-[color:var(--warning-soft)] p-3 text-sm">
              ⚠️ 이미 {job.savedCount}개 저장함 ({new Date(job.approvedAt).toLocaleString()})
            </p>
          )}
          {job.verifyWarning && (
            <p className="whitespace-pre-wrap break-all rounded-[12px] border border-[color:var(--warning)] bg-[color:var(--warning-soft)] p-3 text-sm">
              ⚠️ 검증을 수행하지 못했습니다: {job.verifyWarning}
            </p>
          )}
          {job.items.map((item) => (
            <div
              key={item.index}
              className={`surface surface-pad ${
                item.ok ? "" : "border-[color:var(--danger)] bg-[color:var(--danger-soft)]"
              }`}
            >
              <div className="mb-2 flex items-center gap-2 text-sm">
                <span className="subtle">#{item.index + 1}</span>
                {item.ok ? (
                  <>
                    <span className="chip">
                      {(item.question as ImportQuestion).type === "mcq" ? "객관식" : "빈칸"}
                    </span>
                    {item.verdict === "pass" && (
                      <span className="chip" style={{ color: "var(--success)" }}>✅ 검증 통과</span>
                    )}
                    {item.verdict === "fail" && (
                      <span className="chip" style={{ color: "var(--warning)" }}>⚠️ 검증 의견</span>
                    )}
                    {item.verdict === "unverified" && <span className="chip">검증 안 됨</span>}
                    <label className="ml-auto flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected.has(item.index)}
                        onChange={() => toggle(item.index)}
                      />
                      저장
                    </label>
                  </>
                ) : (
                  <span className="text-[color:var(--danger)]">오류</span>
                )}
              </div>
              {item.ok ? (
                <>
                  <QuestionPreview question={item.question as ImportQuestion} />
                  {item.verdict === "fail" && item.verdictComment && (
                    <p className="mt-2 whitespace-pre-wrap break-all rounded-[12px] border border-[color:var(--warning)] bg-[color:var(--warning-soft)] p-2 text-sm">
                      ⚠️ {item.verdictComment}
                    </p>
                  )}
                  {item.verdict === "pass" && item.verdictComment && (
                    <p className="subtle mt-2 text-xs">{item.verdictComment}</p>
                  )}
                </>
              ) : (
                <ul className="list-inside list-disc text-sm text-[color:var(--danger)]">
                  {item.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <button onClick={save} disabled={selected.size === 0 || saving} className="btn btn-success">
            {saving ? "저장 중..." : `선택한 ${selected.size}개 문제 저장`}
          </button>
        </section>
      )}

      {message && <p className="text-sm text-[color:var(--brand)]">{message}</p>}
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 오류 없음.

- [ ] **Step 3: 수동 검증 (브라우저)**

- 진행 중 잡 id로 `/generate/<id>` 접속 → "생성 중/검증 중... (경과 N초)"가 폴링으로 갱신되고, 완료되면 미리보기로 자동 전환.
- `SUCCEEDED` 잡 → 항목 체크박스 선택 후 저장 → "✅ N개 문제를 저장했습니다", 이후 상단에 "⚠️ 이미 N개 저장함" 배너 표시. 다시 저장 클릭 시 confirm 창.
- `FAILED` 잡 → 오류 메시지 + "다시 시도" 링크(→ `/generate/new`).

- [ ] **Step 4: 커밋**

```bash
git add "src/app/generate/[id]/page.tsx"
git commit -m "$(printf 'feat: 생성 작업 상세·승인 페이지(/generate/[id]) 추가\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 6: 생성 폼 페이지 (`/generate/new`)

현재 `/generate` 페이지의 입력부(주제·참고 자료·엔진·지시)를 새 폼 페이지로 옮기고, 시작하면 상세로 이동한다. (이 시점에도 기존 `/generate`는 아직 옛 단일 페이지 그대로 — Task 7에서 목록으로 교체.)

**Files:**
- Create: `src/app/generate/new/page.tsx`

**Interfaces:**
- Consumes: `api.topics.list()`, `api.topics.create()`, `api.topics.referenceFiles()`, `api.generate.create()`; `useRouter` (from `next/navigation`); 타입 `TopicDto`, `GenerationEngineDto`, `ReferenceFileListDto`.

- [ ] **Step 1: 폼 페이지 작성**

Create `src/app/generate/new/page.tsx` (현재 `src/app/generate/page.tsx`의 입력 섹션·주제 로딩·참고 자료 로딩·엔진 선택 로직을 그대로 옮기되, 폴링/미리보기/저장/localStorage는 제거하고 시작 성공 시 상세로 push):

```tsx
"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type {
  GenerationEngineDto,
  ReferenceFileListDto,
  TopicDto,
} from "@/lib/api-types";

const ENGINES: Array<{ value: GenerationEngineDto; label: string }> = [
  { value: "CLAUDE", label: "claude code" },
  { value: "CODEX", label: "codex" },
  { value: "ANTIGRAVITY", label: "antigravity" },
];

export default function GenerationNewPage() {
  const router = useRouter();
  const [topics, setTopics] = useState<TopicDto[]>([]);
  const [topicId, setTopicId] = useState<number | "">("");
  const [newTopicName, setNewTopicName] = useState("");
  const [engine, setEngine] = useState<GenerationEngineDto>("CLAUDE");
  const [verifyEngine, setVerifyEngine] = useState<GenerationEngineDto>("CODEX");
  const [verifyTouched, setVerifyTouched] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [refList, setRefList] = useState<ReferenceFileListDto | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState("");

  const selectedTopic = topics.find((topic) => topic.id === topicId);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const list = await api.topics.list();
        if (!ignore) setTopics(list);
      } catch (error) {
        if (!ignore) {
          setMessage(
            error instanceof Error ? error.message : "주제 목록을 불러오지 못했습니다",
          );
        }
      }
    }
    void load();
    return () => {
      ignore = true;
    };
  }, []);

  useEffect(() => {
    const topic = topics.find((item) => item.id === topicId);
    let ignore = false;
    async function loadReferenceFiles() {
      setRefList(null);
      setSelectedFiles(new Set());
      if (topicId === "" || !topic?.referenceDir) return;
      try {
        const list = await api.topics.referenceFiles(topicId);
        if (ignore) return;
        setRefList(list);
        setSelectedFiles(new Set(list.files.map((file) => file.path)));
      } catch {
        if (!ignore) setRefList({ files: [], dirExists: false });
      }
    }
    void loadReferenceFiles();
    return () => {
      ignore = true;
    };
  }, [topicId, topics]);

  function selectEngine(value: GenerationEngineDto) {
    setEngine(value);
    if (!verifyTouched) setVerifyEngine(value === "CLAUDE" ? "CODEX" : "CLAUDE");
  }

  function selectVerifyEngine(value: GenerationEngineDto) {
    setVerifyEngine(value);
    setVerifyTouched(true);
  }

  async function createTopic() {
    const name = newTopicName.trim();
    if (!name) return;
    try {
      const topic = await api.topics.create({ name });
      setTopics((prev) => [...prev, topic].sort((a, b) => a.name.localeCompare(b.name)));
      setTopicId(topic.id);
      setNewTopicName("");
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "주제 생성에 실패했습니다");
    }
  }

  function toggleFile(filePath: string) {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }

  async function startGeneration() {
    if (topicId === "" || starting) return;
    setStarting(true);
    setMessage("");
    try {
      const { job } = await api.generate.create({
        topicId,
        engine,
        verifyEngine,
        instructions,
        referenceFiles: selectedTopic?.referenceDir ? [...selectedFiles] : [],
      });
      router.push(`/generate/${job.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "생성 요청에 실패했습니다");
      setStarting(false);
    }
  }

  return (
    <div className="app-page space-y-4">
      <div className="page-header">
        <div>
          <h1 className="page-title">AI 문제 생성</h1>
          <p className="page-subtitle">
            생성 엔진에 문제 제작을 맡기고 결과를 검증해 문제은행에 저장합니다.
          </p>
        </div>
      </div>

      <section className="surface surface-pad space-y-3">
        <h2 className="section-title">주제 선택</h2>
        <select
          value={topicId}
          onChange={(event) => setTopicId(event.target.value ? Number(event.target.value) : "")}
          className="field"
        >
          <option value="">주제를 선택하세요</option>
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.name} ({topic.questionCount}문제)
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <input
            value={newTopicName}
            onChange={(event) => setNewTopicName(event.target.value)}
            placeholder="새 주제 이름"
            className="field min-w-0 flex-1"
          />
          <button
            onClick={createTopic}
            disabled={newTopicName.trim().length === 0}
            className="btn btn-secondary shrink-0"
          >
            추가
          </button>
        </div>
      </section>

      {selectedTopic?.referenceDir && (
        <section className="surface surface-pad space-y-3">
          <h2 className="section-title">참고 자료</h2>
          <p className="muted text-sm">
            generation_reference/{selectedTopic.referenceDir}/ — 선택한 파일을 에이전트가
            읽고 근거로 출제합니다
          </p>
          {refList === null ? (
            <p className="muted text-sm">파일 목록을 불러오는 중...</p>
          ) : !refList.dirExists || refList.files.length === 0 ? (
            <p className="text-sm text-[color:var(--warning)]">
              ⚠️ 참고 자료가 없습니다 — generation_reference/{selectedTopic.referenceDir}/ 에 md/txt 파일을 넣으세요
            </p>
          ) : (
            <div className="space-y-1">
              {refList.files.map((file) => (
                <label key={file.path} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedFiles.has(file.path)}
                    onChange={() => toggleFile(file.path)}
                  />
                  <span className="min-w-0 flex-1 break-all">{file.path}</span>
                  <span className="subtle shrink-0 text-xs">{(file.size / 1024).toFixed(1)} KB</span>
                </label>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="surface surface-pad space-y-3">
        <h2 className="section-title">엔진과 추가 지시</h2>
        <div className="flex flex-wrap gap-4">
          {ENGINES.map((item) => (
            <label key={item.value} className="chip gap-2">
              <input
                type="radio"
                name="engine"
                checked={engine === item.value}
                onChange={() => selectEngine(item.value)}
              />
              {item.label}
            </label>
          ))}
        </div>
        <div className="space-y-1">
          <p className="muted text-sm">검증 엔진 — 생성된 문제를 다른 CLI로 교차 검증합니다</p>
          <div className="flex flex-wrap gap-4">
            {ENGINES.map((item) => (
              <label key={item.value} className="chip gap-2">
                <input
                  type="radio"
                  name="verifyEngine"
                  checked={verifyEngine === item.value}
                  onChange={() => selectVerifyEngine(item.value)}
                />
                {item.label}
              </label>
            ))}
          </div>
        </div>
        <textarea
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          rows={4}
          placeholder="범위, 난이도, 문제 수 같은 조건 (예: 쉬운 난이도로 10문제)"
          className="textarea text-sm"
        />
      </section>

      <section className="surface surface-pad space-y-3">
        <h2 className="section-title">생성</h2>
        <button
          onClick={startGeneration}
          disabled={topicId === "" || starting}
          className="btn btn-primary"
        >
          {starting ? "시작하는 중..." : "생성 시작"}
        </button>
        {topicId === "" && (
          <p className="text-sm text-[color:var(--warning)]">주제를 먼저 선택하세요</p>
        )}
      </section>

      {message && <p className="text-sm text-[color:var(--brand)]">{message}</p>}
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크**

Run: `npx tsc --noEmit`
Expected: 오류 없음.

- [ ] **Step 3: 수동 검증 (브라우저)**

`/generate/new` 접속 → 주제 선택(참고 자료 있으면 파일 체크박스 표시) → 엔진·지시 입력 → "생성 시작" → 곧바로 `/generate/<새 id>` 상세로 이동하며 진행 표시가 뜨는지 확인.

- [ ] **Step 4: 커밋**

```bash
git add src/app/generate/new/page.tsx
git commit -m "$(printf 'feat: 생성 폼 페이지(/generate/new)로 입력부 분리\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

### Task 7: 작업 목록 페이지 (`/generate`) — 옛 단일 페이지 교체

`/generate`를 작업 목록으로 교체한다. 이 시점에 폼(Task 6)과 상세(Task 5)가 이미 있으므로, 옛 단일 페이지의 로직은 전부 대체된다.

**Files:**
- Modify (전면 교체): `src/app/generate/page.tsx`

**Interfaces:**
- Consumes: `api.generate.list()`, `api.generate.remove()` (Task 2·4); 타입 `GenerationJobSummaryDto`.

- [ ] **Step 1: 목록 페이지로 교체**

`src/app/generate/page.tsx` 전체 내용을 다음으로 교체:

```tsx
"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { GenerationJobSummaryDto } from "@/lib/api-types";

const POLL_INTERVAL_MS = 3000;

function statusBadge(job: GenerationJobSummaryDto): string {
  switch (job.status) {
    case "RUNNING":
      return "⏳ 생성 중";
    case "VERIFYING":
      return "⏳ 검증 중";
    case "SUCCEEDED":
      return job.approvedAt ? `✅ 저장됨 ${job.savedCount}개` : "✅ 완료 · 미저장";
    case "FAILED":
      return "❌ 실패";
  }
}

export default function GenerationListPage() {
  const [jobs, setJobs] = useState<GenerationJobSummaryDto[] | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let ignore = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function refresh() {
      try {
        const { jobs: list } = await api.generate.list();
        if (ignore) return;
        setJobs(list);
        const active = list.some(
          (job) => job.status === "RUNNING" || job.status === "VERIFYING",
        );
        if (!active && timer) {
          clearInterval(timer);
          timer = null;
        }
      } catch (error) {
        if (!ignore) {
          setMessage(
            error instanceof Error ? error.message : "작업 목록을 불러오지 못했습니다",
          );
        }
      }
    }

    void refresh().then(() => {
      if (ignore) return;
      timer = setInterval(refresh, POLL_INTERVAL_MS);
    });

    return () => {
      ignore = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  async function remove(id: number) {
    if (!window.confirm(`작업 #${id}을(를) 삭제할까요?`)) return;
    try {
      await api.generate.remove(id);
      setJobs((prev) => prev?.filter((job) => job.id !== id) ?? null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "삭제에 실패했습니다");
    }
  }

  return (
    <div className="app-page space-y-4">
      <div className="page-header flex items-center justify-between">
        <div>
          <h1 className="page-title">AI 생성 작업</h1>
          <p className="page-subtitle">생성 작업의 진행 상태를 확인하고 결과를 승인합니다.</p>
        </div>
        <Link href="/generate/new" className="btn btn-primary shrink-0">
          새 생성
        </Link>
      </div>

      {jobs === null && !message && <p className="muted text-sm">불러오는 중...</p>}

      {jobs !== null && jobs.length === 0 && (
        <p className="muted text-sm">아직 생성한 작업이 없습니다 — “새 생성”으로 시작하세요.</p>
      )}

      {jobs !== null && jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map((job) => (
            <div key={job.id} className="surface surface-pad flex items-center gap-3">
              <Link href={`/generate/${job.id}`} className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="subtle">#{job.id}</span>
                  <span className="font-bold">{job.topicName}</span>
                  <span className="chip">{job.engine}→{job.verifyEngine}</span>
                  <span className="chip">{statusBadge(job)}</span>
                  {job.status === "SUCCEEDED" && job.itemCount !== null && (
                    <span className="subtle text-xs">{job.itemCount}개 항목</span>
                  )}
                </div>
                <div className="subtle mt-1 text-xs">
                  {new Date(job.createdAt).toLocaleString()}
                  {job.status === "FAILED" && job.errorMessage && (
                    <span className="ml-2 break-all text-[color:var(--danger)]">
                      {job.errorMessage.slice(0, 80)}
                    </span>
                  )}
                </div>
              </Link>
              <button
                onClick={() => remove(job.id)}
                className="btn btn-secondary shrink-0"
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      )}

      {message && <p className="text-sm text-[color:var(--danger)]">{message}</p>}
    </div>
  );
}
```

- [ ] **Step 2: 타입 체크 + 빌드**

Run:
```bash
npx tsc --noEmit && npm run build
```
Expected: 타입 오류 없음, 빌드 성공. (옛 페이지에서 쓰던 `QuestionPreview`·localStorage 등은 상세/폼으로 옮겨졌으므로 미사용 import가 남지 않았는지 빌드가 잡아준다.)

- [ ] **Step 3: 수동 검증 (엔드투엔드, 브라우저)**

1. 네비 "AI 생성" → `/generate` 목록이 뜬다.
2. "새 생성" → `/generate/new` → 잡 시작 → `/generate/<id>` 상세로 이동, 진행 폴링.
3. 목록으로 돌아오면 해당 잡이 진행 배지로 보이고, 완료되면 3초 내 `✅ 완료 · 미저장`으로 자동 갱신.
4. 상세에서 승인 저장 → 목록에서 `✅ 저장됨 N개`로 바뀜.
5. 진행 중 잡 삭제 시 409 오류 메시지, 완료 잡 삭제 시 목록에서 사라짐.

- [ ] **Step 4: 커밋**

```bash
git add src/app/generate/page.tsx
git commit -m "$(printf 'feat: /generate를 작업 목록 페이지로 교체\n\nCo-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>')"
```

---

## 완료 기준 (전체 검증)

- `/generate` = 목록, `/generate/new` = 폼, `/generate/[id]` = 상세·승인으로 동작.
- 폼에서 시작하면 상세로 이동하고, 페이지를 벗어나도 목록에서 진행 상태를 추적할 수 있다.
- 상세에서 선택 항목을 승인하면 `import-service`를 통해 저장되고 `approvedAt`·`savedCount`가 기록되며 목록에 반영된다.
- 진행 중 잡은 삭제가 거부되고, 완료/실패 잡은 삭제 시 DB 행과 `generation_output/jobs/<id>/`가 정리된다.
- `npx tsc --noEmit`·`npm run build` 통과, 기존 core 테스트(`npm test`)는 변경 없이 통과.
```
