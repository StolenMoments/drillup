import type { JobRunLog } from "@prisma/client";
import type { GenerationRunLogDto, GenerationRunStageDto } from "@/lib/api-types";
import { prisma } from "../db";
import { ServiceError } from "../errors";

function toDto(run: JobRunLog): GenerationRunLogDto {
  return { id: run.id, stage: run.stage as GenerationRunStageDto, itemIndex: run.itemIndex, attempt: run.attempt, engine: run.engine, model: run.model, status: run.status, prompt: run.prompt, response: run.response, stdoutTail: run.stdoutTail, stderrTail: run.stderrTail, errorMessage: run.errorMessage, exitCode: run.exitCode, timedOut: run.timedOut, startedAt: run.startedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null, durationMs: run.durationMs };
}

export async function getJobDiagnostics(jobId: number): Promise<GenerationRunLogDto[]> {
  const job = await prisma.job.findFirst({ where: { id: jobId, type: { in: ["QUESTION_GENERATION", "KEYWORD_TAGGING"] } }, select: { id: true } });
  if (!job) throw new ServiceError("JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다", 404);
  const runs = await prisma.jobRunLog.findMany({ where: { OR: [{ jobId }, { job: { parentJobId: jobId, type: "GENERATION_ITEM_REVISION" } }] }, orderBy: [{ startedAt: "asc" }, { id: "asc" }] });
  return runs.map(toDto);
}
