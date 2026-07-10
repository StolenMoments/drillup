import { z } from "zod";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";
import { suggestQuestionKeywords } from "@/server/keyword-suggestion-service";

const bodySchema = z.object({
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { engine } = await parseBody(req, bodySchema);
    return jsonOk(
      await suggestQuestionKeywords(parseIdParam(id), engine),
    );
  } catch (e) {
    return handleApiError(e);
  }
}
