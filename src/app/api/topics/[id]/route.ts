import { z } from "zod";
import { isSafeReferencePath } from "@/core/reference-path";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";
import { deleteTopic, updateTopic } from "@/server/topic-service";

const updateSchema = z.object({
  name: z.string().trim().min(1).max(100).optional(),
  description: z.string().optional(),
  referenceDir: z
    .union([z.string().trim().max(200), z.null()])
    .optional()
    .transform((value) => (value === "" ? null : value))
    .refine(
      (value) => value === undefined || value === null || isSafeReferencePath(value),
      { message: "잘못된 참고 자료 폴더 경로입니다" },
    ),
});

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const input = await parseBody(req, updateSchema);
    return jsonOk(await updateTopic(parseIdParam(id), input));
  } catch (e) {
    return handleApiError(e);
  }
}

export async function DELETE(_req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    await deleteTopic(parseIdParam(id));
    return jsonOk({ ok: true });
  } catch (e) {
    return handleApiError(e);
  }
}
