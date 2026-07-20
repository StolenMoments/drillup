import { z } from "zod";
import { extractNoteFromQuestion } from "@/server/note-extract-service";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";

const bodySchema = z.object({
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { engine } = await parseBody(req, bodySchema);
    return jsonOk(await extractNoteFromQuestion(parseIdParam(id), engine));
  } catch (e) {
    return handleApiError(e);
  }
}
