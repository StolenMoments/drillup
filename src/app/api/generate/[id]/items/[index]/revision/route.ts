import { z } from "zod";
import {
  createItemRevision,
  setItemRevisionUsage,
} from "@/server/generation/generation-service";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";
import { ServiceError } from "@/server/errors";

const createSchema = z.object({
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
  instructions: z.string().max(4000).optional().default(""),
});
const usageSchema = z.object({ useRevision: z.boolean() });

type Ctx = { params: Promise<{ id: string; index: string }> };

function parseIndex(raw: string): number {
  const index = Number(raw);
  if (!Number.isInteger(index) || index < 0) {
    throw new ServiceError("BAD_REQUEST", "잘못된 문제 index입니다", 400);
  }
  return index;
}

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id, index } = await ctx.params;
    const input = await parseBody(req, createSchema);
    return jsonOk({ job: await createItemRevision({ jobId: parseIdParam(id), itemIndex: parseIndex(index), ...input }) }, 202);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(req: Request, ctx: Ctx) {
  try {
    const { id, index } = await ctx.params;
    const { useRevision } = await parseBody(req, usageSchema);
    return jsonOk({ job: await setItemRevisionUsage(parseIdParam(id), parseIndex(index), useRevision) });
  } catch (error) {
    return handleApiError(error);
  }
}
