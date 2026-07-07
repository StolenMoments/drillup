# drillup 구현 계획 3/5 — 콘텐츠 관리 (API 클라이언트 · 주제 · 가져오기 · 문제 관리)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 주제 CRUD, LLM JSON 가져오기, 문제 관리(목록/수정/삭제)를 API와 화면까지 완성한다. 완료 시 문제 데이터를 앱에 넣고 관리할 수 있다.

**Architecture:** DTO 타입과 typed API 클라이언트를 먼저 전체 정의(이후 플랜의 계약 고정)하고, 서비스 → Route Handler → 화면 순으로 쌓는다.

**Tech Stack:** Next.js Route Handlers, Prisma, zod, React

## Global Constraints

`00-overview.md`의 Global Constraints를 반드시 먼저 읽고 준수할 것. 선행 조건: 플랜 1, 2 완료.

수동 검증 공통 준비: `npm run dev` 실행 중이어야 하고, 로그인 쿠키가 필요하다:

```bash
curl.exe -s -c cookies.txt -H "Content-Type: application/json" -d "{\"password\":\"dev-password\"}" http://localhost:3000/api/auth/login
```

---

### Task 1: DTO 타입 + API 클라이언트 (전체 정의)

**Files:**
- Create: `src/lib/api-types.ts`
- Create: `src/lib/api-client.ts`

**Interfaces:**
- Consumes: 없음 (타입 전용)
- Produces: 아래 두 파일의 모든 export — **이후 모든 플랜(3,4,5)의 프론트-백 계약이므로 시그니처를 임의로 바꾸지 말 것.** 학습/통계 API는 플랜 4·5에서 구현되지만 클라이언트 메서드는 지금 함께 정의한다(타입만 참조하므로 문제없음).

- [ ] **Step 1: DTO 타입 작성**

`src/lib/api-types.ts`:

```ts
// 프론트(화면)와 백(서비스)이 공유하는 DTO 타입.
// 프레임워크 의존성 없음 — 백엔드 분리 시 API 계약 문서 역할을 한다.

export type QuestionTypeDto = "MCQ" | "CLOZE";

export interface TopicDto {
  id: number;
  name: string;
  description: string | null;
  questionCount: number;
}

export interface QuestionListItemDto {
  id: number;
  topicId: number;
  type: QuestionTypeDto;
  /** 질문/설명문 앞 80자 */
  preview: string;
  attempts: number;
  correctCount: number;
  createdAt: string; // ISO 8601
}

export interface QuestionDetailDto {
  id: number;
  topicId: number;
  type: QuestionTypeDto;
  payload: unknown; // McqPayload | ClozePayload (core/types.ts)
  explanation: string | null;
}

/** 출제용 문제 — 정답 미포함 */
export type StudyQuestionDto =
  | { id: number; type: "MCQ"; question: string; choices: string[] }
  | {
      id: number;
      type: "CLOZE";
      text: string;
      blankIds: number[];
      /** 정답+오답 셔플 완료 상태 */
      wordBank: string[];
    };

export type ReviewAnswerDto =
  | { type: "MCQ"; selected_index: number }
  | { type: "CLOZE"; filled: Record<string, string> };

export interface SubmitReviewInput {
  questionId: number;
  mode: "SRS" | "PRACTICE";
  answer: ReviewAnswerDto;
}

export type CorrectAnswerDto =
  | { type: "MCQ"; answer_index: number }
  | { type: "CLOZE"; answers: Record<string, string> };

export interface ReviewResultDto {
  isCorrect: boolean;
  explanation: string | null;
  correct: CorrectAnswerDto;
}

export interface TopicStatsDto {
  id: number;
  name: string;
  total: number;
  unlearned: number;
  learning: number;
  mastered: number;
  dueCount: number;
}

export interface StatsOverviewDto {
  dueTotal: number;
  topics: TopicStatsDto[];
}
```

- [ ] **Step 2: API 클라이언트 작성**

`src/lib/api-client.ts`:

