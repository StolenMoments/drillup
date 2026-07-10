import { z } from "zod";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";
import { addQuestionKeyword } from "@/server/keyword-service";

const addSchema = z.object({ name: z.string().min(1).max(100) });

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const input = await parseBody(req, addSchema);
    return jsonOk(await addQuestionKeyword(parseIdParam(id), input.name));
  } catch (e) {
    return handleApiError(e);
  }
}
