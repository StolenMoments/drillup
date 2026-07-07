export type QuestionType = "MCQ" | "CLOZE";

export interface McqPayload {
  question: string;
  choices: string[];
  answer_index: number;
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
