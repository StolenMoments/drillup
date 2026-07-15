import { z } from "zod";
import { after } from "next/server";
import { runChoiceHardeningJob } from "@/server/choice-hardening-runner";
import { startChoiceHardeningJob } from "@/server/choice-hardening-service";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";

const bodySchema = z.object({
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
  force: z.boolean().optional().default(false),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { engine, force } = await parseBody(req, bodySchema);
    const job = await startChoiceHardeningJob(parseIdParam(id), engine, force);
    if (job.status === "RUNNING") {
      after(async () => {
        try {
          await runChoiceHardeningJob(job.id);
        } catch (error) {
          console.error("choice hardening runner failed", error);
        }
      });
    }
    return jsonOk({ job }, job.status === "RUNNING" ? 202 : 200);
  } catch (e) {
    return handleApiError(e);
  }
}
