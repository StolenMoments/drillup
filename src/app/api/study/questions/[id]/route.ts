import { handleApiError, jsonOk, parseIdParam } from "@/server/http";
import { getStudyQuestion } from "@/server/study-service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    return jsonOk(await getStudyQuestion(parseIdParam(id)));
  } catch (error) {
    return handleApiError(error);
  }
}
