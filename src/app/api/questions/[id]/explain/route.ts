import { z } from "zod";
import { after } from "next/server";
import { runAnswerExplanationJob } from "@/server/explanation-job-runner";
import { startAnswerExplanationJob } from "@/server/explanation-job-service";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";

const bodySchema = z.object({
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { engine } = await parseBody(req, bodySchema);
    const job = await startAnswerExplanationJob(parseIdParam(id), engine);
    if (job.status === "RUNNING") {
      after(async () => {
        try {
          await runAnswerExplanationJob(job.id);
        } catch (error) {
          console.error("answer explanation runner failed", error);
        }
      });
    }
    return jsonOk({ job }, job.status === "RUNNING" ? 202 : 200);
  } catch (e) {
    return handleApiError(e);
  }
}
