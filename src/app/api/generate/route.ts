import { z } from "zod";
import { createJob, listJobs } from "@/server/generation/generation-service";
import { handleApiError, jsonOk, parseBody } from "@/server/http";

const createSchema = z.object({
  topicId: z.number().int().positive(),
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
  verifyEngine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
  instructions: z.string().max(4000),
  referenceFiles: z.array(z.string().min(1).max(300)).max(100).default([]),
  sourceQuestionIds: z.array(z.number().int().positive()).max(10).optional(),
});

export async function POST(req: Request) {
  try {
    const input = await parseBody(req, createSchema);
    return jsonOk({ job: await createJob(input) }, 202);
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
