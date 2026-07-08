import path from "node:path";
import type { GenerationJob, Prisma } from "@prisma/client";
import { parseImportJson } from "@/core/import-schema";
import { extractJsonObject } from "@/core/json-extract";
import { buildCliGenerationPrompt } from "@/core/prompt-template";
import type { GenerationEngineDto, GenerationJobDto } from "@/lib/api-types";
import { prisma } from "../db";
import { ServiceError } from "../errors";
import { generationTimeoutMs, jobOutputDir, runEngine } from "./run-engine";

const ORPHAN_GRACE_MS = 60_000;

function toDto(job: GenerationJob): GenerationJobDto {
  return {
    id: job.id,
    topicId: job.topicId,
    engine: job.engine,
    status: job.status,
    items:
      job.status === "SUCCEEDED"
        ? (job.result as unknown as GenerationJobDto["items"])
        : null,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

export async function createJob(input: {
  topicId: number;
  engine: GenerationEngineDto;
  instructions: string;
}): Promise<GenerationJobDto> {
  const topic = await prisma.topic.findUnique({ where: { id: input.topicId } });
  if (!topic) {
    throw new ServiceError("TOPIC_NOT_FOUND", "주제를 찾을 수 없습니다", 404);
  }

  const running = await prisma.generationJob.findFirst({
    where: { topicId: input.topicId, status: "RUNNING" },
  });
  if (running) {
    throw new ServiceError(
      "JOB_ALREADY_RUNNING",
      "이미 생성 중인 작업이 있습니다",
      409,
    );
  }

  const job = await prisma.generationJob.create({
    data: {
      topicId: input.topicId,
      engine: input.engine,
      instructions: input.instructions,
    },
  });

  void runJob(job.id, topic.name, input.instructions).catch((e) => {
    console.error(`generation job ${job.id} failed unexpectedly`, e);
  });

  return toDto(job);
}

async function runJob(
  jobId: number,
  topicName: string,
  instructions: string,
): Promise<void> {
  const resultPath = path.join(jobOutputDir(jobId), "result.json");
  const prompt = buildCliGenerationPrompt(topicName, instructions, resultPath);

  const job = await prisma.generationJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RUNNING") return;

  const run = await runEngine(job.engine, prompt, jobId);
  if (!run.ok) {
    await failJob(jobId, run.failureReason, null);
    return;
  }

  const parsed = parseImportJson(extractJsonObject(run.resultText));
  if (!parsed.ok) {
    await failJob(
      jobId,
      `${parsed.fatal}; 원문 앞 300자: ${run.resultText.slice(0, 300)}`,
      run.resultText,
    );
    return;
  }

  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      result: parsed.items as unknown as Prisma.InputJsonValue,
      rawOutput: run.resultText,
      finishedAt: new Date(),
    },
  });
}

async function failJob(
  jobId: number,
  message: string,
  rawOutput: string | null,
): Promise<void> {
  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      errorMessage: message,
      rawOutput,
      finishedAt: new Date(),
    },
  });
}

export async function getJob(id: number): Promise<GenerationJobDto> {
  const job = await prisma.generationJob.findUnique({ where: { id } });
  if (!job) {
    throw new ServiceError("JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다", 404);
  }

  if (
    job.status === "RUNNING" &&
    Date.now() - job.createdAt.getTime() > generationTimeoutMs() + ORPHAN_GRACE_MS
  ) {
    const updated = await prisma.generationJob.update({
      where: { id },
      data: {
        status: "FAILED",
        errorMessage: "시간 초과 또는 서버 재시작으로 중단되었습니다",
        finishedAt: new Date(),
      },
    });
    return toDto(updated);
  }

  return toDto(job);
}
