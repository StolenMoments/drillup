import type { ClozePayload, McqPayload } from "./types";

export interface McqAnswer {
  selected_index: number;
}

export interface ClozeAnswer {
  filled: Record<string, string>;
}

export function gradeMcq(payload: McqPayload, answer: McqAnswer): boolean {
  return answer.selected_index === payload.answer_index;
}

export function gradeCloze(
  payload: ClozePayload,
  answer: ClozeAnswer,
): boolean {
  return payload.blanks.every(
    (blank) =>
      (answer.filled[String(blank.id)] ?? "").trim() === blank.answer.trim(),
  );
}
