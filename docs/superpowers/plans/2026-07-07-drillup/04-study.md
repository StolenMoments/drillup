# drillup 구현 계획 4/5 — 학습 (출제 큐 · 채점 · 학습 화면)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** SRS "오늘의 복습"과 자유 연습 모드로 문제를 풀 수 있게 한다 — 출제 큐 API, 서버 채점 + SRS 갱신 API, MCQ/CLOZE 풀이 화면.

**Architecture:** 채점과 SRS 상태 전이는 플랜 2의 core 모듈을 사용하고, `study-service`가 DB 글루 역할만 한다. 출제 응답에는 정답이 포함되지 않으며 채점은 `POST /api/reviews`에서 수행한다.

**Tech Stack:** Next.js Route Handlers, Prisma, React

## Global Constraints

`00-overview.md`의 Global Constraints를 반드시 먼저 읽고 준수할 것. 선행 조건: 플랜 1~3 완료. 수동 검증에는 플랜 3에서 가져온 문제 데이터와 로그인 쿠키(`cookies.txt`)가 필요하다.

---

### Task 1: 학습 서비스 (출제 큐 + 리뷰 제출)

**Files:**
- Create: `src/server/study-service.ts`

**Interfaces:**
- Consumes:
  - `gradeMcq`, `gradeCloze`, `McqAnswer`, `ClozeAnswer` (플랜 2 Task 1)
  - `applyAnswer` (플랜 2 Task 2)
  - `shuffle` (플랜 2 Task 4)
  - `McqPayload`, `ClozePayload` (플랜 2 Task 1)
  - `StudyQuestionDto`, `ReviewAnswerDto`, `ReviewResultDto` (플랜 3 Task 1)
  - `prisma`, `ServiceError`
- Produces:
  - `getStudyQueue(mode: "srs" | "practice", topicId?: number): Promise<StudyQuestionDto[]>`
    - srs: `due_at <= now`인 문제를 due 오래된 순으로 최대 100개
    - practice: 주제 내 랜덤 최대 20개
  - `submitReview(input: { questionId: number; mode: "SRS" | "PRACTICE"; answer: ReviewAnswerDto }): Promise<ReviewResultDto>`
    - 채점 → (SRS 모드일 때만) srs_state 갱신 → review_log 기록 → 정답·해설 반환
    - 오답 시 `due_at`을 변경하지 않는다(당일 유지 → 세션 내 재출제)

- [ ] **Step 1: 서비스 작성**

`src/server/study-service.ts`:

