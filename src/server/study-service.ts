import type { Prisma } from "@prisma/client";
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
    blankIds: payload.blanks.map((blank) => blank.id),
    wordBank: shuffle([
      ...payload.blanks.map((blank) => blank.answer),
      ...payload.distractors,
    ]),
  };
}

export async function getStudyQueue(
  mode: "srs" | "practice",
  topicId?: number,
): Promise<StudyQuestionDto[]> {
  if (mode === "srs") {
    const rows = await prisma.srsState.findMany({
      where: {
        dueAt: { lte: new Date() },
        ...(topicId ? { question: { topicId } } : {}),
      },
      include: { question: true },
      orderBy: { dueAt: "asc" },
      take: SRS_QUEUE_LIMIT,
    });
    return rows.map((row) => toStudyDto(row.question));
  }

  const rows = await prisma.question.findMany({
    where: topicId ? { topicId } : undefined,
    select: { id: true },
  });
  const pickedIds = shuffle(rows.map((row) => row.id)).slice(
    0,
    PRACTICE_QUEUE_LIMIT,
  );
  if (pickedIds.length === 0) return [];

  const questions = await prisma.question.findMany({
    where: { id: { in: pickedIds } },
  });
  const byId = new Map(questions.map((question) => [question.id, question]));
  return pickedIds
    .map((id) => byId.get(id))
    .filter(
      (question): question is NonNullable<typeof question> =>
        question !== undefined,
    )
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
        payload.blanks.map((blank) => [String(blank.id), blank.answer]),
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
