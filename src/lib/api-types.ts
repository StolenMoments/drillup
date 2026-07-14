export type QuestionTypeDto = "MCQ" | "CLOZE";
export type QuestionListSortDto =
  | "latest"
  | "accuracyAsc"
  | "accuracyDesc";

export interface QuestionListParams {
  topicId?: number;
  keywordId?: number;
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

export interface KeywordSuggestionDto {
  engine: GenerationEngineDto;
  keywords: string[];
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
  keywords: KeywordRefDto[];
}

export interface McqChoiceDto {
  text: string;
  original_index: number;
}

export type StudyQuestionDto =
  | { id: number; type: "MCQ"; question: string; choices: McqChoiceDto[]; selectionCount: 1 | 2 }
  | {
      id: number;
      type: "CLOZE";
      text: string;
      blankIds: number[];
      wordBank: string[];
    };

export type ReviewAnswerDto =
  | { type: "MCQ"; selected_indices: number[] }
  | { type: "CLOZE"; filled: Record<string, string> };

export interface SubmitReviewInput {
  questionId: number;
  mode: "SRS" | "PRACTICE";
  answer: ReviewAnswerDto;
}

export type CorrectAnswerDto =
  | { type: "MCQ"; answer_indices: number[]; choice_explanations: string[] | null }
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
  choiceExplanations: ChoiceExplanationDto[] | null;
  factualConcern: string | null;
  cached: boolean;
}

export interface ChoiceExplanationDto {
  choice: string;
  explanation: string;
  awsReference: {
    title: string;
    url: string;
  };
}

export interface HardenedMcqPayloadDto {
  question: string;
  choices: string[];
  answer_indices: number[];
  choice_explanations: string[];
}

export interface HardenPreviewDto {
  engine: GenerationEngineDto;
  comment: string;
  factualConcern: string | null;
  payload: HardenedMcqPayloadDto;
}

export type FactualReviewVerdictDto = "confirmed" | "rejected" | "unverifiable";

export interface FactualReviewDto {
  engine: GenerationEngineDto;
  verdict: FactualReviewVerdictDto;
  comment: string;
  evidenceUrl: string | null;
  payload: HardenedMcqPayloadDto | null;
}

export type GenerationEngineDto = "CLAUDE" | "CODEX" | "ANTIGRAVITY";
export type CorrectAnswerCountDto = 1 | 2;
export type ChoiceCountDto = 4 | 5 | 6;
export type GenerationStatusDto =
  | "RUNNING"
  | "VERIFYING"
  | "SUCCEEDED"
  | "FAILED";
export type GenerationVerdictDto = "pass" | "fail" | "unverified";
export type GenerationJobKindDto = "QUESTION" | "KEYWORD_TAG";
export type GenerationItemRevisionStatusDto = "RUNNING" | "SUCCEEDED" | "FAILED";
export type GenerationRunStageDto = "BLUEPRINT" | "BLUEPRINT_REPAIR" | "GENERATION" | "VERIFY" | "ITEM_REPAIR" | "REPAIR_VERIFY" | "MANUAL_ITEM_REVISION" | "KEYWORD_TAG";
export type GenerationRunStatusDto = "RUNNING" | "SUCCEEDED" | "FAILED";

export interface GenerationRunLogDto {
  id: number;
  stage: GenerationRunStageDto;
  itemIndex: number | null;
  attempt: number;
  engine: GenerationEngineDto;
  model: string | null;
  status: GenerationRunStatusDto;
  prompt: string;
  response: string | null;
  stdoutTail: string | null;
  stderrTail: string | null;
  errorMessage: string | null;
  exitCode: number | null;
  timedOut: boolean;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
}

export interface GenerationItemRevisionDto {
  status: GenerationItemRevisionStatusDto;
  engine: GenerationEngineDto;
  verdict: "pass" | "fail" | null;
  comment: string | null;
  proposedQuestion: unknown | null;
  appliedQuestion: unknown | null;
  errorMessage: string | null;
}

export interface KeywordTagItemDto {
  id: number;
  summary: string;
  keywords: string[];
}

export type GenerationItemDto =
  | {
      index: number;
      ok: true;
      question: unknown;
      verdict: GenerationVerdictDto;
      verdictComment: string | null;
      testedDistinction?: string | null;
      revision: GenerationItemRevisionDto | null;
    }
  | { index: number; ok: false; errors: string[] };

export interface GenerationJobDto {
  id: number;
  topicId: number;
  engine: GenerationEngineDto;
  verifyEngine: GenerationEngineDto;
  instructions: string;
  referenceFiles: string[];
  correctAnswerCount: CorrectAnswerCountDto | null;
  choiceCount: ChoiceCountDto | null;
  status: GenerationStatusDto;
  kind: GenerationJobKindDto;
  items: GenerationItemDto[] | null;
  keywordItems: KeywordTagItemDto[] | null;
  errorMessage: string | null;
  verifyWarning: string | null;
  createdAt: string;
  finishedAt: string | null;
  approvedAt: string | null;
  savedCount: number;
  sourceQuestionIds: number[] | null;
}

export interface GenerationJobSummaryDto {
  id: number;
  topicId: number;
  topicName: string;
  engine: GenerationEngineDto;
  verifyEngine: GenerationEngineDto;
  correctAnswerCount: CorrectAnswerCountDto | null;
  choiceCount: ChoiceCountDto | null;
  status: GenerationStatusDto;
  kind: GenerationJobKindDto;
  itemCount: number | null;
  savedCount: number;
  approvedAt: string | null;
  errorMessage: string | null;
  createdAt: string;
  finishedAt: string | null;
}