```ts
import { Prisma } from "@prisma/client";
import { gradeCloze, gradeMcq } from "@/core/grading";
import { shuffle } from "@/core/random";
import { applyAnswer } from "@/core/srs";
import type { ClozePayload, McqPayload } from "@/core/types";
import type {
  ReviewAnswerDto,
  ReviewResultDto,
  StudyQuestionDto,
} from "@/lib/api-types";
import { prisma } from "./db";
import { ServiceError } from "./errors";

const DAY_MS = 24 * 60 * 60 * 1000;
const SRS_QUEUE_LIMIT = 100;
const PRACTICE_QUEUE_LIMIT = 20;

function toStudyDto(question: {
  id: number;
  type: "MCQ" | "CLOZE";
  payload: unknown;
}): StudyQuestionDto {
  if (question.type === "MCQ") {
    const payload = question.payload as unknown as McqPayload;
    return {
      id: question.id,
      type: "MCQ",
      question: payload.question,
      choices: payload.choices,
    };
  }
  const payload = question.payload as unknown as ClozePayload;
  return {
    id: question.id,
    type: "CLOZE",
    text: payload.text,
    blankIds: payload.blanks.map((b) => b.id),
    wordBank: shuffle([
      ...payload.blanks.map((b) => b.answer),
      ...payload.distractors,
    ]),
  };
}

export async function getStudyQueue(
  mode: "srs" | "practice",
  topicId?: number,
): Promise<StudyQuestionDto[]> {
  if (mode === "srs") {
    const questions = await prisma.question.findMany({
      where: {
        ...(topicId ? { topicId } : {}),
        srsState: { dueAt: { lte: new Date() } },
      },
      orderBy: { srsState: { dueAt: "asc" } },
      take: SRS_QUEUE_LIMIT,
    });
    return questions.map(toStudyDto);
  }

  // practice: 전체(또는 주제 내) 문제에서 랜덤 추출 — 1인용 규모라 id 전수 조회 후 셔플로 충분
  const rows = await prisma.question.findMany({
    where: topicId ? { topicId } : undefined,
    select: { id: true },
  });
  const pickedIds = shuffle(rows.map((r) => r.id)).slice(
    0,
    PRACTICE_QUEUE_LIMIT,
  );
  if (pickedIds.length === 0) return [];
  const questions = await prisma.question.findMany({
    where: { id: { in: pickedIds } },
  });
  const byId = new Map(questions.map((q) => [q.id, q]));
  return pickedIds
    .map((id) => byId.get(id))
    .filter((q): q is NonNullable<typeof q> => q !== undefined)
    .map(toStudyDto);
}

export async function submitReview(input: {
  questionId: number;
  mode: "SRS" | "PRACTICE";
  answer: ReviewAnswerDto;
}): Promise<ReviewResultDto> {
  const question = await prisma.question.findUnique({
    where: { id: input.questionId },
    include: { srsState: true },
  });
  if (!question) {
    throw new ServiceError("NOT_FOUND", "문제를 찾을 수 없습니다", 404);
  }

  let isCorrect: boolean;
  let correct: ReviewResultDto["correct"];
  if (question.type === "MCQ") {
    if (input.answer.type !== "MCQ") {
      throw new ServiceError("BAD_REQUEST", "답안 형식이 문제 유형과 다릅니다", 400);
    }
    const payload = question.payload as unknown as McqPayload;
    isCorrect = gradeMcq(payload, {
      selected_index: input.answer.selected_index,
    });
    correct = { type: "MCQ", answer_index: payload.answer_index };
  } else {
    if (input.answer.type !== "CLOZE") {
      throw new ServiceError("BAD_REQUEST", "답안 형식이 문제 유형과 다릅니다", 400);
    }
    const payload = question.payload as unknown as ClozePayload;
    isCorrect = gradeCloze(payload, { filled: input.answer.filled });
    correct = {
      type: "CLOZE",
      answers: Object.fromEntries(
        payload.blanks.map((b) => [String(b.id), b.answer]),
      ),
    };
  }

  if (input.mode === "SRS") {
    const state = question.srsState;
    if (!state) {
      throw new ServiceError("INTERNAL", "SRS 상태가 없습니다", 500);
    }
    const next = applyAnswer(
      {
        easeFactor: Number(state.easeFactor),
        intervalDays: state.intervalDays,
        repetitions: state.repetitions,
        lapses: state.lapses,
      },
      isCorrect,
    );
    const now = new Date();
    await prisma.srsState.update({
      where: { questionId: question.id },
      data: {
        easeFactor: next.easeFactor,
        intervalDays: next.intervalDays,
        repetitions: next.repetitions,
        lapses: next.lapses,
        lastReviewedAt: now,
        // 오답(dueInDays 0)이면 due_at을 건드리지 않는다 → 당일 재출제 유지
        ...(next.dueInDays > 0
          ? { dueAt: new Date(now.getTime() + next.dueInDays * DAY_MS) }
          : {}),
      },
    });
  }

  await prisma.reviewLog.create({
    data: {
      questionId: question.id,
      mode: input.mode,
      isCorrect,
      answer: input.answer as unknown as Prisma.InputJsonValue,
    },
  });

  return { isCorrect, explanation: question.explanation, correct };
}
```

- [ ] **Step 2: 타입 검사**

```bash
npx tsc --noEmit
```

Expected: 오류 없음.

- [ ] **Step 3: 커밋**

```bash
git add src/server/study-service.ts
git commit -m "feat: 학습 서비스(SRS/연습 출제 큐, 채점 및 SRS 갱신)"
```

---

### Task 2: 학습 API (queue + reviews)

**Files:**
- Create: `src/app/api/study/queue/route.ts`
- Create: `src/app/api/reviews/route.ts`

**Interfaces:**
- Consumes: `getStudyQueue`, `submitReview`(Task 1), `http.ts`
- Produces:
  - `GET /api/study/queue?mode=srs|practice&topicId=` → `StudyQuestionDto[]` (정답 미포함)
  - `POST /api/reviews` `{ questionId, mode, answer }` → `ReviewResultDto`

- [ ] **Step 1: 출제 큐 Route Handler 작성**

`src/app/api/study/queue/route.ts`:

