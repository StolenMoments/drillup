export type QuestionTypeDto = "MCQ" | "CLOZE";

export interface TopicDto {
  id: number;
  name: string;
  description: string | null;
  questionCount: number;
}

export interface QuestionListItemDto {
  id: number;
  topicId: number;
  type: QuestionTypeDto;
  preview: string;
  attempts: number;
  correctCount: number;
  createdAt: string;
}

export interface QuestionDetailDto {
  id: number;
  topicId: number;
  type: QuestionTypeDto;
  payload: unknown;
  explanation: string | null;
}

export type StudyQuestionDto =
  | { id: number; type: "MCQ"; question: string; choices: string[] }
  | {
      id: number;
      type: "CLOZE";
      text: string;
      blankIds: number[];
      wordBank: string[];
    };

export type ReviewAnswerDto =
  | { type: "MCQ"; selected_index: number }
  | { type: "CLOZE"; filled: Record<string, string> };

export interface SubmitReviewInput {
  questionId: number;
  mode: "SRS" | "PRACTICE";
  answer: ReviewAnswerDto;
}

export type CorrectAnswerDto =
  | { type: "MCQ"; answer_index: number }
  | { type: "CLOZE"; answers: Record<string, string> };

export interface ReviewResultDto {
  isCorrect: boolean;
  explanation: string | null;
  correct: CorrectAnswerDto;
}

export interface TopicStatsDto {
  id: number;
  name: string;
  total: number;
  unlearned: number;
  learning: number;
  mastered: number;
  dueCount: number;
}

export interface StatsOverviewDto {
  dueTotal: number;
  topics: TopicStatsDto[];
}
