import { applyChoiceHardeningJob } from "@/server/choice-hardening-service";
import { handleApiError, jsonOk, parseIdParam } from "@/server/http";

type Ctx = { params: Promise<{ id: string; jobId: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { id, jobId } = await ctx.params;
    await applyChoiceHardeningJob(parseIdParam(id), parseIdParam(jobId));
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error);
  }
}
