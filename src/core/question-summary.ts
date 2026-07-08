import type { QuestionType } from "./types";

const PLACEHOLDER_RE = /\{\{(\d+)\}\}/g;
const DEFAULT_MAX_CHARS = 8000;

export function summarizeQuestionPayload(
  type: QuestionType,
  payload: unknown,
): string {
  if (typeof payload !== "object" || payload === null) return "";
  const record = payload as Record<string, unknown>;

  if (type === "MCQ") {
    return typeof record.question === "string" ? record.question.trim() : "";
  }

  if (typeof record.text !== "string") return "";
  const answers = new Map<number, string>();
  if (Array.isArray(record.blanks)) {
    for (const blank of record.blanks) {
      if (typeof blank !== "object" || blank === null) continue;
      const { id, answer } = blank as Record<string, unknown>;
      if (typeof id === "number" && typeof answer === "string") {
        answers.set(id, answer);
      }
    }
  }
  return record.text
    .replace(PLACEHOLDER_RE, (whole, id) => answers.get(Number(id)) ?? whole)
    .trim();
}

export function capSummaries(
  summaries: string[],
  maxChars: number = DEFAULT_MAX_CHARS,
): { kept: string[]; truncated: boolean } {
  const kept: string[] = [];
  let total = 0;
  for (const summary of summaries) {
    if (!summary) continue;
    if (total + summary.length > maxChars) {
      return { kept, truncated: true };
    }
    kept.push(summary);
    total += summary.length;
  }
  return { kept, truncated: false };
}
