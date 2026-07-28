import { getAnswerExplanationJob } from "@/server/explanation-job-service";
import { handleApiError, jsonOk, parseIdParam } from "@/server/http";

type Ctx = { params: Promise<{ id: string; jobId: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id, jobId } = await ctx.params;
    const job = await getAnswerExplanationJob(
      parseIdParam(id),
      parseIdParam(jobId),
    );
    return jsonOk({ job });
  } catch (error) {
    return handleApiError(error);
  }
}
