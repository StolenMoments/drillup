import path from "node:path";
import type { Prisma } from "@prisma/client";
import { parseHardenJson } from "@/core/harden-schema";
import { extractJsonObject } from "@/core/json-extract";
import { buildChoiceHardeningPrompt } from "@/core/prompt-template";
import type { McqPayload } from "@/core/types";
import { prisma } from "./db";
import { runEngine } from "./generation/run-engine";

function outputDir(jobId: number, attempt: number): string {
  return path.resolve(
    "generation_output",
    "harden",
    "jobs",
    String(jobId),
    `attempt-${attempt}`,
  );
}

type ClaimToken = {
  id: number;
  attempt: number;
  startedAt: Date;
};

function claimedWhere(token: ClaimToken): Prisma.ChoiceHardeningJobWhereInput {
  return {
    id: token.id,
    attempt: token.attempt,
    startedAt: token.startedAt,
    status: "RUNNING" as const,
  };
}

async function markFailed(
  token: ClaimToken,
  errorMessage: string,
): Promise<void> {
  await prisma.choiceHardeningJob.updateMany({
    where: claimedWhere(token),
    data: {
      status: "FAILED",
      errorMessage,
      finishedAt: new Date(),
    },
  });
}

export async function runChoiceHardeningJob(jobId: number): Promise<void> {
  const claimedAt = new Date();
  const claimed = await prisma.choiceHardeningJob.updateMany({
    where: { id: jobId, status: "RUNNING", startedAt: null },
    data: { startedAt: claimedAt, stage: "GENERATING" },
  });
  if (claimed.count === 0) return;

  const job = await prisma.choiceHardeningJob.findUnique({
    where: { id: jobId },
    include: { question: { select: { topic: { select: { name: true } } } } },
  });
  if (!job || job.status !== "RUNNING" || !job.startedAt) return;

  const token: ClaimToken = {
    id: job.id,
    attempt: job.attempt,
    startedAt: job.startedAt,
  };
  const original = job.sourcePayload as unknown as McqPayload;
  const dir = outputDir(job.id, job.attempt);

  try {
    const generatePrompt = buildChoiceHardeningPrompt(
      job.question.topic.name,
      original,
      path.join(dir, "generate-result.json"),
    );
    const generated = await runEngine(
      job.engine,
      generatePrompt,
      dir,
      "generate-",
    );
    if (!generated.ok) {
      await markFailed(token, generated.failureReason);
      return;
    }

    const parsed = parseHardenJson(
      extractJsonObject(generated.resultText),
      original,
    );
    if (!parsed.ok) {
      await markFailed(token, `생성 결과를 해석하지 못했습니다: ${parsed.fatal}`);
      return;
    }

    await prisma.choiceHardeningJob.updateMany({
      where: claimedWhere(token),
      data: {
        status: "SUCCEEDED",
        preview: {
          engine: job.engine,
          comment: parsed.comment,
          factualConcern: parsed.factualConcern,
          payload: {
            question: parsed.payload.question,
            choices: parsed.payload.choices,
            answer_indices: parsed.payload.answer_indices ?? [],
            choice_explanations: parsed.payload.choice_explanations ?? [],
          },
        } as unknown as Prisma.InputJsonValue,
        errorMessage: null,
        finishedAt: new Date(),
      },
    });
  } catch (error) {
    await markFailed(
      token,
      error instanceof Error ? error.message : "선지 강화 작업 중 알 수 없는 오류가 발생했습니다",
    );
  }
}

export { outputDir as choiceHardeningOutputDir };
