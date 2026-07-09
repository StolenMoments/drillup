import { rm } from "node:fs/promises";
import path from "node:path";
import type { GenerationJob, Prisma } from "@prisma/client";
import { parseImportJson, type ImportQuestion } from "@/core/import-schema";
import { extractJsonObject } from "@/core/json-extract";
import {
  buildCliGenerationPrompt,
  buildCliVerifyPrompt,
  type ExistingQuestions,
} from "@/core/prompt-template";
import { capSummaries, summarizeQuestionPayload } from "@/core/question-summary";
import { mergeVerdicts, parseVerifyJson } from "@/core/verify-schema";
import type {
  GenerationEngineDto,
  GenerationItemDto,
  GenerationJobDto,
  GenerationJobSummaryDto,
} from "@/lib/api-types";
import { prisma } from "../db";
import { ServiceError } from "../errors";
import { importQuestions } from "../import-service";
import { resolveReferenceFiles } from "./reference";
import { generationTimeoutMs, jobOutputDir, runEngine } from "./run-engine";

const ORPHAN_GRACE_MS = 60_000;
const EXISTING_QUESTION_LIMIT = 100;

function toDto(job: GenerationJob): GenerationJobDto {
  return {
    id: job.id,
    topicId: job.topicId,
    engine: job.engine,
    verifyEngine: job.verifyEngine,
    status: job.status,
    items:
      job.status === "SUCCEEDED"
        ? (job.result as unknown as GenerationJobDto["items"])
        : null,
    errorMessage: job.errorMessage,
    verifyWarning: job.verifyWarning,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    approvedAt: job.approvedAt?.toISOString() ?? null,
    savedCount: job.savedCount,
  };
}

function toSummaryDto(
  job: GenerationJob & { topic: { name: string } },
): GenerationJobSummaryDto {
  const items = job.result as unknown as GenerationItemDto[] | null;
  return {
    id: job.id,
    topicId: job.topicId,
    topicName: job.topic.name,
    engine: job.engine,
    verifyEngine: job.verifyEngine,
    status: job.status,
    itemCount: job.status === "SUCCEEDED" && items ? items.length : null,
    savedCount: job.savedCount,
    approvedAt: job.approvedAt?.toISOString() ?? null,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

async function loadExistingQuestions(
  topicId: number,
): Promise<ExistingQuestions> {
  const [total, questions] = await Promise.all([
    prisma.question.count({ where: { topicId } }),
    prisma.question.findMany({
      where: { topicId },
      orderBy: { createdAt: "desc" },
      take: EXISTING_QUESTION_LIMIT,
      select: { type: true, payload: true },
    }),
  ]);
  const capped = capSummaries(
    questions.map((question) =>
      summarizeQuestionPayload(question.type, question.payload),
    ),
  );
  return {
    summaries: capped.kept,
    truncated: capped.truncated || total > EXISTING_QUESTION_LIMIT,
  };
}

export async function createJob(input: {
  topicId: number;
  engine: GenerationEngineDto;
  verifyEngine: GenerationEngineDto;
  instructions: string;
  referenceFiles: string[];
}): Promise<GenerationJobDto> {
  const topic = await prisma.topic.findUnique({ where: { id: input.topicId } });
  if (!topic) {
    throw new ServiceError("TOPIC_NOT_FOUND", "주제를 찾을 수 없습니다", 404);
  }

  const running = await prisma.generationJob.findFirst({
    where: { topicId: input.topicId, status: { in: ["RUNNING", "VERIFYING"] } },
  });
  if (running) {
    throw new ServiceError(
      "JOB_ALREADY_RUNNING",
      "이미 생성 중인 작업이 있습니다",
      409,
    );
  }

  const referenceAbsPaths = await resolveReferenceFiles(
    topic.referenceDir,
    input.referenceFiles,
  );
  const existing = await loadExistingQuestions(input.topicId);

  const job = await prisma.generationJob.create({
    data: {
      topicId: input.topicId,
      engine: input.engine,
      verifyEngine: input.verifyEngine,
      instructions: input.instructions,
      referenceFiles: input.referenceFiles,
    },
  });

  void runJob(
    job.id,
    topic.name,
    input.instructions,
    existing,
    referenceAbsPaths,
  ).catch((e) => {
    console.error(`generation job ${job.id} failed unexpectedly`, e);
  });

  return toDto(job);
}

async function runJob(
  jobId: number,
  topicName: string,
  instructions: string,
  existing: ExistingQuestions,
  referenceAbsPaths: string[],
): Promise<void> {
  const dir = jobOutputDir(jobId);
  const resultPath = path.join(dir, "result.json");
  const prompt = buildCliGenerationPrompt(
    topicName,
    instructions,
    resultPath,
    existing,
    referenceAbsPaths,
  );

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

  // 이 시점의 verdict는 전부 unverified — 검증이 끝나면 덮어쓴다.
  const unverifiedItems = mergeVerdicts(parsed.items, []);
  const validItems = parsed.items.filter((item) => item.ok);

  if (validItems.length === 0) {
    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: "SUCCEEDED",
        result: unverifiedItems as unknown as Prisma.InputJsonValue,
        rawOutput: run.resultText,
        finishedAt: new Date(),
      },
    });
    return;
  }

  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "VERIFYING",
      result: unverifiedItems as unknown as Prisma.InputJsonValue,
      rawOutput: run.resultText,
    },
  });

  const verifyResultPath = path.join(dir, "verify-result.json");
  const verifyPrompt = buildCliVerifyPrompt(
    topicName,
    validItems.map((item) => ({ index: item.index, question: item.question })),
    verifyResultPath,
    referenceAbsPaths,
  );

  let finalItems = unverifiedItems;
  let verifyWarning: string | null = null;

  const verifyRun = await runEngine(job.verifyEngine, verifyPrompt, jobId, "verify-");
  if (!verifyRun.ok) {
    verifyWarning = verifyRun.failureReason;
  } else {
    const verdicts = parseVerifyJson(extractJsonObject(verifyRun.resultText));
    if (!verdicts.ok) {
      verifyWarning = `검증 결과를 해석하지 못했습니다: ${verdicts.fatal}`;
    } else {
      finalItems = mergeVerdicts(parsed.items, verdicts.verdicts);
    }
  }

  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      result: finalItems as unknown as Prisma.InputJsonValue,
      verifyWarning,
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

  // 생성·검증 단계가 각각 타임아웃을 가지므로 고아 판정 기준은 2배 + 유예.
  const orphanAfterMs = 2 * generationTimeoutMs() + ORPHAN_GRACE_MS;
  const isStale = Date.now() - job.createdAt.getTime() > orphanAfterMs;

  if (job.status === "RUNNING" && isStale) {
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

  if (job.status === "VERIFYING" && isStale) {
    // 생성 결과(전 항목 unverified)는 VERIFYING 전환 시점에 이미 저장돼 있다.
    const updated = await prisma.generationJob.update({
      where: { id },
      data: {
        status: "SUCCEEDED",
        verifyWarning: "시간 초과 또는 서버 재시작으로 검증이 중단되었습니다",
        finishedAt: new Date(),
      },
    });
    return toDto(updated);
  }

  return toDto(job);
}

