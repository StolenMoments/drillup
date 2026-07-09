import { z } from "zod";
import { approveJob } from "@/server/generation/generation-service";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";

const approveSchema = z.object({
  indices: z.array(z.number().int().nonnegative()).min(1).max(200),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { indices } = await parseBody(req, approveSchema);
    return jsonOk(await approveJob(parseIdParam(id), indices));
  } catch (e) {
    return handleApiError(e);
  }
}
