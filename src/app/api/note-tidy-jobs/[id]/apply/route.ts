import { applyNoteTidyJob } from "@/server/note-service";
import { handleApiError, jsonOk, parseIdParam } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    return jsonOk(await applyNoteTidyJob(parseIdParam(id)));
  } catch (e) {
    return handleApiError(e);
  }
}
