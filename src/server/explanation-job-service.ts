import { Prisma, type AnswerExplanationJob, type GenerationEngine } from "@prisma/client";
import type { ChoiceExplanation } from "@/core/explanation-schema";
import { prisma } from "./db";
import { ServiceError } from "./errors";
import { generationTimeoutMs } from "./generation/run-engine";

const STALE_GRACE_MS = 60_000;
const STALE_JOB_MESSAGE = "서버 재시작 또는 시간 초과로 작업이 중단되었습니다";

export type AnswerExplanationJobStatusValue = "RUNNING" | "SUCCEEDED" | "FAILED";

export interface AnswerExplanationResult {
  content: string;
  choiceExplanations: ChoiceExplanation[] | null;
  factualConcern: string | null;
}

export interface AnswerExplanationJobDto {
  id: number;
  questionId: number;
  engine: GenerationEngine;
  status: AnswerExplanationJobStatusValue;
  result: AnswerExplanationResult | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

function toResult(cache: {
  content: string;
  choiceExplanations: unknown;
  factualConcern: string | null;
}): AnswerExplanationResult {
  return {
    content: cache.content,
    choiceExplanations: cache.choiceExplanations as ChoiceExplanation[] | null,
    factualConcern: cache.factualConcern,
  };
}

function toDto(
  job: AnswerExplanationJob,
  result: AnswerExplanationResult | null,
): AnswerExplanationJobDto {
  return {
    id: job.id,
    questionId: job.questionId,
    engine: job.engine,
    status: job.status,
    result,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

export async function recoverStaleAnswerExplanationJobs(): Promise<void> {
  const staleBefore = new Date(
    Date.now() - 2 * generationTimeoutMs() - STALE_GRACE_MS,
  );
  await prisma.answerExplanationJob.updateMany({
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

async function findJobByKey(
  questionId: number,
  engine: GenerationEngine,
): Promise<AnswerExplanationJob | null> {
  return prisma.answerExplanationJob.findUnique({
    where: { questionId_engine: { questionId, engine } },
  });
}

export async function startAnswerExplanationJob(
  questionId: number,
  engine: GenerationEngine,
): Promise<AnswerExplanationJobDto> {
  await recoverStaleAnswerExplanationJobs();

  const question = await prisma.question.findUnique({
    where: { id: questionId },
  });
  if (!question) {
    throw new ServiceError("NOT_FOUND", "문제를 찾을 수 없습니다", 404);
  }

  const cached = await prisma.answerExplanation.findUnique({
    where: { questionId_engine: { questionId, engine } },
  });
  if (cached) {
    // Cache-hit synthetic DTO: this is not a real AnswerExplanationJob, so
    // `id` is a sentinel (0), not a pollable job id. Safe today because this
    // branch always returns status "SUCCEEDED" with a non-null result, so
    // the client never polls GET /explain/{jobId} using this value.
    return {
      id: 0,
      questionId,
      engine,
      status: "SUCCEEDED",
      result: toResult(cached),
      errorMessage: null,
      createdAt: cached.createdAt.toISOString(),
      startedAt: null,
      finishedAt: cached.createdAt.toISOString(),
    };
  }

  let existing = await findJobByKey(questionId, engine);
  if (!existing) {
    try {
      existing = await prisma.answerExplanationJob.create({
        data: { questionId, engine },
      });
    } catch (error) {
      if (
        !(
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === "P2002"
        )
      ) {
        throw error;
      }
      existing = await findJobByKey(questionId, engine);
      if (!existing) throw error;
    }
  }

  if (existing.status === "FAILED" || existing.status === "SUCCEEDED") {
    // A SUCCEEDED job with no matching cache row can occur when the cache
    // was invalidated independently (e.g. choice-hardening apply deletes
    // AnswerExplanation rows without touching AnswerExplanationJob rows).
    // Treat that the same as FAILED: reset to RUNNING so the runner
    // regenerates it, instead of returning a broken SUCCEEDED/result:null DTO.
    await prisma.answerExplanationJob.updateMany({
      where: { id: existing.id, status: existing.status },
      data: {
        status: "RUNNING",
        errorMessage: null,
        startedAt: null,
        finishedAt: null,
      },
    });
    const refreshed = await prisma.answerExplanationJob.findUnique({
      where: { id: existing.id },
    });
    if (!refreshed) {
      throw new ServiceError("INTERNAL", "해설 생성 작업을 불러오지 못했습니다", 500);
    }
    existing = refreshed;
  }

  return toDto(existing, null);
}

export async function getAnswerExplanationJob(
  questionId: number,
  jobId: number,
): Promise<AnswerExplanationJobDto> {
  await recoverStaleAnswerExplanationJobs();

  const job = await prisma.answerExplanationJob.findUnique({
    where: { id: jobId },
  });
  if (!job || job.questionId !== questionId) {
    throw new ServiceError("NOT_FOUND", "해설 생성 작업을 찾을 수 없습니다", 404);
  }

  if (job.status !== "SUCCEEDED") {
    return toDto(job, null);
  }

  const cached = await prisma.answerExplanation.findUnique({
    where: { questionId_engine: { questionId: job.questionId, engine: job.engine } },
  });
  if (!cached) {
    throw new ServiceError(
      "INTERNAL",
      "완료된 해설 생성 작업의 캐시를 찾을 수 없습니다",
      500,
    );
  }

  return toDto(job, toResult(cached));
}
