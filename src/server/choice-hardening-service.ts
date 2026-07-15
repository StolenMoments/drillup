import { Prisma, type ChoiceHardeningJob, type GenerationEngine } from "@prisma/client";
import { sha256Fingerprint } from "@/core/stable-json";
import type { McqPayload } from "@/core/types";
import type {
  ChoiceHardeningJobDto,
  ChoiceHardeningJobPageDto,
  ChoiceHardeningJobListItemDto,
  ChoiceHardeningJobSummaryDto,
  ChoiceHardeningListStatusDto,
  HardenPreviewDto,
} from "@/lib/api-types";
import { prisma } from "./db";
import { ServiceError } from "./errors";
import { generationTimeoutMs } from "./generation/run-engine";

const STALE_GRACE_MS = 60_000;
const STALE_JOB_MESSAGE = "서버 재시작 또는 시간 초과로 작업이 중단되었습니다";

function toDto(job: ChoiceHardeningJob): ChoiceHardeningJobDto {
  return {
    id: job.id,
    questionId: job.questionId,
    sourceHash: job.sourceHash,
    engine: job.engine,
    verifyEngine: job.verifyEngine,
    attempt: job.attempt,
    status: job.status,
    stage: job.stage,
    preview: job.preview as HardenPreviewDto | null,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    appliedAt: job.appliedAt?.toISOString() ?? null,
    autoApplied: job.autoApplied,
    dismissedAt: job.dismissedAt?.toISOString() ?? null,
  };
}

