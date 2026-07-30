import { randomUUID } from "node:crypto";
import path from "node:path";
import type { Prisma } from "@prisma/client";
import { parseFactualReviewJson } from "@/core/factual-review-schema";
import { extractJsonObject } from "@/core/json-extract";
import { buildFactualConcernReviewPrompt } from "@/core/prompt-template";
import type { McqPayload } from "@/core/types";
import { prisma } from "./db";
import { runEngine } from "./generation/run-engine";

export async function runFactualReviewJob(jobId: number): Promise<void> {
  const claimedAt = new Date();
  const claimed = await prisma.factualReviewJob.updateMany({
    where: { id: jobId, status: "RUNNING", startedAt: null },
    data: { startedAt: claimedAt },
  });
  if (claimed.count === 0) return;

  const job = await prisma.factualReviewJob.findUnique({
    where: { id: jobId },
    include: { question: { include: { topic: { select: { name: true } } } } },
  });
  if (!job || job.status !== "RUNNING" || !job.startedAt) return;

  async function markFailed(errorMessage: string): Promise<void> {
    await prisma.factualReviewJob.updateMany({
      where: { id: jobId, startedAt: claimedAt, status: "RUNNING" },
      data: { status: "FAILED", errorMessage, finishedAt: new Date() },
    });
  }

  try {
    const original = job.question.payload as unknown as McqPayload;
    const dir = path.resolve(
      "generation_output",
      "factual-review",
      `${job.questionId}-${job.engine.toLowerCase()}-${randomUUID()}`,
    );
    const prompt = buildFactualConcernReviewPrompt(
      job.question.topic.name,
      original,
      job.concern,
      path.join(dir, "result.json"),
    );

    const run = await runEngine(job.engine, prompt, dir);
    if (!run.ok) {
      await markFailed(run.failureReason);
      return;
    }

    const parsed = parseFactualReviewJson(extractJsonObject(run.resultText));
    if (!parsed.ok) {
      await markFailed(parsed.fatal);
      return;
    }

    await prisma.factualReviewJob.updateMany({
      where: { id: jobId, startedAt: claimedAt, status: "RUNNING" },
      data: {
        status: "SUCCEEDED",
        verdict: parsed.verdict,
        comment: parsed.comment,
        evidenceUrl: parsed.evidenceUrl,
        payload:
          parsed.payload === null
            ? undefined
            : (parsed.payload as unknown as Prisma.InputJsonValue),
        finishedAt: new Date(),
      },
    });
  } catch (error) {
    await markFailed(
      error instanceof Error ? error.message : "사실 확인 작업 중 알 수 없는 오류가 발생했습니다",
    );
  }
}
