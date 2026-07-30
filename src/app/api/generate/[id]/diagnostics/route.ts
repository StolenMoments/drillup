import { parseIdParam, handleApiError, jsonOk } from "@/server/http";
import { getJobDiagnostics } from "@/server/generation/generation-diagnostics-service";

type Ctx = { params: Promise<{ id: string }> };
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    return jsonOk({ runs: await getJobDiagnostics(parseIdParam(id)) });
  } catch (error) { return handleApiError(error); }
}
