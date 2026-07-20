import { z } from "zod";
import { after } from "next/server";
import { runNoteTidyJob } from "@/server/note-tidy-runner";
import { startNoteTidyJob } from "@/server/note-service";
import { handleApiError, jsonOk, parseBody, parseIdParam } from "@/server/http";

const bodySchema = z.object({
  engine: z.enum(["CLAUDE", "CODEX", "ANTIGRAVITY"]),
});

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: Ctx) {
  try {
    const { id } = await ctx.params;
    const { engine } = await parseBody(req, bodySchema);
    const job = await startNoteTidyJob(parseIdParam(id), engine);
    after(async () => {
      try {
        await runNoteTidyJob(job.id);
      } catch (error) {
        console.error("note tidy runner failed", error);
      }
    });
    return jsonOk({ job }, 202);
  } catch (e) {
    return handleApiError(e);
  }
}
