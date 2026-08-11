import { z } from "zod";
import { after } from "next/server";
import { runFactualReviewJob } from "@/server/factual-review-job-runner";
import { startFreshnessReviewJob } from "@/server/factual-review-job-service";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";

const bodySchema = z.object({
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { engine } = await parseBody(req, bodySchema);
    const job = await startFreshnessReviewJob(parseIdParam(id), engine);
    after(async () => {
      try {
        await runFactualReviewJob(job.id);
      } catch (error) {
        console.error("freshness review runner failed", error);
      }
    });
    return jsonOk({ job }, 202);
  } catch (error) {
    return handleApiError(error);
  }
}
