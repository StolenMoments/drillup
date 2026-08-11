import { getFreshnessReviewJob } from "@/server/factual-review-job-service";
import { handleApiError, jsonOk, parseIdParam } from "@/server/http";

type Ctx = { params: Promise<{ id: string; jobId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id, jobId } = await ctx.params;
    return jsonOk({ job: await getFreshnessReviewJob(parseIdParam(id), parseIdParam(jobId)) });
  } catch (error) {
    return handleApiError(error);
  }
}
