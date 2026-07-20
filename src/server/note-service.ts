import type { GenerationEngine, NoteTidyJob, Prisma } from "@prisma/client";
import { sha256Fingerprint } from "@/core/stable-json";
import type { NoteTidyJobDto, TopicNoteDto } from "@/lib/api-types";
import { prisma } from "./db";
import { ServiceError } from "./errors";
import { generationTimeoutMs } from "./generation/run-engine";

const STALE_GRACE_MS = 60_000;
const STALE_JOB_MESSAGE = "서버 재시작 또는 시간 초과로 작업이 중단되었습니다";
const MAX_NOTE_LENGTH = 100_000;

function toJobDto(job: NoteTidyJob): NoteTidyJobDto {
  return {
    id: job.id,
    topicId: job.topicId,
    sourceHash: job.sourceHash,
    engine: job.engine,
    status: job.status,
    preview: job.preview,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
    appliedAt: job.appliedAt?.toISOString() ?? null,
    dismissedAt: job.dismissedAt?.toISOString() ?? null,
  };
}

async function recoverStaleNoteTidyJobs(): Promise<void> {
  const staleBefore = new Date(
    Date.now() - generationTimeoutMs() - STALE_GRACE_MS,
  );
  await prisma.noteTidyJob.updateMany({
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

async function requireTopic(topicId: number): Promise<void> {
  const topic = await prisma.topic.findUnique({
    where: { id: topicId },
    select: { id: true },
  });
  if (!topic) {
    throw new ServiceError("NOT_FOUND", "주제를 찾을 수 없습니다", 404);
  }
}

type NoteTidyJobClient = Pick<Prisma.TransactionClient, "noteTidyJob">;

// RUNNING이거나, SUCCEEDED인데 아직 반영/폐기되지 않은 최신 잡 (스펙 §4·§7)
async function findActiveTidyJob(
  client: NoteTidyJobClient,
  topicId: number,
): Promise<NoteTidyJob | null> {
  return client.noteTidyJob.findFirst({
    where: {
      topicId,
      OR: [
        { status: "RUNNING" },
        { status: "SUCCEEDED", appliedAt: null, dismissedAt: null },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
  });
}

async function toNoteDto(topicId: number): Promise<TopicNoteDto> {
  const [note, activeJob] = await Promise.all([
    prisma.topicNote.findUnique({ where: { topicId } }),
    findActiveTidyJob(prisma, topicId),
  ]);
  return {
    content: note?.content ?? "",
    updatedAt: note?.updatedAt.toISOString() ?? null,
    activeTidyJob: activeJob
      ? { id: activeJob.id, status: activeJob.status }
      : null,
  };
}

export async function getTopicNote(topicId: number): Promise<TopicNoteDto> {
  await recoverStaleNoteTidyJobs();
  await requireTopic(topicId);
  return toNoteDto(topicId);
}

export async function saveTopicNote(
  topicId: number,
  content: string,
): Promise<TopicNoteDto> {
  await requireTopic(topicId);
  if (content.length > MAX_NOTE_LENGTH) {
    throw new ServiceError("VALIDATION", "노트가 너무 깁니다", 400);
  }
  await prisma.topicNote.upsert({
    where: { topicId },
    create: { topicId, content },
    update: { content },
  });
  return toNoteDto(topicId);
}

export async function startNoteTidyJob(
  topicId: number,
  engine: GenerationEngine,
): Promise<NoteTidyJobDto> {
  await recoverStaleNoteTidyJobs();
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM topic WHERE id = ${topicId} FOR UPDATE`;
    const topic = await tx.topic.findUnique({
      where: { id: topicId },
      select: { id: true },
    });
    if (!topic) {
      throw new ServiceError("NOT_FOUND", "주제를 찾을 수 없습니다", 404);
    }

    const note = await tx.topicNote.findUnique({ where: { topicId } });
    if (!note || note.content.trim().length === 0) {
      throw new ServiceError("VALIDATION", "정리할 노트가 없습니다", 400);
    }

    const active = await findActiveTidyJob(tx, topicId);
    if (active) {
      throw new ServiceError(
        "NOTE_TIDY_ACTIVE_EXISTS",
        active.status === "RUNNING"
          ? "이미 진행 중인 정리 작업이 있습니다"
          : "처리하지 않은 정리 결과가 있습니다. 먼저 반영하거나 폐기해 주세요",
        409,
      );
    }

    const sourceHash = await sha256Fingerprint(note.content);
    const job = await tx.noteTidyJob.create({
      data: { topicId, sourceHash, engine },
    });
    return toJobDto(job);
  });
}

export async function getNoteTidyJob(jobId: number): Promise<NoteTidyJobDto> {
  await recoverStaleNoteTidyJobs();
  const job = await prisma.noteTidyJob.findUnique({ where: { id: jobId } });
  if (!job) {
    throw new ServiceError("NOT_FOUND", "노트 정리 작업을 찾을 수 없습니다", 404);
  }
  return toJobDto(job);
}

export async function applyNoteTidyJob(jobId: number): Promise<TopicNoteDto> {
  const topicId = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM note_tidy_job WHERE id = ${jobId} FOR UPDATE`;
    const job = await tx.noteTidyJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new ServiceError("NOT_FOUND", "노트 정리 작업을 찾을 수 없습니다", 404);
    }
    if (job.appliedAt) return job.topicId;
    if (job.dismissedAt) {
      throw new ServiceError(
        "NOTE_TIDY_DISMISSED",
        "폐기된 작업은 반영할 수 없습니다",
        409,
      );
    }
    if (job.status !== "SUCCEEDED" || job.preview === null) {
      throw new ServiceError(
        "NOTE_TIDY_NOT_READY",
        "완료된 정리 결과만 반영할 수 있습니다",
        409,
      );
    }

    await tx.$queryRaw`SELECT id FROM topic_note WHERE topic_id = ${job.topicId} FOR UPDATE`;
    const note = await tx.topicNote.findUnique({
      where: { topicId: job.topicId },
    });
    const currentHash = note ? await sha256Fingerprint(note.content) : null;
    if (!note || currentHash !== job.sourceHash) {
      throw new ServiceError(
        "NOTE_TIDY_SOURCE_CHANGED",
        "노트가 그 사이 수정되어 반영할 수 없습니다. 초안을 폐기하고 다시 실행해 주세요",
        409,
      );
    }

    await tx.topicNote.update({
      where: { topicId: job.topicId },
      data: { content: job.preview },
    });
    await tx.noteTidyJob.update({
      where: { id: jobId },
      data: { appliedAt: new Date() },
    });
    return job.topicId;
  });
  return toNoteDto(topicId);
}

export async function dismissNoteTidyJob(jobId: number): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM note_tidy_job WHERE id = ${jobId} FOR UPDATE`;
    const job = await tx.noteTidyJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new ServiceError("NOT_FOUND", "노트 정리 작업을 찾을 수 없습니다", 404);
    }
    if (job.appliedAt) {
      throw new ServiceError(
        "NOTE_TIDY_ALREADY_APPLIED",
        "이미 반영된 작업은 폐기할 수 없습니다",
        409,
      );
    }
    if (job.status === "RUNNING") {
      throw new ServiceError(
        "NOTE_TIDY_NOT_READY",
        "진행 중인 작업은 폐기할 수 없습니다",
        409,
      );
    }
    if (job.dismissedAt) return;
    await tx.noteTidyJob.updateMany({
      where: { id: jobId, appliedAt: null, dismissedAt: null },
      data: { dismissedAt: new Date() },
    });
  });
}