```ts
import type {
  QuestionDetailDto,
  QuestionListItemDto,
  ReviewResultDto,
  StatsOverviewDto,
  StudyQuestionDto,
  SubmitReviewInput,
  TopicDto,
} from "./api-types";

// 백엔드 분리 시 이 값만 바꾸면 된다 (기본: same-origin)
const BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "";

export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    credentials: "include",
  });
  if (
    res.status === 401 &&
    typeof window !== "undefined" &&
    !window.location.pathname.startsWith("/login")
  ) {
    window.location.href = "/login";
  }
  const body: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (body as { error?: { code?: string; message?: string } } | null)
      ?.error;
    throw new ApiError(
      err?.code ?? "UNKNOWN",
      err?.message ?? `요청 실패 (HTTP ${res.status})`,
      res.status,
    );
  }
  return body as T;
}

export const api = {
  auth: {
    login: (password: string) =>
      request<{ ok: true }>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ password }),
      }),
    logout: () => request<{ ok: true }>("/api/auth/logout", { method: "POST" }),
  },
  topics: {
    list: () => request<TopicDto[]>("/api/topics"),
    create: (input: { name: string; description?: string }) =>
      request<TopicDto>("/api/topics", {
        method: "POST",
        body: JSON.stringify(input),
      }),
    update: (id: number, input: { name?: string; description?: string }) =>
      request<TopicDto>(`/api/topics/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    remove: (id: number) =>
      request<{ ok: true }>(`/api/topics/${id}`, { method: "DELETE" }),
  },
  questions: {
    list: (topicId?: number) =>
      request<QuestionListItemDto[]>(
        `/api/questions${topicId ? `?topicId=${topicId}` : ""}`,
      ),
    get: (id: number) => request<QuestionDetailDto>(`/api/questions/${id}`),
    update: (id: number, input: { payload: unknown; explanation: string | null }) =>
      request<QuestionDetailDto>(`/api/questions/${id}`, {
        method: "PATCH",
        body: JSON.stringify(input),
      }),
    remove: (id: number) =>
      request<{ ok: true }>(`/api/questions/${id}`, { method: "DELETE" }),
  },
  import: {
    submit: (topicId: number, questions: unknown[]) =>
      request<{ savedCount: number }>("/api/import", {
        method: "POST",
        body: JSON.stringify({ topicId, questions }),
      }),
  },
  study: {
    queue: (mode: "srs" | "practice", topicId?: number) =>
      request<StudyQuestionDto[]>(
        `/api/study/queue?mode=${mode}${topicId ? `&topicId=${topicId}` : ""}`,
      ),
    submitReview: (input: SubmitReviewInput) =>
      request<ReviewResultDto>("/api/reviews", {
        method: "POST",
        body: JSON.stringify(input),
      }),
  },
  stats: {
    overview: () => request<StatsOverviewDto>("/api/stats/overview"),
  },
};
```

- [ ] **Step 3: 타입 검사 확인**

```bash
npx tsc --noEmit
```

Expected: 오류 없음.

- [ ] **Step 4: 커밋**

```bash
git add src/lib/api-types.ts src/lib/api-client.ts
git commit -m "feat: DTO 타입 및 typed API 클라이언트(전체 계약 정의)"
```

---

### Task 2: 주제 서비스 + API

**Files:**
- Create: `src/server/topic-service.ts`
- Create: `src/app/api/topics/route.ts`
- Create: `src/app/api/topics/[id]/route.ts`
- Modify: `src/server/http.ts` (parseIdParam 추가)

**Interfaces:**
- Consumes: `prisma`(01), `ServiceError`/`http.ts`(01), `TopicDto`(Task 1)
- Produces:
  - `listTopics(): Promise<TopicDto[]>`
  - `createTopic(input: { name: string; description?: string }): Promise<TopicDto>` — 이름 중복 시 `ServiceError("DUPLICATE", ..., 409)`
  - `updateTopic(id: number, input: { name?: string; description?: string }): Promise<TopicDto>`
  - `deleteTopic(id: number): Promise<void>` — 소속 문제 cascade 삭제(DB FK)
  - `parseIdParam(raw: string): number` — http.ts에 추가
  - REST: `GET/POST /api/topics`, `PATCH/DELETE /api/topics/:id`

- [ ] **Step 1: http.ts에 parseIdParam 추가**

`src/server/http.ts` 끝에 추가:

```ts
export function parseIdParam(raw: string): number {
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) {
    throw new ServiceError("BAD_REQUEST", "잘못된 id입니다", 400);
  }
  return id;
}
```

- [ ] **Step 2: 주제 서비스 작성**

`src/server/topic-service.ts`:

```ts
import type { TopicDto } from "@/lib/api-types";
import { prisma } from "./db";
import { ServiceError } from "./errors";

function toDto(topic: {
  id: number;
  name: string;
  description: string | null;
  _count: { questions: number };
}): TopicDto {
  return {
    id: topic.id,
    name: topic.name,
    description: topic.description,
    questionCount: topic._count.questions,
  };
}

const withCount = { _count: { select: { questions: true } } } as const;

export async function listTopics(): Promise<TopicDto[]> {
  const topics = await prisma.topic.findMany({
    include: withCount,
    orderBy: { name: "asc" },
  });
  return topics.map(toDto);
}

