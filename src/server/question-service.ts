import type { Prisma } from "@prisma/client";
import type { ClozePayload, McqPayload } from "@/core/types";
import { clozePayloadSchema, mcqPayloadSchema } from "@/core/import-schema";
import type {
  QuestionDetailDto,
  QuestionListItemDto,
  QuestionTypeDto,
} from "@/lib/api-types";
import { prisma } from "./db";
import { ServiceError } from "./errors";

function previewOf(type: QuestionTypeDto, payload: unknown): string {
  const text =
    type === "MCQ"
      ? (payload as unknown as McqPayload).question
      : (payload as unknown as ClozePayload).text;
  return text.length > 80 ? `${text.slice(0, 80)}...` : text;
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
    correctCount: q.reviewLogs.filter((log) => log.isCorrect).length,
    createdAt: q.createdAt.toISOString(),
  }));
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
