import type { Job } from "@prisma/client";
import type { JobDtoBase } from "@/lib/api-types";

type JobDtoSource = Pick<
  Job,
  | "id"
  | "type"
  | "status"
  | "engine"
  | "topicId"
  | "questionId"
  | "parentJobId"
  | "retryOfJobId"
  | "errorMessage"
  | "createdAt"
  | "startedAt"
  | "heartbeatAt"
  | "finishedAt"
>;

function iso(value: Date | null): string | null {
  return value?.toISOString() ?? null;
}

export function toJobDtoBase(job: JobDtoSource): JobDtoBase {
  return {
    id: job.id,
    type: job.type,
    status: job.status,
    engine: job.engine,
    topicId: job.topicId,
    questionId: job.questionId,
    parentJobId: job.parentJobId,
    retryOfJobId: job.retryOfJobId,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    startedAt: iso(job.startedAt),
    heartbeatAt: iso(job.heartbeatAt),
    finishedAt: iso(job.finishedAt),
  };
}
