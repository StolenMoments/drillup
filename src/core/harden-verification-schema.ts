import { z } from "zod";

const hardenVerificationSchema = z.object({
  verdict: z.enum(["pass", "fail"]),
  comment: z.string().trim().min(1),
});

export type HardenVerificationParseResult =
  | { ok: true; verdict: "pass" | "fail"; comment: string }
  | { ok: false; fatal: string };

export function parseHardenVerificationJson(
  rawText: string,
): HardenVerificationParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return { ok: false, fatal: "올바른 JSON이 아닙니다" };
  }

  const parsed = hardenVerificationSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, fatal: "verdict와 comment가 필요합니다" };
  }

  return {
    ok: true,
    verdict: parsed.data.verdict,
    comment: parsed.data.comment,
  };
}
