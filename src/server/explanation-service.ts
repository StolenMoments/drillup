import path from "node:path";
import { aiOutputContracts } from "@/core/ai-output-contracts";
import type { GenerationEngine, Prisma } from "@prisma/client";
import {
  parseExplanationJson,
  type ChoiceExplanation,
} from "@/core/explanation-schema";
import { extractJsonObject } from "@/core/json-extract";
import { buildAnswerExplanationPrompt } from "@/core/prompt-template";
import type { ClozePayload, McqPayload } from "@/core/types";
import { prisma } from "./db";
import { ServiceError } from "./errors";
import { runEngine } from "./generation/run-engine";

export async function generateAndCacheExplanation(
  questionId: number,
  engine: GenerationEngine,
): Promise<{
  content: string;
  choiceExplanations: ChoiceExplanation[] | null;
  factualConcern: string | null;
}> {
  const question = await prisma.question.findUnique({
    where: { id: questionId },
  });
  if (!question) {
    throw new ServiceError("NOT_FOUND", "문제를 찾을 수 없습니다", 404);
  }

  const dir = path.resolve(
    "generation_output",
    "explanations",
    `${questionId}-${engine.toLowerCase()}`,
  );
  const prompt = buildAnswerExplanationPrompt(
    question.type,
    question.payload as unknown as McqPayload | ClozePayload,
    path.join(dir, "result.json"),
  );

  const run = await runEngine(engine, prompt, dir, aiOutputContracts.explanation);
  if (!run.ok) {
    throw new ServiceError("EXPLANATION_FAILED", run.failureReason, 502);
  }

  const parsed = parseExplanationJson(
    extractJsonObject(run.resultText),
    question.type,
    question.type === "MCQ"
      ? question.payload as unknown as McqPayload
      : null,
  );
  if (!parsed.ok) {
    throw new ServiceError("EXPLANATION_PARSE_ERROR", parsed.fatal, 502);
  }

  await prisma.answerExplanation.create({
    data: {
      questionId,
      engine,
      content: parsed.explanation,
      choiceExplanations: parsed.choiceExplanations === null
        ? undefined
        : parsed.choiceExplanations as unknown as Prisma.InputJsonValue,
      factualConcern: parsed.factualConcern,
    },
  });

  return {
    content: parsed.explanation,
    choiceExplanations: parsed.choiceExplanations,
    factualConcern: parsed.factualConcern,
  };
}
