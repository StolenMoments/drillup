import { z } from "zod";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";
import {
  deleteQuestion,
  getQuestion,
  updateQuestion,
} from "@/server/question-service";

const updateSchema = z.object({
  payload: z.unknown(),
  explanation: z.string().nullable(),
});

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    return jsonOk(await getQuestion(parseIdParam(id)));
  } catch (e) {
    return handleApiError(e);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const input = await parseBody(req, updateSchema);
    return jsonOk(
      await updateQuestion(parseIdParam(id), {
        payload: input.payload,
        explanation: input.explanation,
      }),
    );
  } catch (e) {
    return handleApiError(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteQuestion(parseIdParam(id));
    return jsonOk({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
