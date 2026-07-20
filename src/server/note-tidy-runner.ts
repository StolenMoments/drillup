import path from "node:path";
import { extractJsonObject } from "@/core/json-extract";
import { buildNoteTidyPrompt } from "@/core/note-tidy-prompt";
import { parseNoteTidyResult } from "@/core/note-tidy-result";
import { sha256Fingerprint } from "@/core/stable-json";
import { prisma } from "./db";
import { runEngine } from "./generation/run-engine";

function outputDir(jobId: number): string {
  return path.resolve("generation_output", "note-tidy", "jobs", String(jobId));
}

async function markFailed(jobId: number, errorMessage: string): Promise<void> {
  await prisma.noteTidyJob.updateMany({
    where: { id: jobId, status: "RUNNING" },
    data: { status: "FAILED", errorMessage, finishedAt: new Date() },
  });
}

export async function runNoteTidyJob(jobId: number): Promise<void> {
  const claimed = await prisma.noteTidyJob.updateMany({
    where: { id: jobId, status: "RUNNING", startedAt: null },
    data: { startedAt: new Date() },
  });
  if (claimed.count === 0) return;

  try {
    const job = await prisma.noteTidyJob.findUnique({ where: { id: jobId } });
    if (!job || job.status !== "RUNNING") return;

    const note = await prisma.topicNote.findUnique({
      where: { topicId: job.topicId },
    });
    if (!note) {
      await markFailed(jobId, "노트를 찾을 수 없습니다");
      return;
    }
    if ((await sha256Fingerprint(note.content)) !== job.sourceHash) {
      await markFailed(
        jobId,
        "정리 작업 시작 후 노트가 변경되어 작업을 중단했습니다",
      );
      return;
    }

    const dir = outputDir(job.id);
    const prompt = buildNoteTidyPrompt(
      note.content,
      path.join(dir, "result.json"),
    );
    const run = await runEngine(job.engine, prompt, dir);
    if (!run.ok) {
      await markFailed(jobId, run.failureReason);
      return;
    }
    const parsed = parseNoteTidyResult(extractJsonObject(run.resultText));
    if (!parsed.ok) {
      await markFailed(jobId, `정리 결과를 해석하지 못했습니다: ${parsed.fatal}`);
      return;
    }
    await prisma.noteTidyJob.updateMany({
      where: { id: jobId, status: "RUNNING" },
      data: {
        status: "SUCCEEDED",
        preview: parsed.note,
        errorMessage: null,
        finishedAt: new Date(),
      },
    });
  } catch (error) {
    await markFailed(
      jobId,
      error instanceof Error
        ? error.message
        : "노트 정리 작업 중 알 수 없는 오류가 발생했습니다",
    );
  }
}