export async function approveJob(
  id: number,
  indices: number[],
): Promise<{ savedCount: number; job: GenerationJobDto }> {
  const job = await prisma.generationJob.findUnique({ where: { id } });
  if (!job) {
    throw new ServiceError("JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다", 404);
  }
  if (job.status !== "SUCCEEDED") {
    throw new ServiceError(
      "JOB_NOT_APPROVABLE",
      "완료된 작업만 저장할 수 있습니다",
      409,
    );
  }

  const items = job.result as unknown as GenerationItemDto[] | null;
  const byIndex = new Map(items?.map((item) => [item.index, item]) ?? []);
  const questions: ImportQuestion[] = [];
  for (const index of indices) {
    const item = byIndex.get(index);
    if (!item || !item.ok) {
      throw new ServiceError(
        "INVALID_ITEMS",
        "저장할 수 없는 항목이 포함되어 있습니다",
        400,
      );
    }
    questions.push(item.question as unknown as ImportQuestion);
  }
  if (questions.length === 0) {
    throw new ServiceError("INVALID_ITEMS", "저장할 항목이 없습니다", 400);
  }

  const savedCount = await importQuestions(job.topicId, questions);
  const updated = await prisma.generationJob.update({
    where: { id },
    data: { approvedAt: new Date(), savedCount: { increment: savedCount } },
  });
  return { savedCount, job: toDto(updated) };
}

export async function deleteJob(id: number): Promise<void> {
  const job = await prisma.generationJob.findUnique({ where: { id } });
  if (!job) {
    throw new ServiceError("JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다", 404);
  }
  if (job.status === "RUNNING" || job.status === "VERIFYING") {
    throw new ServiceError(
      "JOB_RUNNING",
      "진행 중인 작업은 삭제할 수 없습니다",
      409,
    );
  }

  await prisma.generationJob.delete({ where: { id } });
  await rm(jobOutputDir(id), { recursive: true, force: true }).catch(() => {
    // 출력 디렉터리 정리는 best-effort로 처리한다.
  });
}

export async function listJobs(): Promise<GenerationJobSummaryDto[]> {
  const jobs = await prisma.generationJob.findMany({
    where: { status: { in: ["RUNNING", "VERIFYING"] } },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { topic: { select: { name: true } } },
  });
  return jobs.map(toSummaryDto);
}
