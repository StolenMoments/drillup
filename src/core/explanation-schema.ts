import { z } from "zod";

const explanationSchema = z.object({
  explanation: z.string().trim().min(1, "explanation은 비어 있으면 안 됩니다"),
});

export type ExplanationParseResult =
  | { ok: true; explanation: string }
  | { ok: false; fatal: string };

export function parseExplanationJson(rawText: string): ExplanationParseResult {
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    return { ok: false, fatal: "올바른 JSON이 아닙니다" };
  }

  const parsed = explanationSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      fatal: "explanation 필드가 없거나 형식이 올바르지 않습니다",
    };
  }

  return { ok: true, explanation: parsed.data.explanation };
}
