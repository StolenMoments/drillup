import { getFactualReviewJob } from "@/server/factual-review-job-service";
import { handleApiError, jsonOk, parseIdParam } from "@/server/http";

type Ctx = { params: Promise<{ id: string; jobId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id, jobId } = await ctx.params;
    const job = await getFactualReviewJob(
      parseIdParam(id),
      parseIdParam(jobId),
    );
    return jsonOk({ job });
  } catch (error) {
    return handleApiError(error);
  }
}
