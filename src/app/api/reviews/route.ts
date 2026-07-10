import { z } from "zod";
import { handleApiError, jsonOk, parseBody } from "@/server/http";
import { submitReview } from "@/server/study-service";

const answerSchema = z.union([
  z.object({
    type: z.literal("MCQ"),
    selected_index: z.number().int().min(0).max(5),
  }),
  z.object({
    type: z.literal("CLOZE"),
    filled: z.record(z.string(), z.string()),
  }),
]);

const bodySchema = z.object({
  questionId: z.number().int().positive(),
  mode: z.enum(["SRS", "PRACTICE"]),
  answer: answerSchema,
});

export async function POST(req: Request) {
  try {
    const input = await parseBody(req, bodySchema);
    return jsonOk(await submitReview(input));
  } catch (e) {
    return handleApiError(e);
  }
}
