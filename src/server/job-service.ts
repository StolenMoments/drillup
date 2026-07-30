import type {
  GenerationEngine,
  Job,
  JobType,
  Prisma,
} from "@prisma/client";
import type { JobDtoBase } from "@/lib/api-types";
import { prisma } from "./db";
import { ServiceError } from "./errors";
import { toJobDtoBase } from "./job-dto";

export type JobTarget = {
  topicId?: number | null;
  questionId?: number | null;
  parentJobId?: number | null;
};

type TopicTarget = { topicId: number; questionId?: null; parentJobId?: null };
type QuestionTarget = { topicId?: null; questionId: number; parentJobId?: null };
type ParentJobTarget = { topicId?: null; questionId?: null; parentJobId: number };

export type JobDetailCreateInput =
  | {
      type: "QUESTION_GENERATION";
      data: Prisma.QuestionGenerationJobDataCreateWithoutJobInput;
    }
  | {
      type: "KEYWORD_TAGGING";
      data: Prisma.KeywordTaggingJobDataCreateWithoutJobInput;
    }
  | {
      type: "GENERATION_ITEM_REVISION";
      data: Prisma.GenerationItemRevisionJobDataCreateWithoutJobInput;
    }
  | {
      type: "CHOICE_HARDENING";
      data: Prisma.ChoiceHardeningJobDataCreateWithoutJobInput;
    }
  | {
      type: "NOTE_TIDY";
      data: Prisma.NoteTidyJobDataCreateWithoutJobInput;
    }
  | {
      type: "ANSWER_EXPLANATION";
      data: Prisma.AnswerExplanationJobDataCreateWithoutJobInput;
    };

export type CreatePendingJobInput =
  | {
      type: "QUESTION_GENERATION";
      engine: GenerationEngine;
      target: TopicTarget;
      detail: Extract<JobDetailCreateInput, { type: "QUESTION_GENERATION" }>;
    }
  | {
      type: "KEYWORD_TAGGING";
      engine: GenerationEngine;
      target: TopicTarget;
      detail: Extract<JobDetailCreateInput, { type: "KEYWORD_TAGGING" }>;
    }
  | {
      type: "GENERATION_ITEM_REVISION";
      engine: GenerationEngine;
      target: ParentJobTarget;
      detail: Extract<JobDetailCreateInput, { type: "GENERATION_ITEM_REVISION" }>;
    }
  | {
      type: "CHOICE_HARDENING";
      engine: GenerationEngine;
      target: QuestionTarget;
      detail: Extract<JobDetailCreateInput, { type: "CHOICE_HARDENING" }>;
    }
  | {
      type: "NOTE_TIDY";
      engine: GenerationEngine;
      target: TopicTarget;
      detail: Extract<JobDetailCreateInput, { type: "NOTE_TIDY" }>;
    }
  | {
      type: "ANSWER_EXPLANATION";
      engine: GenerationEngine;
      target: QuestionTarget;
      detail: Extract<JobDetailCreateInput, { type: "ANSWER_EXPLANATION" }>;
    };

const TOPIC_JOB_TYPES = new Set<JobType>([
  "QUESTION_GENERATION",
  "KEYWORD_TAGGING",
  "NOTE_TIDY",
]);
const QUESTION_JOB_TYPES = new Set<JobType>([
  "CHOICE_HARDENING",
  "ANSWER_EXPLANATION",
]);

function isPositiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function invalidTarget(): never {
  throw new ServiceError("INVALID_JOB_TARGET", "Invalid job target", 400);
}

export function assertJobTarget(
  type: JobType | string,
  target: unknown,
): asserts target is JobTarget {
  if (typeof target !== "object" || target === null) invalidTarget();
  const value = target as JobTarget;
  const hasTopic = isPositiveId(value.topicId);
  const hasQuestion = isPositiveId(value.questionId);
  const hasParent = isPositiveId(value.parentJobId);
  const presentCount = Number(hasTopic) + Number(hasQuestion) + Number(hasParent);
  if (presentCount !== 1) invalidTarget();

  if (TOPIC_JOB_TYPES.has(type as JobType) && hasTopic) return;
  if (QUESTION_JOB_TYPES.has(type as JobType) && hasQuestion) return;
  if (type === "GENERATION_ITEM_REVISION" && hasParent) return;
  invalidTarget();
}