```ts
import { handleApiError, jsonOk } from "@/server/http";
import { getStudyQueue } from "@/server/study-service";

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const mode = url.searchParams.get("mode") === "practice" ? "practice" : "srs";
    const topicIdRaw = url.searchParams.get("topicId");
    const topicId = topicIdRaw ? Number(topicIdRaw) : undefined;
    return jsonOk(await getStudyQueue(mode, topicId));
  } catch (e) {
    return handleApiError(e);
  }
}
```

- [ ] **Step 2: 리뷰 Route Handler 작성**

`src/app/api/reviews/route.ts`:

```ts
import { z } from "zod";
import { handleApiError, jsonOk, parseBody } from "@/server/http";
import { submitReview } from "@/server/study-service";

const answerSchema = z.union([
  z.object({
    type: z.literal("MCQ"),
    selected_index: z.number().int().min(0).max(3),
  }),
  z.object({
    type: z.literal("CLOZE"),
    filled: z.record(z.string(), z.string()),
  }),
]);

const bodySchema = z.object({
  questionId: z.number().int().positive(),
  mode: z.enum(["SRS", "PRACTICE"]),
  answer: answerSchema,
});

export async function POST(req: Request) {
  try {
    const input = await parseBody(req, bodySchema);
    return jsonOk(await submitReview(input));
  } catch (e) {
    return handleApiError(e);
  }
}
```

- [ ] **Step 3: 수동 검증**

`npm run dev` 상태에서 (플랜 3의 데이터: 문제 id 1 = MCQ 정답 index 2, id 2 = CLOZE):

```bash
curl.exe -s -b cookies.txt "http://localhost:3000/api/study/queue?mode=srs"
```

Expected: 문제 배열. **MCQ 항목에 `answer_index`가 없고, CLOZE 항목에 `blanks`(정답) 대신 `blankIds`와 셔플된 `wordBank`만 있는지 반드시 확인.**

정답 제출(SRS):

```bash
curl.exe -s -b cookies.txt -H "Content-Type: application/json" -d "{\"questionId\":1,\"mode\":\"SRS\",\"answer\":{\"type\":\"MCQ\",\"selected_index\":2}}" http://localhost:3000/api/reviews
```

Expected: `{"isCorrect":true,"explanation":"...","correct":{"type":"MCQ","answer_index":2}}`

