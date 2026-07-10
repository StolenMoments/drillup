import { handleApiError, jsonOk, parseIdParam } from "@/server/http";
import { removeQuestionKeyword } from "@/server/keyword-service";

type Ctx = { params: Promise<{ id: string; keywordId: string }> };

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id, keywordId } = await ctx.params;
    await removeQuestionKeyword(parseIdParam(id), parseIdParam(keywordId));
    return jsonOk({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
