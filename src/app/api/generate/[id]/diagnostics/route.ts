import { parseIdParam, handleApiError, jsonOk } from "@/server/http";

type Ctx = { params: Promise<{ id: string }> };
export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { getJobDiagnostics } = await import("@/server/generation/generation-diagnostics-service");
    return jsonOk({ runs: await getJobDiagnostics(parseIdParam(id)) });
  } catch (error) { return handleApiError(error); }
}
