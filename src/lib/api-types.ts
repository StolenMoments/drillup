export type QuestionTypeDto = "MCQ" | "CLOZE";
export type QuestionListSortDto =
  | "latest"
  | "accuracyAsc"
  | "accuracyDesc";

export interface QuestionListParams {
  topicId?: number;
  type?: QuestionTypeDto;
  sort?: QuestionListSortDto;
  page?: number;
}

export interface KeywordRefDto {
  id: number;
  name: string;
}

export interface KeywordDto extends KeywordRefDto {
  questionCount: number;
}

export interface TopicDto {
  id: number;
  name: string;
  description: string | null;
  referenceDir: string | null;
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

export interface QuestionListPageDto {
  items: QuestionListItemDto[];
  page: number;
  pageSize: 15;
  totalItems: number;
  totalPages: number;
}

export interface QuestionDetailDto {
  id: number;
  topicId: number;
  type: QuestionTypeDto;
  payload: unknown;
  explanation: string | null;
}

export interface McqChoiceDto {
  text: string;
  original_index: number;
}

export type StudyQuestionDto =
  | { id: number; type: "MCQ"; question: string; choices: McqChoiceDto[] }
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

export interface ReferenceFileDto {
  path: string;
  size: number;
}

export interface ReferenceFileListDto {
  files: ReferenceFileDto[];
  dirExists: boolean;
}

export interface AnswerExplanationDto {
  engine: GenerationEngineDto;
  content: string;
  cached: boolean;
}

export type GenerationEngineDto = "CLAUDE" | "CODEX" | "ANTIGRAVITY";
export type GenerationStatusDto =
  | "RUNNING"
  | "VERIFYING"
  | "SUCCEEDED"
  | "FAILED";
export type GenerationVerdictDto = "pass" | "fail" | "unverified";

export type GenerationItemDto =
  | {
      index: number;
      ok: true;
      question: unknown;
      verdict: GenerationVerdictDto;
      verdictComment: string | null;
    }
  | { index: number; ok: false; errors: string[] };

export interface GenerationJobDto {
  id: number;
  topicId: number;
  engine: GenerationEngineDto;
  verifyEngine: GenerationEngineDto;
  status: GenerationStatusDto;
  items: GenerationItemDto[] | null;
  errorMessage: string | null;
  verifyWarning: string | null;
  createdAt: string;
  finishedAt: string | null;
  approvedAt: string | null;
  savedCount: number;
}

export interface GenerationJobSummaryDto {
  id: number;
  topicId: number;
  topicName: string;
  engine: GenerationEngineDto;
  verifyEngine: GenerationEngineDto;
  status: GenerationStatusDto;
  itemCount: number | null;
  savedCount: number;
  approvedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
}
