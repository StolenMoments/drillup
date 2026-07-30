import type { GenerationRunLog } from "@prisma/client";
import type { GenerationRunLogDto } from "@/lib/api-types";
import { prisma } from "../db";
import { ServiceError } from "../errors";

function toDto(run: GenerationRunLog): GenerationRunLogDto {
  return { id: run.id, stage: run.stage, itemIndex: run.itemIndex, attempt: run.attempt, engine: run.engine, model: run.model, status: run.status, prompt: run.prompt, response: run.response, stdoutTail: run.stdoutTail, stderrTail: run.stderrTail, errorMessage: run.errorMessage, exitCode: run.exitCode, timedOut: run.timedOut, startedAt: run.startedAt.toISOString(), finishedAt: run.finishedAt?.toISOString() ?? null, durationMs: run.durationMs };
}

export async function getJobDiagnostics(jobId: number): Promise<GenerationRunLogDto[]> {
  const job = await prisma.generationJob.findUnique({ where: { id: jobId }, select: { id: true } });
  if (!job) throw new ServiceError("JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다", 404);
  const runs = await prisma.generationRunLog.findMany({ where: { generationJobId: jobId }, orderBy: [{ startedAt: "asc" }, { id: "asc" }] });
  return runs.map(toDto);
}
