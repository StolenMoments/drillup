import { z } from "zod";
import { getTopicNote, saveTopicNote } from "@/server/note-service";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";

const putSchema = z.object({ content: z.string().max(100_000) });

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    return jsonOk(await getTopicNote(parseIdParam(id)));
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { content } = await parseBody(req, putSchema);
    return jsonOk(await saveTopicNote(parseIdParam(id), content));
  } catch (e) {
    return handleApiError(e);
  }
}
