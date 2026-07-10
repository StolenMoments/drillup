import { mcqAnswerIndices, type ClozePayload, type McqPayload } from "./types";

export interface McqAnswer {
  selected_indices: number[];
}

export interface ClozeAnswer {
  filled: Record<string, string>;
}

export function gradeMcq(payload: McqPayload, answer: McqAnswer): boolean {
  const expected = mcqAnswerIndices(payload).slice().sort((a, b) => a - b);
  const selected = [...new Set(answer.selected_indices)].sort((a, b) => a - b);
  return expected.length === selected.length && expected.every((value, index) => value === selected[index]);
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
