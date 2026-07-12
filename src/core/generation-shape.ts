export const CORRECT_ANSWER_COUNTS = [1, 2] as const;
export const CHOICE_COUNTS = [4, 5, 6] as const;

export type CorrectAnswerCount = (typeof CORRECT_ANSWER_COUNTS)[number];
export type ChoiceCount = (typeof CHOICE_COUNTS)[number];

export interface GenerationQuestionShape {
  correctAnswerCount: CorrectAnswerCount;
  choiceCount: ChoiceCount;
}
