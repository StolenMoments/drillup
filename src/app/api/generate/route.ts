import { z } from "zod";
import { after } from "next/server";
import { createJob, listJobs, runGenerationJob } from "@/server/generation/generation-service";
import { handleApiError, jsonOk, parseBody } from "@/server/http";

const createSchema = z.object({
  topicId: z.number().int().positive(),
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
  verifyEngine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
  instructions: z.string().max(4000),
  correctAnswerCount: z.union([z.literal(1), z.literal(2)]),
  choiceCount: z.union([z.literal(4), z.literal(5), z.literal(6)]),
  referenceFiles: z.array(z.string().min(1).max(300)).max(100).default([]),
  sourceQuestionIds: z.array(z.number().int().positive()).max(10).optional(),
  retryOfJobId: z.number().int().positive().optional(),
});

export async function POST(req: Request) {
  try {
    const input = await parseBody(req, createSchema);
    const job = await createJob(input);
    if (job.status === "PENDING") {
      after(async () => {
        try {
          await runGenerationJob(job.id);
        } catch (error) {
          console.error(`generation job ${job.id} runner failed`, error);
        }
      });
    }
    return jsonOk({ job }, 202);
  } catch (e) {
    return handleApiError(e);
  }
}

export async function GET() {
  try {
    return jsonOk({ jobs: await listJobs() });
  } catch (e) {
    return handleApiError(e);
  }
}
