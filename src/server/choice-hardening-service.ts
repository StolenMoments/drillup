import { randomUUID } from "node:crypto";
import path from "node:path";
import type { GenerationEngine } from "@prisma/client";
import { parseHardenJson } from "@/core/harden-schema";
import { extractJsonObject } from "@/core/json-extract";
import { buildChoiceHardeningPrompt } from "@/core/prompt-template";
import type { McqPayload } from "@/core/types";
import type { HardenPreviewDto } from "@/lib/api-types";
import { prisma } from "./db";
import { ServiceError } from "./errors";
import { runEngine } from "./generation/run-engine";

export async function hardenQuestionChoices(
  questionId: number,
  engine: GenerationEngine,
): Promise<HardenPreviewDto> {
  const question = await prisma.question.findUnique({
    where: { id: questionId },
    include: { topic: { select: { name: true } } },
  });
  if (!question) {
    throw new ServiceError("NOT_FOUND", "문제를 찾을 수 없습니다", 404);
  }
  if (question.type !== "MCQ") {
    throw new ServiceError(
      "VALIDATION",
      "MCQ 문제만 선지 난이도를 올릴 수 있습니다",
      400,
    );
  }

  const original = question.payload as unknown as McqPayload;
  const dir = path.resolve(
    "generation_output",
    "harden",
    `${questionId}-${engine.toLowerCase()}-${randomUUID()}`,
  );
  const prompt = buildChoiceHardeningPrompt(
    question.topic.name,
    original,
    path.join(dir, "result.json"),
  );

  const run = await runEngine(engine, prompt, dir);
  if (!run.ok) {
    throw new ServiceError("HARDEN_FAILED", run.failureReason, 502);
  }

  const parsed = parseHardenJson(extractJsonObject(run.resultText), original);
  if (!parsed.ok) {
    throw new ServiceError("HARDEN_PARSE_ERROR", parsed.fatal, 502);
  }

  return {
    engine,
    comment: parsed.comment,
    factualConcern: parsed.factualConcern,
    payload: {
      question: parsed.payload.question,
      choices: parsed.payload.choices,
      answer_indices: parsed.payload.answer_indices ?? [],
      choice_explanations: parsed.payload.choice_explanations ?? [],
    },
  };
}
