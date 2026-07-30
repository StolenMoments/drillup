import { randomUUID } from "node:crypto";
import type { Job, JobRunLog, Prisma } from "@prisma/client";
import type { JobDtoBase } from "@/lib/api-types";
import { prisma } from "./db";
import { generationTimeoutMs } from "./generation/run-engine";
import { toJobDtoBase } from "./job-dto";

export const JOB_HEARTBEAT_INTERVAL_MS = 30_000;
const STALE_GRACE_MS = 60_000;
const LOG_TAIL_CHARS = 8_000;
const STALE_ERROR_MESSAGE = "stale job recovered after heartbeat timeout";

export interface JobClaim {
  job: JobDtoBase;
  runToken: string;
}

export interface JobResultIdentity {
  id: number;
  type: Job["type"];
  topicId: number | null;
  questionId: number | null;
  parentJobId: number | null;
}

export type PersistJobResult = (
  tx: Prisma.TransactionClient,
  identity: JobResultIdentity,
) => Promise<void>;

class JobFenceLostError extends Error {
  constructor() {
    super("Job execution fence was lost");
  }
}

function resultIdentity(job: Job): JobResultIdentity {
  return {
    id: job.id,
    type: job.type,
    topicId: job.topicId,
    questionId: job.questionId,
    parentJobId: job.parentJobId,
  };
}

export async function claimJob(jobId: number): Promise<JobClaim | null> {
  const runToken = randomUUID();
  const now = new Date();
  const claimed = await prisma.job.updateMany({
    where: { id: jobId, status: "PENDING" },
    data: {
      status: "RUNNING",
      runToken,
      errorMessage: null,
      startedAt: now,
      heartbeatAt: now,
      finishedAt: null,
    },
  });
  if (claimed.count !== 1) return null;

  const job = await prisma.job.findUnique({ where: { id: jobId } });
  if (!job) return null;
  return { job: toJobDtoBase(job), runToken };
}

export async function heartbeatJob(jobId: number, runToken: string): Promise<boolean> {
  const result = await prisma.job.updateMany({
    where: { id: jobId, status: "RUNNING", runToken },
    data: { heartbeatAt: new Date() },
  });
  return result.count === 1;
}

export async function updateJobProgress(
  jobId: number,
  runToken: string,
  persist: (tx: Prisma.TransactionClient) => Promise<void>,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const owned = await tx.job.updateMany({
      where: { id: jobId, status: "RUNNING", runToken },
      data: { heartbeatAt: new Date() },
    });
    if (owned.count !== 1) throw new JobFenceLostError();
    await persist(tx);
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function completeJob(
  jobId: number,
  runToken: string,
  persistResult: PersistJobResult,
): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      const job = await tx.job.findUnique({ where: { id: jobId } });
      if (!job || job.status !== "RUNNING" || job.runToken !== runToken) return false;

      await persistResult(tx, resultIdentity(job));
      const now = new Date();
      const completed = await tx.job.updateMany({
        where: { id: jobId, status: "RUNNING", runToken },
        data: {
          status: "SUCCEEDED",
          runToken: null,
          errorMessage: null,
          heartbeatAt: now,
          finishedAt: now,
        },
      });
      if (completed.count !== 1) throw new JobFenceLostError();
      return true;
    });
  } catch (error) {
    if (error instanceof JobFenceLostError) return false;
    await failJob(jobId, runToken, errorMessage(error)).catch(() => false);
    throw error;
  }
}

export async function failJob(
  jobId: number,
  runToken: string,
  message: string,
): Promise<boolean> {
  const now = new Date();
  const failed = await prisma.job.updateMany({
    where: { id: jobId, status: "RUNNING", runToken },
    data: {
      status: "FAILED",
      runToken: null,
      errorMessage: message,
      heartbeatAt: now,
      finishedAt: now,
    },
  });
  return failed.count === 1;
}

function staleWhere(cutoff: Date): Prisma.JobWhereInput {
  return {
    status: "RUNNING",
    OR: [
      { heartbeatAt: { lt: cutoff } },
      { heartbeatAt: null, startedAt: { lt: cutoff } },
      { heartbeatAt: null, startedAt: null, createdAt: { lt: cutoff } },
    ],
  };
}

