import { prisma } from "./db";
import { ServiceError } from "./errors";
import { generateAndCacheExplanation } from "./explanation-service";

export async function runAnswerExplanationJob(jobId: number): Promise<void> {
  const claimedAt = new Date();
  const claimed = await prisma.answerExplanationJob.updateMany({
    where: { id: jobId, status: "RUNNING", startedAt: null },
    data: { startedAt: claimedAt },
  });
  if (claimed.count === 0) return;

  const job = await prisma.answerExplanationJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RUNNING" || !job.startedAt) return;

  try {
    await generateAndCacheExplanation(job.questionId, job.engine);
    await prisma.answerExplanationJob.updateMany({
      where: { id: jobId, startedAt: claimedAt, status: "RUNNING" },
      data: { status: "SUCCEEDED", finishedAt: new Date() },
    });
  } catch (error) {
    await prisma.answerExplanationJob.updateMany({
      where: { id: jobId, startedAt: claimedAt, status: "RUNNING" },
      data: {
        status: "FAILED",
        errorMessage: error instanceof ServiceError
          ? error.message
          : (error instanceof Error ? error.message : "해설 생성 중 알 수 없는 오류가 발생했습니다"),
        finishedAt: new Date(),
      },
    });
  }
}