export async function createTopic(input: {
  name: string;
  description?: string;
}): Promise<TopicDto> {
  const existing = await prisma.topic.findUnique({
    where: { name: input.name },
  });
  if (existing) {
    throw new ServiceError("DUPLICATE", "이미 존재하는 주제 이름입니다", 409);
  }
  const topic = await prisma.topic.create({
    data: { name: input.name, description: input.description ?? null },
    include: withCount,
  });
  return toDto(topic);
}

export async function updateTopic(
  id: number,
  input: { name?: string; description?: string },
): Promise<TopicDto> {
  const existing = await prisma.topic.findUnique({ where: { id } });
  if (!existing) throw new ServiceError("NOT_FOUND", "주제를 찾을 수 없습니다", 404);
  const topic = await prisma.topic.update({
    where: { id },
    data: input,
    include: withCount,
  });
  return toDto(topic);
}

export async function deleteTopic(id: number): Promise<void> {
  const existing = await prisma.topic.findUnique({ where: { id } });
  if (!existing) throw new ServiceError("NOT_FOUND", "주제를 찾을 수 없습니다", 404);
  await prisma.topic.delete({ where: { id } });
}
```

- [ ] **Step 3: Route Handler 작성**

`src/app/api/topics/route.ts`:

```ts
import { z } from "zod";
import { handleApiError, jsonOk, parseBody } from "@/server/http";
import { createTopic, listTopics } from "@/server/topic-service";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().optional(),
});

