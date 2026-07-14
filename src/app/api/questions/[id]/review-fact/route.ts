import { z } from "zod";
import { reviewFactualConcern } from "@/server/factual-review-service";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";

const bodySchema = z.object({
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
  concern: z.string().trim().min(1, "concern이 필요합니다"),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { engine, concern } = await parseBody(req, bodySchema);
    return jsonOk(await reviewFactualConcern(parseIdParam(id), engine, concern));
  } catch (e) {
    return handleApiError(e);
  }
}
