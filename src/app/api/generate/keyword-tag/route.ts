import { z } from "zod";
import { createKeywordTagJob } from "@/server/generation/generation-service";
import { handleApiError, jsonOk, parseBody } from "@/server/http";

const createSchema = z.object({
  topicId: z.number().int().positive(),
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
});

export async function POST(req: Request) {
  try {
    const input = await parseBody(req, createSchema);
    return jsonOk({ job: await createKeywordTagJob(input) }, 202);
  } catch (e) {
    return handleApiError(e);
  }
}
