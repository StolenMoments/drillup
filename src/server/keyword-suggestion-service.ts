import { randomUUID } from "node:crypto";
import path from "node:path";
import type { GenerationEngine } from "@prisma/client";
import { extractJsonObject } from "@/core/json-extract";
import { parseKeywordSuggestionJson } from "@/core/keyword-tag-schema";
import { buildKeywordSuggestionPrompt } from "@/core/prompt-template";
import type { KeywordSuggestionDto } from "@/lib/api-types";
import { prisma } from "./db";
import { ServiceError } from "./errors";
import { runEngine } from "./generation/run-engine";

export async function suggestQuestionKeywords(
  questionId: number,
  engine: GenerationEngine,
): Promise<KeywordSuggestionDto> {
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    include: {
      topic: { select: { name: true } },
      keywords: { include: { keyword: { select: { name: true } } } },
    },
  });
  if (!question) {
    throw new ServiceError("NOT_FOUND", "문제를 찾을 수 없습니다", 404);
  }

  const existingKeywords = await prisma.keyword.findMany({
    where: { questions: { some: { question: { topicId: question.topicId } } } },
    orderBy: { name: "asc" },
    select: { name: true },
  });
  const assignedKeywords = question.keywords.map((item) => item.keyword.name);
  const dir = path.resolve(
    "generation_output",
    "keyword-suggestions",
    `${questionId}-${engine.toLowerCase()}-${randomUUID()}`,
  );
  const prompt = buildKeywordSuggestionPrompt(
    question.topic.name,
    {
      type: question.type,
      payload: question.payload,
      explanation: question.explanation,
    },
    existingKeywords.map((keyword) => keyword.name),
    assignedKeywords,
    path.join(dir, "result.json"),
  );
  const run = await runEngine(engine, prompt, dir);
  if (!run.ok) {
    throw new ServiceError("KEYWORD_SUGGESTION_FAILED", run.failureReason, 502);
  }

  const parsed = parseKeywordSuggestionJson(extractJsonObject(run.resultText));
  if (!parsed.ok) {
    throw new ServiceError("KEYWORD_SUGGESTION_PARSE_ERROR", parsed.fatal, 502);
  }

  const assigned = new Set(assignedKeywords);
  return {
    engine,
    keywords: parsed.keywords.filter((keyword) => !assigned.has(keyword)),
  };
}
