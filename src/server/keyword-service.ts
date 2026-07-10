import type { Prisma } from "@prisma/client";
import {
  dedupeKeywordNames,
  KEYWORD_MAX_LENGTH,
  normalizeKeywordName,
} from "@/core/keyword";
import type { KeywordDto, KeywordRefDto } from "@/lib/api-types";
import { prisma } from "./db";
import { ServiceError } from "./errors";

export async function listKeywords(topicId?: number): Promise<KeywordDto[]> {
  const keywords = await prisma.keyword.findMany({
    where: topicId
      ? { questions: { some: { question: { topicId } } } }
      : undefined,
    orderBy: { name: "asc" },
    include: { _count: { select: { questions: true } } },
  });
  // questionCount는 주제 필터와 무관하게 전체 연결 수 — 키워드는 전역 어휘.
  return keywords.map((keyword) => ({
    id: keyword.id,
    name: keyword.name,
    questionCount: keyword._count.questions,
  }));
}

export async function attachKeywords(
  tx: Prisma.TransactionClient,
  questionId: number,
  names: string[],
): Promise<void> {
  for (const name of dedupeKeywordNames(names)) {
    const keyword = await tx.keyword.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    await tx.questionKeyword.upsert({
      where: { questionId_keywordId: { questionId, keywordId: keyword.id } },
      update: {},
      create: { questionId, keywordId: keyword.id },
    });
  }
}

export async function addQuestionKeyword(
  questionId: number,
  rawName: string,
): Promise<KeywordRefDto> {
  const name = normalizeKeywordName(rawName);
  if (!name || name.length > KEYWORD_MAX_LENGTH) {
    throw new ServiceError(
      "VALIDATION",
      `키워드는 1~${KEYWORD_MAX_LENGTH}자여야 합니다`,
      400,
    );
  }
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    select: { id: true },
  });
  if (!question) {
    throw new ServiceError("NOT_FOUND", "문제를 찾을 수 없습니다", 404);
  }

  const keyword = await prisma.$transaction(async (tx) => {
    await attachKeywords(tx, questionId, [name]);
    return tx.keyword.findUniqueOrThrow({ where: { name } });
  });
  return { id: keyword.id, name: keyword.name };
}

export async function removeQuestionKeyword(
  questionId: number,
  keywordId: number,
): Promise<void> {
  const link = await prisma.questionKeyword.findUnique({
    where: { questionId_keywordId: { questionId, keywordId } },
  });
  if (!link) {
    throw new ServiceError("NOT_FOUND", "연결된 키워드를 찾을 수 없습니다", 404);
  }

  await prisma.$transaction(async (tx) => {
    await tx.questionKeyword.delete({
      where: { questionId_keywordId: { questionId, keywordId } },
    });
    // 고아 키워드 정리 — 연결이 0개가 되면 키워드도 삭제한다.
    const remaining = await tx.questionKeyword.count({ where: { keywordId } });
    if (remaining === 0) {
      await tx.keyword.delete({ where: { id: keywordId } });
    }
  });
}
