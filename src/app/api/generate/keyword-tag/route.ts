import { z } from "zod";
import { after } from "next/server";
import { createKeywordTagJob, runGenerationJob } from "@/server/generation/generation-service";
import { handleApiError, jsonOk, parseBody } from "@/server/http";

const createSchema = z.object({
  topicId: z.number().int().positive(),
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
});

export async function POST(req: Request) {
  try {
    const input = await parseBody(req, createSchema);
    const job = await createKeywordTagJob(input);
    if (job.status === "PENDING") {
      after(async () => {
        try {
          await runGenerationJob(job.id);
        } catch (error) {
          console.error(`keyword tag job ${job.id} runner failed`, error);
        }
      });
    }
    return jsonOk({ job }, 202);
  } catch (e) {
    return handleApiError(e);
  }
}
