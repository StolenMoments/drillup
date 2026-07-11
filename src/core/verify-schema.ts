import { z } from "zod";
import type { ImportItemResult, ImportQuestion } from "./import-schema";

const verdictSchema = z.object({
  index: z.number().int().min(0),
  verdict: z.enum(["pass", "fail"]),
  comment: z.string().optional(),
  violation_codes: z.array(z.string()).optional(),
});

export interface VerifyVerdict {
  index: number;
  verdict: "pass" | "fail";
  comment: string | null;
  violationCodes: string[];
}

export type VerifyParseResult =
  | { ok: true; verdicts: VerifyVerdict[] }
  | { ok: false; fatal: string };

export function parseVerifyJson(rawText: string): VerifyParseResult {
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    return { ok: false, fatal: "올바른 JSON이 아닙니다" };
  }

  const verdicts =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>).verdicts
      : undefined;
  if (!Array.isArray(verdicts)) {
    return { ok: false, fatal: "최상위에 verdicts 배열이 있어야 합니다" };
  }

  const parsed: VerifyVerdict[] = [];
  for (const raw of verdicts) {
    const result = verdictSchema.safeParse(raw);
    // 형식이 어긋난 verdict는 건너뛴다 — 해당 항목은 unverified로 남는다.
    if (!result.success) continue;
    const comment = result.data.comment?.trim();
    parsed.push({
      index: result.data.index,
      verdict: result.data.verdict,
      comment: comment ? comment : null,
      violationCodes: [...new Set((result.data.violation_codes ?? []).map((code) => code.trim()).filter(Boolean))],
    });
  }
  return { ok: true, verdicts: parsed };
}

export type VerifiedItemResult =
  | {
      index: number;
      ok: true;
      question: ImportQuestion;
      verdict: "pass" | "fail" | "unverified";
      verdictComment: string | null;
    }
  | { index: number; ok: false; errors: string[] };

export function mergeVerdicts(
  items: ImportItemResult[],
  verdicts: VerifyVerdict[],
): VerifiedItemResult[] {
  const byIndex = new Map(verdicts.map((verdict) => [verdict.index, verdict]));
  return items.map((item) => {
    if (!item.ok) return item;
    const matched = byIndex.get(item.index);
    if (!matched) {
      return { ...item, verdict: "unverified" as const, verdictComment: null };
    }
    return { ...item, verdict: matched.verdict, verdictComment: matched.comment };
  });
}
