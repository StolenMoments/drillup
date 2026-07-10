import { z } from "zod";
import {
  createItemRevision,
  setItemRevisionUsage,
} from "@/server/generation/generation-service";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";

const createSchema = z.object({
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
  instructions: z.string().max(4000).optional().default(""),
});
const usageSchema = z.object({ useRevision: z.boolean() });

type Ctx = { params: Promise<{ id: string; index: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id, index } = await ctx.params;
    const input = await parseBody(req, createSchema);
    return jsonOk({ job: await createItemRevision({ jobId: parseIdParam(id), itemIndex: Number(index), ...input }) }, 202);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id, index } = await ctx.params;
    const { useRevision } = await parseBody(req, usageSchema);
    return jsonOk({ job: await setItemRevisionUsage(parseIdParam(id), Number(index), useRevision) });
  } catch (error) {
    return handleApiError(error);
  }
}