function isStale(job: Pick<Job, "heartbeatAt" | "startedAt" | "createdAt">, cutoff: Date) {
  return (job.heartbeatAt ?? job.startedAt ?? job.createdAt) < cutoff;
}

export async function recoverStaleJobs(now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - (2 * generationTimeoutMs() + STALE_GRACE_MS));
  const candidates = await prisma.job.findMany({ where: staleWhere(cutoff) });
  let recovered = 0;

  for (const candidate of candidates) {
    if (!isStale(candidate, cutoff)) continue;
    const didRecover = await prisma.$transaction(async (tx) => {
      const current = await tx.job.findUnique({ where: { id: candidate.id } });
      if (
        !current ||
        current.status !== "RUNNING" ||
        current.runToken !== candidate.runToken ||
        !isStale(current, cutoff)
      ) {
        return false;
      }

      await tx.jobRunLog.updateMany({
        where: { jobId: current.id, status: "RUNNING" },
        data: {
          status: "FAILED",
          errorMessage: STALE_ERROR_MESSAGE,
          finishedAt: now,
        },
      });
      if (current.type === "QUESTION_GENERATION") {
        await tx.questionGenerationJobData.updateMany({
          where: { jobId: current.id },
          data: { stage: "FAILED" },
        });
      }
      const closed = await tx.job.updateMany({
        where: {
          id: current.id,
          status: "RUNNING",
          runToken: current.runToken,
          ...staleWhere(cutoff),
        },
        data: {
          status: "FAILED",
          runToken: null,
          errorMessage: STALE_ERROR_MESSAGE,
          heartbeatAt: now,
          finishedAt: now,
        },
      });
      if (closed.count !== 1) throw new JobFenceLostError();
      return true;
    }).catch((error: unknown) => {
      if (error instanceof JobFenceLostError) return false;
      throw error;
    });
    if (didRecover) recovered += 1;
  }

  return recovered;
}

export type JobRunLogInput = Omit<Prisma.JobRunLogUncheckedCreateInput, "id">;

function tail(value: string | null | undefined): string | null | undefined {
  return value === undefined || value === null ? value : value.slice(-LOG_TAIL_CHARS);
}

export async function writeJobRunLog(input: JobRunLogInput): Promise<JobRunLog | null> {
  try {
    return await prisma.jobRunLog.create({
      data: {
        ...input,
        stdoutTail: tail(input.stdoutTail),
        stderrTail: tail(input.stderrTail),
      },
    });
  } catch {
    return null;
  }
}

export interface RunClaimedJobOptions<Result> {
  execute: (claim: JobClaim) => Promise<Result>;
  persistResult: (
    tx: Prisma.TransactionClient,
    result: Result,
    identity: JobResultIdentity,
  ) => Promise<void>;
}

export type RunClaimedJobOutcome =
  | "NOT_CLAIMED"
  | "SUCCEEDED"
  | "FAILED"
  | "FENCED";

export async function runClaimedJob<Result>(
  jobId: number,
  options: RunClaimedJobOptions<Result>,
): Promise<RunClaimedJobOutcome> {
  const claim = await claimJob(jobId);
  if (!claim) return "NOT_CLAIMED";

  let fenceLost = false;
  const timer = setInterval(() => {
    void heartbeatJob(jobId, claim.runToken)
      .then((owned) => {
        if (!owned) fenceLost = true;
      })
      .catch(() => {
        // A transient heartbeat write failure is retried by the next tick. Terminal
        // writes still fence on the token, so this cannot revive a recovered job.
      });
  }, JOB_HEARTBEAT_INTERVAL_MS);

  try {
    const result = await options.execute(claim);
    if (fenceLost) return "FENCED";
    const completed = await completeJob(jobId, claim.runToken, (tx, identity) =>
      options.persistResult(tx, result, identity),
    );
    return completed ? "SUCCEEDED" : "FENCED";
  } catch (error) {
    if (error instanceof JobFenceLostError) return "FENCED";
    await failJob(jobId, claim.runToken, errorMessage(error)).catch(() => false);
    return "FAILED";
  } finally {
    clearInterval(timer);
  }
}
