import { z } from "zod";
import { dedupeKeywordNames } from "./keyword";

const assignmentSchema = z.object({
  id: z.number().int().positive(),
  keywords: z.array(z.string()).min(1).max(5),
});

export interface KeywordAssignment {
  id: number;
  keywords: string[];
}

export type KeywordTagParseResult =
  | { ok: true; assignments: KeywordAssignment[] }
  | { ok: false; fatal: string };

export function parseKeywordTagJson(rawText: string): KeywordTagParseResult {
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    return { ok: false, fatal: "올바른 JSON이 아닙니다" };
  }

  const assignments =
    typeof data === "object" && data !== null
      ? (data as Record<string, unknown>).assignments
      : undefined;
  if (!Array.isArray(assignments)) {
    return { ok: false, fatal: "최상위에 assignments 배열이 있어야 합니다" };
  }

  const parsed: KeywordAssignment[] = [];
  for (const raw of assignments) {
    const result = assignmentSchema.safeParse(raw);
    // 형식이 어긋난 항목은 건너뛴다 — 나머지 문제의 부여는 살린다.
    if (!result.success) continue;
    const keywords = dedupeKeywordNames(result.data.keywords);
    if (keywords.length === 0) continue;
    parsed.push({ id: result.data.id, keywords });
  }
  return { ok: true, assignments: parsed };
}