SRS 상태 확인 — `npx prisma studio`(http://localhost:5555)에서 `SrsState` 모델의
questionId 1 행 확인:

Expected: `intervalDays 1`, `repetitions 1`, `dueAt`이 내일. (이하 이 문서의 "DB 확인"은
모두 같은 방식으로 Prisma Studio를 사용한다)

다시 큐 조회 → 문제 1이 큐에서 빠졌는지 확인:

```bash
curl.exe -s -b cookies.txt "http://localhost:3000/api/study/queue?mode=srs"
```

오답 제출(CLOZE, 일부러 틀리게):

```bash
curl.exe -s -b cookies.txt -H "Content-Type: application/json" -d "{\"questionId\":2,\"mode\":\"SRS\",\"answer\":{\"type\":\"CLOZE\",\"filled\":{\"1\":\"비연결\",\"2\":\"3-way\"}}}" http://localhost:3000/api/reviews
```

Expected: `"isCorrect":false`, `correct.answers`에 정답 단어. Prisma Studio에서 문제 2의 `lapses 1`, `easeFactor 2.3`, `dueAt` 과거 유지 확인.

연습 모드가 SRS를 건드리지 않는지:

```bash
curl.exe -s -b cookies.txt -H "Content-Type: application/json" -d "{\"questionId\":1,\"mode\":\"PRACTICE\",\"answer\":{\"type\":\"MCQ\",\"selected_index\":0}}" http://localhost:3000/api/reviews
```

후 `srs_state` 재조회 → 문제 1의 `repetitions`가 여전히 1(변화 없음), `review_log`에는 행 추가.

- [ ] **Step 4: 커밋**

```bash
git add -A
git commit -m "feat: 출제 큐 및 리뷰 제출 API"
```

---

### Task 3: 풀이 컴포넌트 (McqCard · ClozeCard · ResultPanel)

**Files:**
- Create: `src/components/McqCard.tsx`
- Create: `src/components/ClozeCard.tsx`
- Create: `src/components/ResultPanel.tsx`

**Interfaces:**
- Consumes: `StudyQuestionDto`, `ReviewResultDto`
- Produces:
  - `<McqCard question disabled onSubmit(selectedIndex: number) />`
  - `<ClozeCard question disabled onSubmit(filled: Record<string, string>) />`
  - `<ResultPanel question result onNext isLast />`
  - **주의:** 카드는 내부 선택 상태를 가지므로 부모는 반드시 `key`를 문제마다 다르게 부여해 리마운트시킬 것 (Task 4에서 `key={\`${id}-${index}\`}` 사용)

- [ ] **Step 1: McqCard 작성**

`src/components/McqCard.tsx`:

```tsx
"use client";

import { useState } from "react";
import type { StudyQuestionDto } from "@/lib/api-types";

type McqQuestion = Extract<StudyQuestionDto, { type: "MCQ" }>;

export default function McqCard({
  question,
  disabled,
  onSubmit,
}: {
  question: McqQuestion;
  disabled: boolean;
  onSubmit: (selectedIndex: number) => void;
}) {
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <div className="space-y-4">
      <p className="text-lg">{question.question}</p>
      <div className="space-y-2">
        {question.choices.map((choice, i) => (
          <button
            key={i}
            disabled={disabled}
            onClick={() => setSelected(i)}
            className={`w-full rounded border px-3 py-3 text-left ${
              selected === i
                ? "border-sky-500 bg-sky-950"
                : "border-slate-700 bg-slate-900"
            }`}
          >
            {i + 1}. {choice}
          </button>
        ))}
      </div>
      <button
        disabled={disabled || selected === null}
        onClick={() => selected !== null && onSubmit(selected)}
        className="w-full rounded bg-sky-600 py-3 font-semibold disabled:opacity-50"
      >
        제출
      </button>
    </div>
  );
}
```

- [ ] **Step 2: ClozeCard 작성**

`src/components/ClozeCard.tsx`:

```tsx
"use client";

import { useMemo, useState } from "react";
import type { StudyQuestionDto } from "@/lib/api-types";

type ClozeQuestion = Extract<StudyQuestionDto, { type: "CLOZE" }>;

type Part = { kind: "text"; value: string } | { kind: "blank"; id: number };

/** "{{n}}" 자리표시자 기준으로 텍스트를 분해한다 */
function splitParts(text: string): Part[] {
  const parts: Part[] = [];
  const re = /\{\{(\d+)\}\}/g;
  let last = 0;
  for (const m of text.matchAll(re)) {
    const index = m.index ?? 0;
    if (index > last) parts.push({ kind: "text", value: text.slice(last, index) });
    parts.push({ kind: "blank", id: Number(m[1]) });
    last = index + m[0].length;
  }
  if (last < text.length) parts.push({ kind: "text", value: text.slice(last) });
  return parts;
}

export default function ClozeCard({
  question,
  disabled,
  onSubmit,
}: {
  question: ClozeQuestion;
  disabled: boolean;
  onSubmit: (filled: Record<string, string>) => void;
}) {
  const [filled, setFilled] = useState<Record<string, string>>({});
  const parts = useMemo(() => splitParts(question.text), [question.text]);

  const usedWords = new Set(Object.values(filled));
  const allFilled = question.blankIds.every((id) => filled[String(id)]);

  // 단어 탭 → 앞에서부터 비어 있는 첫 빈칸에 배치
  function fillWord(word: string) {
    const empty = question.blankIds.find((id) => !filled[String(id)]);
    if (empty === undefined) return;
    setFilled((prev) => ({ ...prev, [String(empty)]: word }));
  }

  // 채워진 빈칸 탭 → 비우기
  function clearBlank(id: number) {
    setFilled((prev) => {
      const next = { ...prev };
      delete next[String(id)];
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <p className="text-lg leading-10">
        {parts.map((part, i) =>
          part.kind === "text" ? (
            <span key={i}>{part.value}</span>
          ) : (
            <button
              key={i}
              disabled={disabled}
              onClick={() => clearBlank(part.id)}
              className={`mx-1 inline-block min-w-16 rounded border-b-2 px-2 py-0.5 align-baseline ${
                filled[String(part.id)]
                  ? "border-sky-500 bg-sky-950 text-sky-300"
                  : "border-slate-500 bg-slate-900 text-slate-500"
              }`}
            >
              {filled[String(part.id)] ?? "＿＿"}
            </button>
          ),
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {question.wordBank.map((word, i) => (
          <button
            key={i}
            disabled={disabled || usedWords.has(word)}
            onClick={() => fillWord(word)}
            className="rounded border border-slate-700 bg-slate-900 px-3 py-2 disabled:opacity-30"
          >
            {word}
          </button>
        ))}
      </div>
      <button
        disabled={disabled || !allFilled}
        onClick={() => onSubmit(filled)}
        className="w-full rounded bg-sky-600 py-3 font-semibold disabled:opacity-50"
      >
        제출
      </button>
    </div>
  );
}
```

- [ ] **Step 3: ResultPanel 작성**

`src/components/ResultPanel.tsx`:

```tsx
"use client";

import type { ReviewResultDto, StudyQuestionDto } from "@/lib/api-types";

export default function ResultPanel({
  question,
  result,
  onNext,
  isLast,
}: {
  question: StudyQuestionDto;
  result: ReviewResultDto;
  onNext: () => void;
  isLast: boolean;
}) {
  return (
    <div
      className={`space-y-3 rounded border p-4 ${
        result.isCorrect
          ? "border-emerald-700 bg-emerald-950/40"
          : "border-red-700 bg-red-950/40"
      }`}
    >
      <p className="text-lg font-bold">
        {result.isCorrect ? "정답입니다 ✅" : "오답입니다 ❌"}
      </p>
      {!result.isCorrect &&
        result.correct.type === "MCQ" &&
        question.type === "MCQ" && (
          <p>
            정답: {result.correct.answer_index + 1}.{" "}
            {question.choices[result.correct.answer_index]}
          </p>
        )}
      {!result.isCorrect && result.correct.type === "CLOZE" && (
        <p>
          정답:{" "}
          {Object.entries(result.correct.answers)
            .map(([id, word]) => `${id}번 = ${word}`)
            .join(", ")}
        </p>
      )}
      {result.explanation && (
        <p className="text-slate-300">{result.explanation}</p>
      )}
      <button
        onClick={onNext}
        className="w-full rounded bg-slate-700 py-3 font-semibold"
      >
        {isLast ? "완료" : "다음 문제"}
      </button>
    </div>
  );
}
```

- [ ] **Step 4: 타입 검사 및 커밋**

```bash
npx tsc --noEmit
git add src/components
git commit -m "feat: 풀이 컴포넌트(McqCard/ClozeCard/ResultPanel)"
```

---

### Task 4: 학습 화면

**Files:**
- Create: `src/app/study/page.tsx`

**Interfaces:**
- Consumes: `api`, `StudyQuestionDto`, `ReviewResultDto`, `ReviewAnswerDto`, Task 3의 컴포넌트
- Produces: `/study?mode=srs|practice&topicId=` 화면 — 큐 로드 → 풀이 → 채점 결과/해설 → 다음. SRS 오답은 큐 뒤로 재추가(세션 내 재출제). 큐 소진 시 완료 화면.

- [ ] **Step 1: 학습 화면 작성**

`src/app/study/page.tsx`:

```tsx
"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ClozeCard from "@/components/ClozeCard";
import McqCard from "@/components/McqCard";
import ResultPanel from "@/components/ResultPanel";
import { api } from "@/lib/api-client";
import type {
  ReviewAnswerDto,
  ReviewResultDto,
  StudyQuestionDto,
} from "@/lib/api-types";

function StudyContent() {
  const params = useSearchParams();
  const mode: "srs" | "practice" =
    params.get("mode") === "practice" ? "practice" : "srs";
  const topicIdRaw = params.get("topicId");
  const topicId = topicIdRaw ? Number(topicIdRaw) : undefined;

  const [queue, setQueue] = useState<StudyQuestionDto[] | null>(null);
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<ReviewResultDto | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setQueue(null);
    setIndex(0);
    setResult(null);
    setError("");
    api.study
      .queue(mode, topicId)
      .then(setQueue)
      .catch(() => setError("문제를 불러오지 못했습니다"));
  }, [mode, topicId]);

  const current = queue?.[index];

  async function submitAnswer(answer: ReviewAnswerDto) {
    if (!current) return;
    try {
      const r = await api.study.submitReview({
        questionId: current.id,
        mode: mode === "srs" ? "SRS" : "PRACTICE",
        answer,
      });
      setResult(r);
      if (mode === "srs" && !r.isCorrect) {
        // 오답은 세션 내 재출제 — 큐 뒤에 다시 추가
        setQueue((q) => (q ? [...q, current] : q));
      }
    } catch {
      setError("채점 요청에 실패했습니다");
    }
  }

  function next() {
    setResult(null);
    setIndex((i) => i + 1);
  }

  if (error) return <p className="text-red-300">{error}</p>;
  if (!queue) return <p className="text-slate-400">불러오는 중…</p>;

  if (!current) {
    return (
      <div className="space-y-4 pt-10 text-center">
        <p className="text-lg">
          {mode === "srs"
            ? "오늘 복습할 문제를 모두 끝냈습니다 🎉"
            : "풀 문제가 없습니다."}
        </p>
        {mode === "srs" && (
          <Link
            href={`/study?mode=practice${topicId ? `&topicId=${topicId}` : ""}`}
            className="inline-block rounded bg-slate-700 px-4 py-2"
          >
            자유 연습하기
          </Link>
        )}
        <Link href="/" className="block text-sky-400">
          대시보드로
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm text-slate-400">
        <span>{mode === "srs" ? "오늘의 복습" : "자유 연습"}</span>
        <span>
          {index + 1} / {queue.length}
        </span>
      </div>
      {current.type === "MCQ" ? (
        <McqCard
          key={`${current.id}-${index}`}
          question={current}
          disabled={result !== null}
          onSubmit={(selectedIndex) =>
            submitAnswer({ type: "MCQ", selected_index: selectedIndex })
          }
        />
      ) : (
        <ClozeCard
          key={`${current.id}-${index}`}
          question={current}
          disabled={result !== null}
          onSubmit={(filled) => submitAnswer({ type: "CLOZE", filled })}
        />
      )}
      {result && (
        <ResultPanel
          question={current}
          result={result}
          onNext={next}
          isLast={index + 1 >= queue.length}
        />
      )}
    </div>
  );
}

export default function StudyPage() {
  return (
    <Suspense fallback={<p className="text-slate-400">불러오는 중…</p>}>
      <StudyContent />
    </Suspense>
  );
}
```

참고: `useSearchParams`는 Suspense 경계가 필요하므로 페이지를 `Suspense`로 감싼다. 카드 `key`에 `index`를 포함하는 이유 — SRS 오답으로 같은 문제가 큐 뒤에 다시 나올 때(같은 id) 리마운트되어 선택 상태가 초기화되게 하기 위함.

- [ ] **Step 2: 수동 검증**

먼저 문제 2(CLOZE)의 due를 과거로 되돌려 큐에 나오게 한다 (Task 2 검증에서 오답 처리했다면 이미 due가 과거이므로 생략 가능). 프로젝트 루트에 `tmp-reset-due.sql` 생성:

```sql
UPDATE srs_state SET due_at = NOW() - INTERVAL 1 DAY;
```

```bash
npx prisma db execute --file tmp-reset-due.sql --schema prisma/schema.prisma
```

실행 후 `tmp-reset-due.sql` 삭제.

브라우저 `/study?mode=srs`:

1. 문제가 표시된다 ("오늘의 복습", "1 / n" 카운터)
2. MCQ: 보기 선택 → 제출 → 정답/오답 패널 + 해설 → "다음 문제"
3. CLOZE: 단어은행 단어 탭 → 앞 빈칸부터 채워짐, 채워진 빈칸 탭 → 비워짐, 모두 채우면 제출 활성화
4. **오답을 내면** 큐 카운터 분모가 1 늘고(재출제 추가), 마지막에 같은 문제가 다시 나온다. 이번에 맞히면 완료
5. 큐 소진 → "오늘 복습할 문제를 모두 끝냈습니다 🎉" + "자유 연습하기" 버튼
6. `/study?mode=practice` → 랜덤 출제, SRS와 동일한 풀이 흐름
7. 연습 모드에서 문제를 풀어도 다시 `/study?mode=srs`에 그 문제가 나타나지 않는다(스케줄 불변)

모바일 확인: 브라우저 개발자 도구 모바일 뷰(375px)에서 보기 버튼/단어은행이 화면 밖으로 넘치지 않는지 확인.

- [ ] **Step 3: 빌드 확인 및 커밋**

```bash
npm run lint
npm run build
```

Expected: 오류 없음.

```bash
git add -A
git commit -m "feat: 학습 화면(SRS/자유 연습, 오답 세션 내 재출제)"
```
