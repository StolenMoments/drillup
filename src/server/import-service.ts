import type { Prisma } from "@prisma/client";
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
  if (!topic) {
    throw new ServiceError("NOT_FOUND", "주제를 찾을 수 없습니다", 404);
  }

  await prisma.$transaction(async (tx) => {
    for (const question of questions) {
      const created = await tx.question.create({
        data: {
          topicId,
          type: question.type === "mcq" ? "MCQ" : "CLOZE",
          payload: toPayload(question) as Prisma.InputJsonValue,
          explanation: question.explanation?.trim()
            ? question.explanation.trim()
            : null,
        },
        select: { id: true },
      });
      await tx.srsState.create({ data: { questionId: created.id } });
    }
  });

  return questions.length;
}