function assertTypeAndDetail(input: CreatePendingJobInput): void {
  if (input.type !== input.detail.type) {
    throw new ServiceError(
      "INVALID_JOB_DETAIL",
      "Job detail type must match job type",
      400,
    );
  }
}

function targetColumns(target: JobTarget) {
  return {
    topicId: target.topicId ?? null,
    questionId: target.questionId ?? null,
    parentJobId: target.parentJobId ?? null,
  };
}

async function lockTarget(
  tx: Prisma.TransactionClient,
  type: JobType,
  target: JobTarget,
): Promise<void> {
  if (target.topicId !== undefined && target.topicId !== null) {
    const rows = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM topic WHERE id = ${target.topicId} FOR UPDATE
    `;
    if (rows.length === 0) invalidTarget();
    return;
  }
  if (target.questionId !== undefined && target.questionId !== null) {
    const rows = await tx.$queryRaw<Array<{ id: number }>>`
      SELECT id FROM question WHERE id = ${target.questionId} FOR UPDATE
    `;
    if (rows.length === 0) invalidTarget();
    return;
  }

  const parentJobId = target.parentJobId;
  if (!isPositiveId(parentJobId)) invalidTarget();
  await tx.$queryRaw<Array<{ id: number }>>`
    SELECT id FROM job WHERE id = ${parentJobId} FOR UPDATE
  `;
  const parent = await tx.job.findUnique({
    where: { id: parentJobId },
    select: { type: true },
  });
  if (type !== "GENERATION_ITEM_REVISION" || parent?.type !== "QUESTION_GENERATION") {
    invalidTarget();
  }
}

function jobCreateData(
  input: CreatePendingJobInput,
  retryOfJobId: number | null,
): Prisma.JobUncheckedCreateInput {
  const base = {
    type: input.type,
    status: "PENDING" as const,
    engine: input.engine,
    ...targetColumns(input.target),
    retryOfJobId,
  };

  switch (input.type) {
    case "QUESTION_GENERATION":
      return { ...base, questionGenerationData: { create: input.detail.data } };
    case "KEYWORD_TAGGING":
      return { ...base, keywordTaggingData: { create: input.detail.data } };
    case "GENERATION_ITEM_REVISION":
      return { ...base, generationItemRevisionData: { create: input.detail.data } };
    case "CHOICE_HARDENING":
      return { ...base, choiceHardeningData: { create: input.detail.data } };
    case "NOTE_TIDY":
      return { ...base, noteTidyData: { create: input.detail.data } };
    case "ANSWER_EXPLANATION":
      return { ...base, answerExplanationData: { create: input.detail.data } };
  }
}

async function createInTransaction(
  tx: Prisma.TransactionClient,
  input: CreatePendingJobInput,
  retryOfJobId: number | null,
): Promise<Job> {
  await lockTarget(tx, input.type, input.target);
  return tx.job.create({ data: jobCreateData(input, retryOfJobId) });
}

export async function createPendingJob(
  input: CreatePendingJobInput,
): Promise<JobDtoBase> {
  assertJobTarget(input.type, input.target);
  assertTypeAndDetail(input);
  const job = await prisma.$transaction((tx) => createInTransaction(tx, input, null));
  return toJobDtoBase(job);
}

function sameTarget(job: Job, target: JobTarget): boolean {
  const columns = targetColumns(target);
  return (
    job.topicId === columns.topicId &&
    job.questionId === columns.questionId &&
    job.parentJobId === columns.parentJobId
  );
}

export async function retryJob(
  originalJobId: number,
  input: CreatePendingJobInput,
): Promise<JobDtoBase> {
  assertJobTarget(input.type, input.target);
  assertTypeAndDetail(input);

  const retried = await prisma.$transaction(async (tx) => {
    const original = await tx.job.findUnique({ where: { id: originalJobId } });
    if (!original) {
      throw new ServiceError("JOB_NOT_FOUND", "Job not found", 404);
    }
    if (original.status !== "SUCCEEDED" && original.status !== "FAILED") {
      throw new ServiceError("JOB_NOT_TERMINAL", "Only a terminal job can be retried", 409);
    }
    if (original.type !== input.type) {
      throw new ServiceError("JOB_RETRY_TYPE_MISMATCH", "Retry job type must match", 400);
    }
    if (!sameTarget(original, input.target)) {
      throw new ServiceError("JOB_RETRY_TARGET_MISMATCH", "Retry job target must match", 400);
    }
    return createInTransaction(tx, input, original.id);
  });

  return toJobDtoBase(retried);
}
