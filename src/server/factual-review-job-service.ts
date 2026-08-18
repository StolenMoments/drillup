import { Prisma, type FactualReviewJob, type GenerationEngine } from "@prisma/client";
import {
  createFreshnessReviewSourceSnapshot,
  freshnessReviewSourceHash,
} from "@/core/freshness-review-source";
import type { McqPayload } from "@/core/types";
import type {
  FactualReviewJobDto,
  FactualReviewResultDto,
  FreshnessReviewJobDto,
  FreshnessReviewResultDto,
  HardenedMcqPayloadDto,
} from "@/lib/api-types";
import type { VerificationSourcePolicy } from "@/core/freshness-review-schema";
import { prisma } from "./db";
import { ServiceError } from "./errors";
import { generationTimeoutMs } from "./generation/run-engine";

const STALE_GRACE_MS = 60_000;
const STALE_JOB_MESSAGE = "서버 재시작 또는 시간 초과로 작업이 중단되었습니다";

function toResult(job: FactualReviewJob): FactualReviewResultDto | null {
  if (job.status !== "SUCCEEDED" || !job.verdict || !job.comment) return null;
  return {
    verdict: job.verdict as FactualReviewResultDto["verdict"],
    comment: job.comment,
    evidenceUrl: job.evidenceUrl,
    payload: job.payload as unknown as HardenedMcqPayloadDto | null,
  };
}

function toDto(job: FactualReviewJob): FactualReviewJobDto {
  return {
    id: job.id,
    questionId: job.questionId,
    engine: job.engine,
    concern: job.concern,
    status: job.status,
    result: toResult(job),
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

function sourcePolicyOf(job: FactualReviewJob): VerificationSourcePolicy {
  return job.sourcePolicy === "AWS_DOCS_ONLY" ? "AWS_DOCS_ONLY" : "OFFICIAL_DOCS";
}

function normalizeSourcePolicy(
  value: string,
): VerificationSourcePolicy {
  return value === "AWS_DOCS_ONLY" ? "AWS_DOCS_ONLY" : "OFFICIAL_DOCS";
}

function toFreshnessDto(job: FactualReviewJob): FreshnessReviewJobDto {
  const result: FreshnessReviewResultDto | null =
    job.status === "SUCCEEDED" && job.verdict && job.comment
      ? {
          verdict: job.verdict as FreshnessReviewResultDto["verdict"],
          comment: job.comment,
          evidenceUrl: job.evidenceUrl,
          payload: job.payload as unknown as HardenedMcqPayloadDto | null,
        }
      : null;
  return {
    id: job.id,
    questionId: job.questionId,
    engine: job.engine,
    sourcePolicy: sourcePolicyOf(job),
    status: job.status,
    result,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

export async function recoverStaleFactualReviewJobs(): Promise<void> {
  const staleBefore = new Date(
    Date.now() - 2 * generationTimeoutMs() - STALE_GRACE_MS,
  );
  await prisma.factualReviewJob.updateMany({
    where: {
      status: "RUNNING",
      OR: [
        { startedAt: { lt: staleBefore } },
        { startedAt: null, createdAt: { lt: staleBefore } },
      ],
    },
    data: {
      status: "FAILED",
      errorMessage: STALE_JOB_MESSAGE,
      finishedAt: new Date(),
    },
  });
}

export async function startFactualReviewJob(
  questionId: number,
  engine: GenerationEngine,
  concern: string,
): Promise<FactualReviewJobDto> {
  await recoverStaleFactualReviewJobs();

  const question = await prisma.question.findUnique({ where: { id: questionId }, include: { topic: { select: { verificationSourcePolicy: true } } } });
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

  const job = await prisma.factualReviewJob.create({
    data: { questionId, engine, concern, kind: "FACTUAL_CONCERN", sourcePolicy: question.topic?.verificationSourcePolicy ?? "OFFICIAL_DOCS" },
  });

  return toDto(job);
}

export async function getFactualReviewJob(
  questionId: number,
  jobId: number,
): Promise<FactualReviewJobDto> {
  await recoverStaleFactualReviewJobs();

  const job = await prisma.factualReviewJob.findUnique({
    where: { id: jobId },
  });
  if (!job || job.questionId !== questionId || (job.kind ?? "FACTUAL_CONCERN") !== "FACTUAL_CONCERN") {
    throw new ServiceError("NOT_FOUND", "사실 확인 작업을 찾을 수 없습니다", 404);
  }

  return toDto(job);
}

export async function startFreshnessReviewJob(
  questionId: number,
  engine: GenerationEngine,
  force = false,
): Promise<{
  job: FreshnessReviewJobDto;
  reused: boolean;
  shouldRun: boolean;
}> {
  await recoverStaleFactualReviewJobs();

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM question WHERE id = ${questionId} FOR UPDATE`;

    const question = await tx.question.findUnique({
      where: { id: questionId },
      include: {
        topic: {
          select: { name: true, verificationSourcePolicy: true },
        },
      },
    });
    if (!question) {
      throw new ServiceError("NOT_FOUND", "문제를 찾을 수 없습니다", 404);
    }
    if (question.type !== "MCQ") {
      throw new ServiceError(
        "VALIDATION",
        "MCQ 문제만 최신 정보 검증을 요청할 수 있습니다",
        400,
      );
    }

    const sourcePolicy = normalizeSourcePolicy(
      question.topic.verificationSourcePolicy,
    );
    const sourceSnapshot = createFreshnessReviewSourceSnapshot({
      payload: question.payload as unknown as McqPayload,
      explanation: question.explanation,
      topicName: question.topic.name,
      sourcePolicy,
    });
    const sourceHash = await freshnessReviewSourceHash(sourceSnapshot);
    const cacheKey = {
      questionId,
      kind: "FRESHNESS" as const,
      sourceHash,
      engine,
    };

    const running = await tx.factualReviewJob.findFirst({
      where: { ...cacheKey, status: "RUNNING" },
      orderBy: { attempt: "desc" },
    });
    if (running) {
      return { job: toFreshnessDto(running), reused: true, shouldRun: false };
    }

    if (!force) {
      const succeeded = await tx.factualReviewJob.findFirst({
        where: { ...cacheKey, status: "SUCCEEDED" },
        orderBy: { attempt: "desc" },
      });
      if (succeeded) {
        return {
          job: toFreshnessDto(succeeded),
          reused: true,
          shouldRun: false,
        };
      }
    }

    const latest = await tx.factualReviewJob.findFirst({
      where: cacheKey,
      orderBy: { attempt: "desc" },
      select: { attempt: true },
    });
    const job = await tx.factualReviewJob.create({
      data: {
        ...cacheKey,
        concern: "",
        sourcePolicy,
        sourceSnapshot: sourceSnapshot as unknown as Prisma.InputJsonValue,
        attempt: (latest?.attempt ?? 0) + 1,
      },
    });
    return { job: toFreshnessDto(job), reused: false, shouldRun: true };
  });
}

export async function getFreshnessReviewJob(
  questionId: number,
  jobId: number,
): Promise<FreshnessReviewJobDto> {
  await recoverStaleFactualReviewJobs();
  const job = await prisma.factualReviewJob.findUnique({ where: { id: jobId } });
  if (!job || job.questionId !== questionId || job.kind !== "FRESHNESS") {
    throw new ServiceError("NOT_FOUND", "최신 정보 검증 작업을 찾을 수 없습니다", 404);
  }
  return toFreshnessDto(job);
}
