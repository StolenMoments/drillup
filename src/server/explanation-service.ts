import path from "node:path";
import type { GenerationEngine } from "@prisma/client";
import { parseExplanationJson } from "@/core/explanation-schema";
import { extractJsonObject } from "@/core/json-extract";
import { buildAnswerExplanationPrompt } from "@/core/prompt-template";
import type { ClozePayload, McqPayload } from "@/core/types";
import { prisma } from "./db";
import { ServiceError } from "./errors";
import { runEngine } from "./generation/run-engine";

export async function getAnswerExplanation(
  questionId: number,
  engine: GenerationEngine,
): Promise<{ engine: GenerationEngine; content: string; cached: boolean }> {
  const question = await prisma.question.findUnique({
    where: { id: questionId },
  });
  if (!question) {
    throw new ServiceError("NOT_FOUND", "문제를 찾을 수 없습니다", 404);
  }

  const existing = await prisma.answerExplanation.findUnique({
    where: { questionId_engine: { questionId, engine } },
  });
  if (existing) {
    return { engine, content: existing.content, cached: true };
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

  const run = await runEngine(engine, prompt, dir);
  if (!run.ok) {
    throw new ServiceError("EXPLANATION_FAILED", run.failureReason, 502);
  }

  const parsed = parseExplanationJson(extractJsonObject(run.resultText));
  if (!parsed.ok) {
    throw new ServiceError("EXPLANATION_PARSE_ERROR", parsed.fatal, 502);
  }

  await prisma.answerExplanation.create({
    data: { questionId, engine, content: parsed.explanation },
  });

  return { engine, content: parsed.explanation, cached: false };
}
