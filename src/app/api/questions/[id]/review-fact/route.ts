import { z } from "zod";
import { after } from "next/server";
import { runFactualReviewJob } from "@/server/factual-review-job-runner";
import { startFactualReviewJob } from "@/server/factual-review-job-service";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";

const bodySchema = z.object({
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
  concern: z.string().trim().min(1, "concern이 필요합니다"),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { engine, concern } = await parseBody(req, bodySchema);
    const job = await startFactualReviewJob(parseIdParam(id), engine, concern);
    after(async () => {
      try {
        await runFactualReviewJob(job.id);
      } catch (error) {
        console.error("factual review runner failed", error);
      }
    });
    return jsonOk({ job }, 202);
  } catch (e) {
    return handleApiError(e);
  }
}
