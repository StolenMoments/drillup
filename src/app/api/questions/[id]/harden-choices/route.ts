import { z } from "zod";
import { hardenQuestionChoices } from "@/server/choice-hardening-service";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";

const bodySchema = z.object({
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
  verifyEngine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { engine, verifyEngine } = await parseBody(req, bodySchema);
    return jsonOk(await hardenQuestionChoices(parseIdParam(id), engine, verifyEngine));
  } catch (e) {
    return handleApiError(e);
  }
}