export async function GET() {
  try {
    return jsonOk(await listTopics());
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const input = await parseBody(req, createSchema);
    return jsonOk(await createTopic(input), 201);
  } catch (e) {
    return handleApiError(e);
  }
}
```

`src/app/api/topics/[id]/route.ts`:

```ts
import { z } from "zod";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";
import { deleteTopic, updateTopic } from "@/server/topic-service";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().optional(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const input = await parseBody(req, updateSchema);
    return jsonOk(await updateTopic(parseIdParam(id), input));
  } catch (e) {
    return handleApiError(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteTopic(parseIdParam(id));
    return jsonOk({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
```

- [ ] **Step 4: 수동 검증**

```bash
curl.exe -s -b cookies.txt -H "Content-Type: application/json" -d "{\"name\":\"네트워크\"}" http://localhost:3000/api/topics
```

Expected: `{"id":1,"name":"네트워크","description":null,"questionCount":0}`

```bash
curl.exe -s -b cookies.txt http://localhost:3000/api/topics
```

Expected: 위 주제가 포함된 배열.

같은 이름으로 다시 POST → `409` + `DUPLICATE` 오류 확인.

- [ ] **Step 5: 커밋**

```bash
git add -A
git commit -m "feat: 주제 CRUD 서비스 및 API"
```

---

### Task 3: 문제 서비스 + API (목록/조회/수정/삭제)

**Files:**
- Create: `src/server/question-service.ts`
- Create: `src/app/api/questions/route.ts`
- Create: `src/app/api/questions/[id]/route.ts`

**Interfaces:**
- Consumes: `prisma`, `ServiceError`, `http.ts`, `QuestionListItemDto`/`QuestionDetailDto`(Task 1), `mcqPayloadSchema`/`clozePayloadSchema`(플랜 2)
- Produces:
  - `listQuestions(topicId?: number): Promise<QuestionListItemDto[]>`
  - `getQuestion(id: number): Promise<QuestionDetailDto>`
  - `updateQuestion(id: number, input: { payload: unknown; explanation: string | null }): Promise<QuestionDetailDto>` — 기존 문제의 type에 맞는 payload 스키마로 검증, 실패 시 400
  - `deleteQuestion(id: number): Promise<void>`
  - REST: `GET /api/questions?topicId=`, `GET/PATCH/DELETE /api/questions/:id`

- [ ] **Step 1: 문제 서비스 작성**

`src/server/question-service.ts`:

```ts
import type { ClozePayload, McqPayload } from "@/core/types";
import {
  clozePayloadSchema,
  mcqPayloadSchema,
} from "@/core/import-schema";
import type {
  QuestionDetailDto,
  QuestionListItemDto,
} from "@/lib/api-types";
import { prisma } from "./db";
import { ServiceError } from "./errors";

function previewOf(type: "MCQ" | "CLOZE", payload: unknown): string {
  const text =
    type === "MCQ"
      ? (payload as unknown as McqPayload).question
      : (payload as unknown as ClozePayload).text;
  return text.length > 80 ? `${text.slice(0, 80)}…` : text;
}

export async function listQuestions(
  topicId?: number,
): Promise<QuestionListItemDto[]> {
  const questions = await prisma.question.findMany({
    where: topicId ? { topicId } : undefined,
    include: { reviewLogs: { select: { isCorrect: true } } },
    orderBy: { id: "desc" },
  });
  return questions.map((q) => ({
    id: q.id,
    topicId: q.topicId,
    type: q.type,
    preview: previewOf(q.type, q.payload),
    attempts: q.reviewLogs.length,
    correctCount: q.reviewLogs.filter((l) => l.isCorrect).length,
    createdAt: q.createdAt.toISOString(),
  }));
}

export async function getQuestion(id: number): Promise<QuestionDetailDto> {
  const q = await prisma.question.findUnique({ where: { id } });
  if (!q) throw new ServiceError("NOT_FOUND", "문제를 찾을 수 없습니다", 404);
  return {
    id: q.id,
    topicId: q.topicId,
    type: q.type,
    payload: q.payload,
    explanation: q.explanation,
  };
}

export async function updateQuestion(
  id: number,
  input: { payload: unknown; explanation: string | null },
): Promise<QuestionDetailDto> {
  const existing = await prisma.question.findUnique({ where: { id } });
  if (!existing) throw new ServiceError("NOT_FOUND", "문제를 찾을 수 없습니다", 404);

  const schema =
    existing.type === "MCQ" ? mcqPayloadSchema : clozePayloadSchema;
  const parsed = schema.safeParse(input.payload);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join("; ");
    throw new ServiceError("VALIDATION", `payload가 유효하지 않습니다 — ${detail}`, 400);
  }

  const q = await prisma.question.update({
    where: { id },
    data: { payload: parsed.data, explanation: input.explanation },
  });
  return {
    id: q.id,
    topicId: q.topicId,
    type: q.type,
    payload: q.payload,
    explanation: q.explanation,
  };
}

export async function deleteQuestion(id: number): Promise<void> {
  const existing = await prisma.question.findUnique({ where: { id } });
  if (!existing) throw new ServiceError("NOT_FOUND", "문제를 찾을 수 없습니다", 404);
  await prisma.question.delete({ where: { id } });
}
```

- [ ] **Step 2: Route Handler 작성**

`src/app/api/questions/route.ts`:

```ts
import { handleApiError, jsonOk } from "@/server/http";
import { listQuestions } from "@/server/question-service";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const topicIdRaw = url.searchParams.get("topicId");
    const topicId = topicIdRaw ? Number(topicIdRaw) : undefined;
    return jsonOk(await listQuestions(topicId));
  } catch (e) {
    return handleApiError(e);
  }
}
```

`src/app/api/questions/[id]/route.ts`:

```ts
import { z } from "zod";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";
import {
  deleteQuestion,
  getQuestion,
  updateQuestion,
} from "@/server/question-service";

const updateSchema = z.object({
  payload: z.unknown(),
  explanation: z.string().nullable(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    return jsonOk(await getQuestion(parseIdParam(id)));
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const input = await parseBody(req, updateSchema);
    return jsonOk(
      await updateQuestion(parseIdParam(id), {
        payload: input.payload,
        explanation: input.explanation,
      }),
    );
  } catch (e) {
    return handleApiError(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteQuestion(parseIdParam(id));
    return jsonOk({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
```

- [ ] **Step 3: 수동 검증**

아직 문제가 없으므로 빈 배열 확인:

```bash
curl.exe -s -b cookies.txt http://localhost:3000/api/questions
```

Expected: `[]`

존재하지 않는 문제 조회:

```bash
curl.exe -s -b cookies.txt http://localhost:3000/api/questions/999
```

Expected: `404` + `{"error":{"code":"NOT_FOUND","message":"문제를 찾을 수 없습니다"}}`

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "feat: 문제 목록/조회/수정/삭제 서비스 및 API"
```

---

### Task 4: 가져오기(import) 서비스 + API

**Files:**
- Create: `src/server/import-service.ts`
- Create: `src/app/api/import/route.ts`

**Interfaces:**
- Consumes: `validateImportQuestions`, `ImportQuestion`(플랜 2), `prisma`, `ServiceError`, `http.ts`
- Produces:
  - `importQuestions(topicId: number, questions: ImportQuestion[]): Promise<number>` — 트랜잭션으로 question + srs_state(기본값) 생성, 저장 개수 반환
  - REST: `POST /api/import` `{ topicId, questions: unknown[] }` → 201 `{ savedCount }`; 무효 문제가 하나라도 있으면 400 (클라이언트가 유효한 것만 골라 보내는 계약)

- [ ] **Step 1: import 서비스 작성**

`src/server/import-service.ts`:

```ts
import type { ImportQuestion } from "@/core/import-schema";
import { prisma } from "./db";
import { ServiceError } from "./errors";

function toPayload(q: ImportQuestion) {
  if (q.type === "mcq") {
    return {
      question: q.question,
      choices: q.choices,
      answer_index: q.answer_index,
    };
  }
  return { text: q.text, blanks: q.blanks, distractors: q.distractors };
}

export async function importQuestions(
  topicId: number,
  questions: ImportQuestion[],
): Promise<number> {
  const topic = await prisma.topic.findUnique({ where: { id: topicId } });
  if (!topic) throw new ServiceError("NOT_FOUND", "주제를 찾을 수 없습니다", 404);

  await prisma.$transaction(
    questions.map((q) =>
      prisma.question.create({
        data: {
          topicId,
          type: q.type === "mcq" ? "MCQ" : "CLOZE",
          payload: toPayload(q),
          explanation: q.explanation?.trim() ? q.explanation.trim() : null,
          srsState: { create: {} }, // SRS 기본값(EF 2.5, due 즉시)
        },
      }),
    ),
  );
  return questions.length;
}
```

- [ ] **Step 2: Route Handler 작성**

`src/app/api/import/route.ts`:

```ts
import { z } from "zod";
import {
  validateImportQuestions,
  type ImportItemResult,
} from "@/core/import-schema";
import { ServiceError } from "@/server/errors";
import { handleApiError, jsonOk, parseBody } from "@/server/http";
import { importQuestions } from "@/server/import-service";

const bodySchema = z.object({
  topicId: z.number().int().positive(),
  questions: z.array(z.unknown()).min(1),
});

export async function POST(req: Request) {
  try {
    const body = await parseBody(req, bodySchema);
    const results = validateImportQuestions(body.questions);
    const invalid = results.filter((r) => !r.ok);
    if (invalid.length > 0) {
      throw new ServiceError(
        "VALIDATION",
        `유효하지 않은 문제가 포함되어 있습니다 (index: ${invalid
          .map((r) => r.index)
          .join(", ")})`,
        400,
      );
    }
    const valid = results
      .filter((r): r is Extract<ImportItemResult, { ok: true }> => r.ok)
      .map((r) => r.question);
    const savedCount = await importQuestions(body.topicId, valid);
    return jsonOk({ savedCount }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
```

- [ ] **Step 3: 수동 검증**

요청 본문 파일 작성이 편하다. 프로젝트 루트에 `tmp-import.json` 생성(검증 후 삭제):

```json
{
  "topicId": 1,
  "questions": [
    {
      "type": "mcq",
      "question": "OSI 7계층에서 라우팅을 담당하는 계층은?",
      "choices": ["물리 계층", "데이터링크 계층", "네트워크 계층", "전송 계층"],
      "answer_index": 2,
      "explanation": "라우팅은 네트워크 계층(L3)의 역할이다."
    },
    {
      "type": "cloze",
      "text": "TCP는 {{1}} 지향 프로토콜로, {{2}} 핸드셰이크로 연결을 수립한다.",
      "blanks": [
        { "id": 1, "answer": "연결" },
        { "id": 2, "answer": "3-way" }
      ],
      "distractors": ["비연결", "4-way"],
      "explanation": "TCP는 연결 지향이며 3-way 핸드셰이크를 사용한다."
    }
  ]
}
```

```bash
curl.exe -s -b cookies.txt -H "Content-Type: application/json" -d "@tmp-import.json" http://localhost:3000/api/import
```

Expected: `{"savedCount":2}`

```bash
curl.exe -s -b cookies.txt http://localhost:3000/api/questions
```

Expected: 2개 문제가 담긴 배열 (`attempts: 0`).

srs_state 생성 확인 — `npx prisma studio` 실행 후 브라우저(http://localhost:5555)에서
`SrsState` 모델 열기:

Expected: 2행, `easeFactor 2.5`, `intervalDays 0`, `dueAt`은 현재 시각. 확인 후 Studio 종료(Ctrl+C).

확인 후 `tmp-import.json` 삭제.

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "feat: LLM JSON 가져오기 서비스 및 API"
```

---

### Task 5: 가져오기 화면

**Files:**
- Create: `src/app/import/page.tsx`

**Interfaces:**
- Consumes: `api`(Task 1), `parseImportJson`/`ImportParseResult`/`buildGenerationPrompt`(플랜 2), `TopicDto`
- Produces: `/import` 화면 — 주제 선택/생성 → 프롬프트 복사 → JSON 붙여넣기 → 검증(문제 단위 오류 표시) → 유효 문제 선택 저장

- [ ] **Step 1: 화면 작성**

`src/app/import/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import {
  parseImportJson,
  type ImportItemResult,
  type ImportParseResult,
  type ImportQuestion,
} from "@/core/import-schema";
import { buildGenerationPrompt } from "@/core/prompt-template";
import { api } from "@/lib/api-client";
import type { TopicDto } from "@/lib/api-types";

function QuestionPreview({ question }: { question: ImportQuestion }) {
  if (question.type === "mcq") {
    return (
      <div className="space-y-1">
        <p>{question.question}</p>
        <ul className="space-y-0.5 text-sm">
          {question.choices.map((choice, i) => (
            <li
              key={i}
              className={
                i === question.answer_index
                  ? "font-semibold text-emerald-400"
                  : "text-slate-400"
              }
            >
              {i + 1}. {choice}
              {i === question.answer_index && " ✓"}
            </li>
          ))}
        </ul>
      </div>
    );
  }
  const filledText = question.text.replace(/\{\{(\d+)\}\}/g, (_, id) => {
    const blank = question.blanks.find((b) => b.id === Number(id));
    return `[${blank?.answer ?? "?"}]`;
  });
  return (
    <div className="space-y-1">
      <p>{filledText}</p>
      <p className="text-sm text-slate-400">
        오답 단어: {question.distractors.join(", ")}
      </p>
    </div>
  );
}

export default function ImportPage() {
  const [topics, setTopics] = useState<TopicDto[]>([]);
  const [topicId, setTopicId] = useState<number | "">("");
  const [newTopicName, setNewTopicName] = useState("");
  const [rawJson, setRawJson] = useState("");
  const [parsed, setParsed] = useState<ImportParseResult | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.topics.list().then(setTopics).catch(() => setMessage("주제 목록을 불러오지 못했습니다"));
  }, []);

  const selectedTopic = topics.find((t) => t.id === topicId);

  async function createTopic() {
    const name = newTopicName.trim();
    if (!name) return;
    try {
      const topic = await api.topics.create({ name });
      setTopics((prev) =>
        [...prev, topic].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setTopicId(topic.id);
      setNewTopicName("");
      setMessage("");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "주제 생성에 실패했습니다");
    }
  }

  async function copyPrompt() {
    if (!selectedTopic) return;
    await navigator.clipboard.writeText(
      buildGenerationPrompt(selectedTopic.name),
    );
    setMessage("프롬프트를 클립보드에 복사했습니다. LLM 채팅에 붙여넣어 사용하세요.");
  }

  function validate() {
    const result = parseImportJson(rawJson);
    setParsed(result);
    setMessage("");
    if (result.ok) {
      setSelected(
        new Set(result.items.filter((i) => i.ok).map((i) => i.index)),
      );
    }
  }

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function save() {
    if (!parsed?.ok || topicId === "" || selected.size === 0) return;
    const questions = parsed.items
      .filter((i): i is Extract<ImportItemResult, { ok: true }> => i.ok)
      .filter((i) => selected.has(i.index))
      .map((i) => i.question);
    setSaving(true);
    try {
      const { savedCount } = await api.import.submit(topicId, questions);
      setMessage(`${savedCount}개 문제를 저장했습니다`);
      setParsed(null);
      setRawJson("");
      setSelected(new Set());
      api.topics.list().then(setTopics);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "저장에 실패했습니다");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">문제 가져오기</h1>

      <section className="space-y-2">
        <h2 className="font-semibold">1. 주제 선택</h2>
        <select
          value={topicId}
          onChange={(e) =>
            setTopicId(e.target.value ? Number(e.target.value) : "")
          }
          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
        >
          <option value="">주제를 선택하세요</option>
          {topics.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.questionCount}문제)
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <input
            value={newTopicName}
            onChange={(e) => setNewTopicName(e.target.value)}
            placeholder="새 주제 이름"
            className="flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2"
          />
          <button
            onClick={createTopic}
            disabled={newTopicName.trim().length === 0}
            className="rounded bg-slate-700 px-4 py-2 disabled:opacity-50"
          >
            주제 추가
          </button>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">2. LLM 프롬프트 복사</h2>
        <button
          onClick={copyPrompt}
          disabled={!selectedTopic}
          className="rounded bg-slate-700 px-4 py-2 disabled:opacity-50"
        >
          프롬프트 복사
        </button>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">3. 생성된 JSON 붙여넣기</h2>
        <textarea
          value={rawJson}
          onChange={(e) => setRawJson(e.target.value)}
          rows={10}
          placeholder='{"questions": [...]}'
          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm"
        />
        <button
          onClick={validate}
          disabled={rawJson.trim().length === 0}
          className="rounded bg-sky-600 px-4 py-2 font-semibold disabled:opacity-50"
        >
          검증
        </button>
      </section>

      {parsed && !parsed.ok && (
        <p className="rounded border border-red-800 bg-red-950 p-3 text-red-300">
          {parsed.fatal}
        </p>
      )}

      {parsed?.ok && (
        <section className="space-y-3">
          <h2 className="font-semibold">4. 미리보기 및 저장</h2>
          {parsed.items.map((item) => (
            <div
              key={item.index}
              className={`rounded border p-3 ${
                item.ok ? "border-slate-700" : "border-red-800 bg-red-950/50"
              }`}
            >
              <div className="mb-1 flex items-center gap-2 text-sm">
                <span className="text-slate-500">#{item.index + 1}</span>
                {item.ok ? (
                  <>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">
                      {item.question.type === "mcq" ? "객관식" : "빈칸"}
                    </span>
                    <label className="ml-auto flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={selected.has(item.index)}
                        onChange={() => toggle(item.index)}
                      />
                      저장
                    </label>
                  </>
                ) : (
                  <span className="text-red-400">오류</span>
                )}
              </div>
              {item.ok ? (
                <QuestionPreview question={item.question} />
              ) : (
                <ul className="list-inside list-disc text-sm text-red-300">
                  {item.errors.map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <button
            onClick={save}
            disabled={topicId === "" || selected.size === 0 || saving}
            className="rounded bg-emerald-600 px-4 py-2 font-semibold disabled:opacity-50"
          >
            {saving ? "저장 중…" : `선택한 ${selected.size}개 문제 저장`}
          </button>
          {topicId === "" && (
            <p className="text-sm text-amber-400">주제를 먼저 선택하세요.</p>
          )}
        </section>
      )}

      {message && <p className="text-sm text-sky-300">{message}</p>}
    </div>
  );
}
```

- [ ] **Step 2: 수동 검증**

`npm run dev` 상태에서 브라우저 `/import`:

1. "새 주제 이름"에 `운영체제` 입력 → 주제 추가 → 셀렉트에 선택됨
2. "프롬프트 복사" 클릭 → 클립보드에 프롬프트 (메모장에 붙여넣어 내용 확인)
3. Task 4의 `tmp-import.json`에서 `questions` 배열 부분(`{"questions":[...]}`)을 텍스트 영역에 붙여넣고 "검증" → 문제 2개 미리보기(객관식 정답에 ✓, 빈칸은 [정답] 표시)
4. 일부러 `answer_index`를 9로 바꿔 다시 검증 → 해당 문제만 빨간 오류 카드, 나머지는 정상
5. 유효 문제만 선택된 상태에서 저장 → "n개 문제를 저장했습니다"

- [ ] **Step 3: 커밋**

```bash
git add src/app/import/page.tsx
git commit -m "feat: 가져오기 화면(프롬프트 복사/검증/미리보기/저장)"
```

---

### Task 6: 문제 관리 화면 (목록 + 수정)

**Files:**
- Create: `src/app/questions/page.tsx`
- Create: `src/app/questions/[id]/page.tsx`

**Interfaces:**
- Consumes: `api`, `TopicDto`, `QuestionListItemDto`, `QuestionDetailDto`
- Produces: `/questions` 목록 화면(주제 필터, 정답률, 삭제, 주제 이름변경/삭제), `/questions/:id` 수정 화면(payload JSON 편집, 해설 편집)

- [ ] **Step 1: 목록 화면 작성**

`src/app/questions/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { QuestionListItemDto, TopicDto } from "@/lib/api-types";

export default function QuestionsPage() {
  const [topics, setTopics] = useState<TopicDto[]>([]);
  const [topicId, setTopicId] = useState<number | "">("");
  const [questions, setQuestions] = useState<QuestionListItemDto[]>([]);
  const [message, setMessage] = useState("");

  const reload = useCallback(async (selectedTopicId: number | "") => {
    const [topicList, questionList] = await Promise.all([
      api.topics.list(),
      api.questions.list(selectedTopicId === "" ? undefined : selectedTopicId),
    ]);
    setTopics(topicList);
    setQuestions(questionList);
  }, []);

  useEffect(() => {
    reload(topicId).catch(() => setMessage("목록을 불러오지 못했습니다"));
  }, [topicId, reload]);

  async function removeQuestion(id: number) {
    if (!window.confirm("이 문제를 삭제할까요?")) return;
    await api.questions.remove(id);
    reload(topicId);
  }

  async function renameTopic() {
    if (topicId === "") return;
    const current = topics.find((t) => t.id === topicId);
    const name = window.prompt("새 주제 이름", current?.name ?? "");
    if (!name?.trim()) return;
    try {
      await api.topics.update(topicId, { name: name.trim() });
      reload(topicId);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "이름 변경 실패");
    }
  }

  async function removeTopic() {
    if (topicId === "") return;
    if (
      !window.confirm(
        "주제와 소속 문제가 모두 삭제됩니다. 계속할까요?",
      )
    )
      return;
    await api.topics.remove(topicId);
    setTopicId("");
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">문제 관리</h1>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={topicId}
          onChange={(e) =>
            setTopicId(e.target.value ? Number(e.target.value) : "")
          }
          className="rounded border border-slate-700 bg-slate-900 px-3 py-2"
        >
          <option value="">전체 주제</option>
          {topics.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name} ({t.questionCount})
            </option>
          ))}
        </select>
        {topicId !== "" && (
          <>
            <button
              onClick={renameTopic}
              className="rounded bg-slate-700 px-3 py-2 text-sm"
            >
              주제 이름변경
            </button>
            <button
              onClick={removeTopic}
              className="rounded bg-red-800 px-3 py-2 text-sm"
            >
              주제 삭제
            </button>
          </>
        )}
      </div>

      {message && <p className="text-sm text-red-300">{message}</p>}

      {questions.length === 0 ? (
        <p className="text-slate-400">문제가 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {questions.map((q) => (
            <li
              key={q.id}
              className="flex items-center gap-3 rounded border border-slate-800 p-3"
            >
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">
                {q.type === "MCQ" ? "객관식" : "빈칸"}
              </span>
              <span className="min-w-0 flex-1 truncate">{q.preview}</span>
              <span className="shrink-0 text-sm text-slate-400">
                {q.attempts === 0
                  ? "미풀이"
                  : `${Math.round((q.correctCount / q.attempts) * 100)}% (${q.correctCount}/${q.attempts})`}
              </span>
              <Link
                href={`/questions/${q.id}`}
                className="shrink-0 text-sm text-sky-400"
              >
                수정
              </Link>
              <button
                onClick={() => removeQuestion(q.id)}
                className="shrink-0 text-sm text-red-400"
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 수정 화면 작성**

`src/app/questions/[id]/page.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api-client";

export default function QuestionEditPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();

  const [payloadText, setPayloadText] = useState("");
  const [explanation, setExplanation] = useState("");
  const [type, setType] = useState<"MCQ" | "CLOZE" | null>(null);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.questions
      .get(id)
      .then((q) => {
        setPayloadText(JSON.stringify(q.payload, null, 2));
        setExplanation(q.explanation ?? "");
        setType(q.type);
        setLoaded(true);
      })
      .catch(() => setMessage("문제를 불러오지 못했습니다"));
  }, [id]);

  async function save() {
    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      setMessage("payload가 올바른 JSON이 아닙니다");
      return;
    }
    try {
      await api.questions.update(id, {
        payload,
        explanation: explanation.trim() ? explanation.trim() : null,
      });
      router.push("/questions");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "저장에 실패했습니다");
    }
  }

  if (!loaded) return <p className="text-slate-400">{message || "불러오는 중…"}</p>;

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">
        문제 수정 #{id}{" "}
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-sm font-normal">
          {type === "MCQ" ? "객관식" : "빈칸"}
        </span>
      </h1>
      <div className="space-y-1">
        <label className="text-sm text-slate-400">payload (JSON)</label>
        <textarea
          value={payloadText}
          onChange={(e) => setPayloadText(e.target.value)}
          rows={14}
          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm"
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm text-slate-400">해설</label>
        <textarea
          value={explanation}
          onChange={(e) => setExplanation(e.target.value)}
          rows={3}
          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
        />
      </div>
      {message && <p className="text-sm text-red-300">{message}</p>}
      <div className="flex gap-2">
        <button
          onClick={save}
          className="rounded bg-sky-600 px-4 py-2 font-semibold"
        >
          저장
        </button>
        <button
          onClick={() => router.push("/questions")}
          className="rounded bg-slate-700 px-4 py-2"
        >
          취소
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 수동 검증**

브라우저에서:

1. `/questions` → 가져온 문제들이 목록에 보임, 주제 필터 동작
2. 문제 "수정" → payload JSON 표시 → 보기 하나를 고쳐 저장 → 목록 복귀 → 다시 열어 반영 확인
3. payload의 `answer_index`를 9로 고쳐 저장 → "payload가 유효하지 않습니다 …" 오류 표시
4. 문제 "삭제" → confirm 후 목록에서 사라짐

- [ ] **Step 4: 빌드 확인 및 커밋**

```bash
npm run lint
npm run build
```

Expected: 오류 없음.

```bash
git add -A
git commit -m "feat: 문제 관리 화면(목록/필터/수정/삭제, 주제 관리)"
```