async function recoverStaleChoiceHardeningJobs(): Promise<void> {
  const staleBefore = new Date(
    Date.now() - 2 * generationTimeoutMs() - STALE_GRACE_MS,
  );
  await prisma.choiceHardeningJob.updateMany({
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
  sourceHash: string,
  engine: GenerationEngine,
  verifyEngine: GenerationEngine,
): Promise<ChoiceHardeningJob | null> {
  return prisma.choiceHardeningJob.findUnique({
    where: {
      questionId_sourceHash_engine_verifyEngine: {
        questionId,
        sourceHash,
        engine,
        verifyEngine,
      },
    },
  });
}

async function findJobOrThrow(
  questionId: number,
  jobId: number,
): Promise<ChoiceHardeningJob> {
  const job = await prisma.choiceHardeningJob.findUnique({ where: { id: jobId } });
  if (!job || job.questionId !== questionId) {
    throw new ServiceError("NOT_FOUND", "선지 강화 작업을 찾을 수 없습니다", 404);
  }
  return job;
}

export async function startChoiceHardeningJob(
  questionId: number,
  engine: GenerationEngine,
  force: boolean,
): Promise<ChoiceHardeningJobDto> {
  await recoverStaleChoiceHardeningJobs();

  const question = await prisma.question.findUnique({
    where: { id: questionId },
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

  const sourceHash = await sha256Fingerprint(question.payload);
  let existing = await findJobByKey(
    questionId,
    sourceHash,
    engine,
    engine,
  );

  if (!existing) {
    try {
      existing = await prisma.choiceHardeningJob.create({
        data: {
          questionId,
          sourceHash,
          sourcePayload: question.payload as Prisma.InputJsonValue,
          engine,
          verifyEngine: engine,
        },
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
      existing = await findJobByKey(
        questionId,
        sourceHash,
        engine,
        engine,
      );
      if (!existing) throw error;
    }
  }

  if (
    force &&
    (existing.status === "SUCCEEDED" || existing.status === "FAILED")
  ) {
    await prisma.choiceHardeningJob.updateMany({
      where: {
        id: existing.id,
        status: { in: ["SUCCEEDED", "FAILED"] },
      },
      data: {
        attempt: { increment: 1 },
        status: "RUNNING",
        stage: "GENERATING",
        preview: Prisma.JsonNull,
        errorMessage: null,
        startedAt: null,
        finishedAt: null,
        appliedAt: null,
      },
    });
    const refreshed = await prisma.choiceHardeningJob.findUnique({
      where: { id: existing.id },
    });
    if (!refreshed) {
      throw new ServiceError("INTERNAL", "선지 강화 작업을 불러오지 못했습니다", 500);
    }
    existing = refreshed;
  }

  return toDto(existing);
}

export async function getChoiceHardeningJob(
  questionId: number,
  jobId: number,
): Promise<ChoiceHardeningJobDto> {
  await recoverStaleChoiceHardeningJobs();
  return toDto(await findJobOrThrow(questionId, jobId));
}

export async function applyChoiceHardeningJob(
  questionId: number,
  jobId: number,
  options: { auto?: boolean } = {},
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM question WHERE id = ${questionId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM choice_hardening_job WHERE id = ${jobId} FOR UPDATE`;

    const [question, job] = await Promise.all([
      tx.question.findUnique({ where: { id: questionId } }),
      tx.choiceHardeningJob.findUnique({ where: { id: jobId } }),
    ]);
    if (!question) {
      throw new ServiceError("NOT_FOUND", "문제를 찾을 수 없습니다", 404);
    }
    if (!job || job.questionId !== questionId) {
      throw new ServiceError("NOT_FOUND", "선지 강화 작업을 찾을 수 없습니다", 404);
    }
    if (job.appliedAt) return;
    if (job.dismissedAt) {
      throw new ServiceError(
        "CHOICE_HARDENING_DISMISSED",
        "거절된 작업은 적용할 수 없습니다",
        409,
      );
    }
    if (job.status !== "SUCCEEDED" || !job.preview) {
      throw new ServiceError(
        "CHOICE_HARDENING_NOT_READY",
        "완료된 선지 강화 결과만 적용할 수 있습니다",
        409,
      );
    }

    const currentHash = await sha256Fingerprint(question.payload);
    if (currentHash !== job.sourceHash) {
      throw new ServiceError(
        "CHOICE_HARDENING_SOURCE_CHANGED",
        "원본 문제가 변경되어 기존 결과를 적용할 수 없습니다. 다시 생성해 주세요",
        409,
      );
    }

    const preview = job.preview as unknown as HardenPreviewDto;
    await tx.question.update({
      where: { id: questionId },
      data: {
        payload: preview.payload as unknown as Prisma.InputJsonValue,
        explanation: null,
      },
    });
    await tx.answerExplanation.deleteMany({ where: { questionId } });
    await tx.choiceHardeningJob.update({
      where: { id: jobId },
      data: { appliedAt: new Date(), autoApplied: options.auto === true },
    });
  });
}

export async function dismissChoiceHardeningJob(
  questionId: number,
  jobId: number,
): Promise<void> {
  const job = await findJobOrThrow(questionId, jobId);
  if (job.appliedAt) {
    throw new ServiceError(
      "CHOICE_HARDENING_ALREADY_APPLIED",
      "이미 반영된 작업은 거절할 수 없습니다",
      409,
    );
  }
  if (job.status === "RUNNING") {
    throw new ServiceError(
      "CHOICE_HARDENING_NOT_READY",
      "진행 중인 작업은 거절할 수 없습니다",
      409,
    );
  }
  if (job.dismissedAt) return;
  await prisma.choiceHardeningJob.updateMany({
    where: { id: jobId, appliedAt: null, dismissedAt: null },
    data: { dismissedAt: new Date() },
  });
}

const SUMMARY_SIZE = 5;
const PAGE_SIZE = 10;

const listInclude = {
  question: { select: { topic: { select: { name: true } } } },
} as const;

type JobWithTopic = ChoiceHardeningJob & {
  question: { topic: { name: string } };
};

function toListItem(job: JobWithTopic): ChoiceHardeningJobListItemDto {
  const source = job.sourcePayload as unknown as McqPayload;
  return {
    ...toDto(job),
    questionPreview:
      source.question.length > 80
        ? `${source.question.slice(0, 80)}...`
        : source.question,
    topicName: job.question.topic.name,
    source: { question: source.question, choices: source.choices },
  };
}

const listQueries: Record<
  ChoiceHardeningListStatusDto,
  {
    where: Prisma.ChoiceHardeningJobWhereInput;
    orderBy: Prisma.ChoiceHardeningJobOrderByWithRelationInput;
  }
> = {
  pending: {
    where: { status: "SUCCEEDED", appliedAt: null, dismissedAt: null },
    orderBy: { finishedAt: "desc" },
  },
  running: {
    where: { status: "RUNNING" },
    orderBy: { createdAt: "desc" },
  },
  failed: {
    where: { status: "FAILED", dismissedAt: null },
    orderBy: { finishedAt: "desc" },
  },
  applied: {
    where: { appliedAt: { not: null } },
    orderBy: { appliedAt: "desc" },
  },
};

async function getSummaryGroup(
  status: ChoiceHardeningListStatusDto,
): Promise<{ items: ChoiceHardeningJobListItemDto[]; totalItems: number }> {
  const query = listQueries[status];
  const [jobs, totalItems] = await Promise.all([
    prisma.choiceHardeningJob.findMany({
      ...query,
      include: listInclude,
      take: SUMMARY_SIZE,
    }),
    prisma.choiceHardeningJob.count({ where: query.where }),
  ]);
  return { items: jobs.map(toListItem), totalItems };
}

export async function getChoiceHardeningJobSummary(): Promise<ChoiceHardeningJobSummaryDto> {
  await recoverStaleChoiceHardeningJobs();
  const [pending, running, failed, applied] = await Promise.all([
    getSummaryGroup("pending"),
    getSummaryGroup("running"),
    getSummaryGroup("failed"),
    getSummaryGroup("applied"),
  ]);
  return { pending, running, failed, applied };
}

export async function getChoiceHardeningJobPage(
  status: ChoiceHardeningListStatusDto,
  requestedPage: number,
): Promise<ChoiceHardeningJobPageDto> {
  await recoverStaleChoiceHardeningJobs();
  const query = listQueries[status];
  const totalItems = await prisma.choiceHardeningJob.count({
    where: query.where,
  });
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE));
  const normalizedPage = Number.isInteger(requestedPage) && requestedPage > 0
    ? requestedPage
    : 1;
  const page = Math.min(normalizedPage, totalPages);
  const jobs = await prisma.choiceHardeningJob.findMany({
    ...query,
    include: listInclude,
    skip: (page - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });
  return {
    items: jobs.map(toListItem),
    page,
    pageSize: PAGE_SIZE,
    totalItems,
    totalPages,
  };
}

export async function countPendingChoiceHardeningJobs(): Promise<number> {
  return prisma.choiceHardeningJob.count({
    where: { status: "SUCCEEDED", appliedAt: null, dismissedAt: null },
  });
}

export { recoverStaleChoiceHardeningJobs, toDto as choiceHardeningJobDto };
