import { getTopicReferenceFiles } from "@/server/generation/reference";
import { handleApiError, jsonOk, parseIdParam } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    return jsonOk(await getTopicReferenceFiles(parseIdParam(id)));
  } catch (e) {
    return handleApiError(e);
  }
}
