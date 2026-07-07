import { z } from "zod";
import { handleApiError, jsonOk, parseBody } from "@/server/http";
import { createTopic, listTopics } from "@/server/topic-service";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  description: z.string().optional(),
});

export async function GET() {
  try {
    return jsonOk(await listTopics());
  } catch (e) {
    return handleApiError(e);
  }
}

export async function POST(req: Request) {
  try {
    const input = await parseBody(req, createSchema);
    return jsonOk(await createTopic(input), 201);
  } catch (e) {
    return handleApiError(e);
  }
}
