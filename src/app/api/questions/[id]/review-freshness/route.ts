import { z } from "zod";
import { after } from "next/server";
import { runFactualReviewJob } from "@/server/factual-review-job-runner";
import { startFreshnessReviewJob } from "@/server/factual-review-job-service";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";

const bodySchema = z.object({
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
  force: z.boolean().optional().default(false),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { engine, force } = await parseBody(req, bodySchema);
    const started = await startFreshnessReviewJob(
      parseIdParam(id),
      engine,
      force,
    );
    if (started.shouldRun) {
      after(async () => {
        try {
          await runFactualReviewJob(started.job.id);
        } catch (error) {
          console.error("freshness review runner failed", error);
        }
      });
    }
    const status = started.reused && started.job.status === "SUCCEEDED"
      ? 200
      : 202;
    return jsonOk({ job: started.job, reused: started.reused }, status);
  } catch (error) {
    return handleApiError(error);
  }
}
