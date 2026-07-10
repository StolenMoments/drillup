export type QuestionType = "MCQ" | "CLOZE";

export interface McqPayload {
  question: string;
  choices: string[];
  /** Legacy single-answer field. New questions use answer_indices. */
  answer_index?: number;
  answer_indices?: number[];
  choice_explanations?: string[];
}

export function mcqAnswerIndices(payload: McqPayload): number[] {
  return payload.answer_indices ??
    (typeof payload.answer_index === "number" ? [payload.answer_index] : []);
}

export interface ClozeBlank {
  id: number;
  answer: string;
}

export interface ClozePayload {
  text: string;
  blanks: ClozeBlank[];
  distractors: string[];
}

export type QuestionPayload = McqPayload | ClozePayload;
