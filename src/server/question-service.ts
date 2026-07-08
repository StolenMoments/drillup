import type { Prisma } from "@prisma/client";
import type { ClozePayload, McqPayload } from "@/core/types";
import { clozePayloadSchema, mcqPayloadSchema } from "@/core/import-schema";
import type {
  QuestionDetailDto,
  QuestionListItemDto,
  QuestionListPageDto,
  QuestionListParams,
  QuestionListSortDto,
  QuestionTypeDto,
} from "@/lib/api-types";
import { prisma } from "./db";
import { ServiceError } from "./errors";

const QUESTION_PAGE_SIZE = 15;

function previewOf(type: QuestionTypeDto, payload: unknown): string {
  const text =
    type === "MCQ"
      ? (payload as unknown as McqPayload).question
      : (payload as unknown as ClozePayload).text;
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
}

function accuracyOf(question: QuestionListItemDto): number | null {
  return question.attempts > 0
    ? question.correctCount / question.attempts
    : null;
}

function compareAccuracy(
  a: QuestionListItemDto,
  b: QuestionListItemDto,
  direction: "asc" | "desc",
): number {
  const aAccuracy = accuracyOf(a);
  const bAccuracy = accuracyOf(b);

  if (aAccuracy === null && bAccuracy === null) return b.id - a.id;
  if (aAccuracy === null) return 1;
  if (bAccuracy === null) return -1;
  if (aAccuracy === bAccuracy) return b.id - a.id;

  return direction === "asc"
    ? aAccuracy - bAccuracy
    : bAccuracy - aAccuracy;
}

function sortQuestions(
  questions: QuestionListItemDto[],
  sort: QuestionListSortDto,
): QuestionListItemDto[] {
  return [...questions].sort((a, b) => {
    if (sort === "accuracyAsc") return compareAccuracy(a, b, "asc");
    if (sort === "accuracyDesc") return compareAccuracy(a, b, "desc");
    return (
      Date.parse(b.createdAt) - Date.parse(a.createdAt) ||
      b.id - a.id
    );
  });
}

export async function listQuestions(
  params: QuestionListParams = {},
): Promise<QuestionListPageDto> {
  const questions = await prisma.question.findMany({
    where: params.topicId ? { topicId: params.topicId } : undefined,
    include: { reviewLogs: { select: { isCorrect: true } } },
    orderBy: { id: "desc" },
  });

  const items = questions.map((q) => ({
    id: q.id,
    topicId: q.topicId,
    type: q.type,
    preview: previewOf(q.type, q.payload),
    attempts: q.reviewLogs.length,
    correctCount: q.reviewLogs.filter((log) => log.isCorrect).length,
    createdAt: q.createdAt.toISOString(),
  }));

  const filtered = params.type
    ? items.filter((question) => question.type === params.type)
    : items;
  const sorted = sortQuestions(filtered, params.sort ?? "latest");
  const totalItems = sorted.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / QUESTION_PAGE_SIZE));
  const requestedPage = params.page && params.page > 0 ? params.page : 1;
  const page = totalItems === 0 ? 1 : Math.min(requestedPage, totalPages);
  const start = (page - 1) * QUESTION_PAGE_SIZE;

  return {
    items: sorted.slice(start, start + QUESTION_PAGE_SIZE),
    page,
    pageSize: QUESTION_PAGE_SIZE,
    totalItems,
    totalPages,
  };
}

export async function getQuestion(id: number): Promise<QuestionDetailDto> {
  const q = await prisma.question.findUnique({ where: { id } });
  if (!q) {
    throw new ServiceError("NOT_FOUND", "문제를 찾을 수 없습니다", 404);
  }
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
  if (!existing) {
    throw new ServiceError("NOT_FOUND", "문제를 찾을 수 없습니다", 404);
  }

  const schema = existing.type === "MCQ" ? mcqPayloadSchema : clozePayloadSchema;
  const parsed = schema.safeParse(input.payload);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new ServiceError(
      "VALIDATION",
      `payload가 유효하지 않습니다: ${detail}`,
      400,
    );
  }

  const q = await prisma.question.update({
    where: { id },
    data: {
      payload: parsed.data as Prisma.InputJsonValue,
      explanation: input.explanation,
    },
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
  if (!existing) {
    throw new ServiceError("NOT_FOUND", "문제를 찾을 수 없습니다", 404);
  }
  await prisma.question.delete({ where: { id } });
}
