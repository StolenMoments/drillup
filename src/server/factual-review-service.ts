import { randomUUID } from "node:crypto";
import path from "node:path";
import type { GenerationEngine } from "@prisma/client";
import { parseFactualReviewJson } from "@/core/factual-review-schema";
import { extractJsonObject } from "@/core/json-extract";
import { buildFactualConcernReviewPrompt } from "@/core/prompt-template";
import type { McqPayload } from "@/core/types";
import type { FactualReviewDto } from "@/lib/api-types";
import { prisma } from "./db";
import { ServiceError } from "./errors";
import { runEngine } from "./generation/run-engine";

export async function reviewFactualConcern(
  questionId: number,
  engine: GenerationEngine,
  concern: string,
): Promise<FactualReviewDto> {
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
      "MCQ 문제만 사실 확인을 요청할 수 있습니다",
      400,
    );
  }

  const original = question.payload as unknown as McqPayload;
  const dir = path.resolve(
    "generation_output",
    "factual-review",
    `${questionId}-${engine.toLowerCase()}-${randomUUID()}`,
  );
  const prompt = buildFactualConcernReviewPrompt(
    question.topic.name,
    original,
    concern,
    path.join(dir, "result.json"),
  );

  const run = await runEngine(engine, prompt, dir);
  if (!run.ok) {
    throw new ServiceError("FACT_REVIEW_FAILED", run.failureReason, 502);
  }

  const parsed = parseFactualReviewJson(extractJsonObject(run.resultText));
  if (!parsed.ok) {
    throw new ServiceError("FACT_REVIEW_PARSE_ERROR", parsed.fatal, 502);
  }

  return {
    engine,
    verdict: parsed.verdict,
    comment: parsed.comment,
    evidenceUrl: parsed.evidenceUrl,
    payload:
      parsed.payload === null
        ? null
        : {
            question: parsed.payload.question,
            choices: parsed.payload.choices,
            answer_indices: parsed.payload.answer_indices ?? [],
            choice_explanations: parsed.payload.choice_explanations ?? [],
          },
  };
}
