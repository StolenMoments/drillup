import { randomUUID } from "node:crypto";
import path from "node:path";
import { aiOutputContracts } from "@/core/ai-output-contracts";
import type { Prisma } from "@prisma/client";
import { parseFactualReviewJson } from "@/core/factual-review-schema";
import { parseFreshnessReviewJson, type VerificationSourcePolicy } from "@/core/freshness-review-schema";
import { parseFreshnessReviewSourceSnapshot } from "@/core/freshness-review-source";
import { extractJsonObject } from "@/core/json-extract";
import { buildFactualConcernReviewPrompt, buildFreshnessReviewPrompt } from "@/core/prompt-template";
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

  const job = await prisma.factualReviewJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RUNNING" || !job.startedAt) return;

  async function markFailed(errorMessage: string): Promise<void> {
    await prisma.factualReviewJob.updateMany({
      where: { id: jobId, startedAt: claimedAt, status: "RUNNING" },
      data: { status: "FAILED", errorMessage, finishedAt: new Date() },
    });
  }

  try {
    const snapshot = job.kind === "FRESHNESS"
      ? parseFreshnessReviewSourceSnapshot(job.sourceSnapshot)
      : null;
    const question = snapshot
      ? null
      : await prisma.question.findUnique({
          where: { id: job.questionId },
          include: { topic: { select: { name: true } } },
        });
    if (!snapshot && !question) {
      await markFailed("검증할 문제를 찾을 수 없습니다");
      return;
    }

    const original = (snapshot?.payload ?? question!.payload) as unknown as McqPayload;
    const topicName = snapshot?.topicName ?? question!.topic.name;
    const explanation = snapshot
      ? snapshot.explanation
      : question!.explanation;
    const sourcePolicy: VerificationSourcePolicy = snapshot?.sourcePolicy ?? (
      job.sourcePolicy === "AWS_DOCS_ONLY" ? "AWS_DOCS_ONLY" : "OFFICIAL_DOCS"
    );
    const dir = path.resolve(
      "generation_output",
      job.kind === "FRESHNESS" ? "freshness-review" : "factual-review",
      `${job.questionId}-${job.engine.toLowerCase()}-${randomUUID()}`,
    );
    const prompt = job.kind === "FRESHNESS"
      ? buildFreshnessReviewPrompt(topicName, original, explanation, sourcePolicy, path.join(dir, "result.json"))
      : buildFactualConcernReviewPrompt(topicName, original, job.concern, path.join(dir, "result.json"), sourcePolicy);

    const run = await runEngine(
      job.engine,
      prompt,
      dir,
      job.kind === "FRESHNESS"
        ? aiOutputContracts.freshnessReview
        : aiOutputContracts.factualReview,
    );
    if (!run.ok) {
      await markFailed(run.failureReason);
      return;
    }

    const parsed = job.kind === "FRESHNESS"
      ? parseFreshnessReviewJson(extractJsonObject(run.resultText), sourcePolicy)
      : parseFactualReviewJson(extractJsonObject(run.resultText));
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
