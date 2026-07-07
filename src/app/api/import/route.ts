import { z } from "zod";
import { validateImportQuestions } from "@/core/import-schema";
import { ServiceError } from "@/server/errors";
import { handleApiError, jsonOk, parseBody } from "@/server/http";
import { importQuestions } from "@/server/import-service";

const importSchema = z.object({
  topicId: z.number().int().positive(),
  questions: z.array(z.unknown()).min(1),
});

export async function POST(req: Request) {
  try {
    const input = await parseBody(req, importSchema);
    const results = validateImportQuestions(input.questions);
    const invalid = results.filter((item) => !item.ok);
    if (invalid.length > 0) {
      const detail = invalid
        .map((item) => {
          if (item.ok) return "";
          return `#${item.index + 1}: ${item.errors.join(", ")}`;
        })
        .filter(Boolean)
        .join("; ");
      throw new ServiceError("VALIDATION", detail, 400);
    }

    const questions = results.map((item) => {
      if (!item.ok) throw new Error("unreachable");
      return item.question;
    });
    const savedCount = await importQuestions(input.topicId, questions);
    return jsonOk({ savedCount }, 201);
  } catch (e) {
    return handleApiError(e);
  }
}
