export type QuestionTypeDto = "MCQ" | "CLOZE";
export type JobTypeDto =
  | "QUESTION_GENERATION"
  | "KEYWORD_TAGGING"
  | "GENERATION_ITEM_REVISION"
  | "CHOICE_HARDENING"
  | "NOTE_TIDY"
  | "ANSWER_EXPLANATION";
export type JobStatusDto = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED";

export interface JobDtoBase {
  id: number;
  type: JobTypeDto;
  status: JobStatusDto;
  engine: GenerationEngineDto;
  topicId: number | null;
  questionId: number | null;
  parentJobId: number | null;
  retryOfJobId: number | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  heartbeatAt: string | null;
  finishedAt: string | null;
}
export type QuestionListSortDto =
  | "latest"
  | "accuracyAsc"
  | "accuracyDesc";
export type QuestionSearchFieldDto =
  | "body"
  | "choices"
  | "explanation"
  | "keyword";

export interface QuestionListParams {
  topicId?: number;
  keywordId?: number;
  type?: QuestionTypeDto;
  sort?: QuestionListSortDto;
  page?: number;
  search?: string;
  searchIn?: QuestionSearchFieldDto[];
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
  | { id: number; topicId: number; type: "MCQ"; question: string; choices: McqChoiceDto[]; selectionCount: 1 | 2 }
  | {
      id: number;
      topicId: number;
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

export interface ChoiceExplanationDto {
  choice: string;
  explanation: string;
  awsReference: {
    title: string;
    url: string;
  };
}

export type AnswerExplanationJobStatusDto = "RUNNING" | "SUCCEEDED" | "FAILED";

export interface AnswerExplanationJobResultDto {
  content: string;
  choiceExplanations: ChoiceExplanationDto[] | null;
  factualConcern: string | null;
}

export interface AnswerExplanationJobDto {
  id: number;
  questionId: number;
  engine: GenerationEngineDto;
  status: AnswerExplanationJobStatusDto;
  result: AnswerExplanationJobResultDto | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
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

export type ChoiceHardeningJobStatusDto = "RUNNING" | "SUCCEEDED" | "FAILED";
export type ChoiceHardeningJobStageDto = "GENERATING" | "VERIFYING";

export interface ChoiceHardeningJobDto {
  id: number;
  questionId: number;
  sourceHash: string;
  engine: GenerationEngineDto;
  verifyEngine: GenerationEngineDto;
  attempt: number;
  status: ChoiceHardeningJobStatusDto;
  stage: ChoiceHardeningJobStageDto;
  preview: HardenPreviewDto | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  appliedAt: string | null;
  autoApplied: boolean;
  dismissedAt: string | null;
}

export interface ChoiceHardeningSourceDto {
  question: string;
  choices: string[];
}

export interface ChoiceHardeningJobListItemDto extends ChoiceHardeningJobDto {
  questionPreview: string;
  topicName: string;
  source: ChoiceHardeningSourceDto;
}

export type ChoiceHardeningListStatusDto =
  | "pending"
  | "running"
  | "failed"
  | "applied";

export interface ChoiceHardeningJobSummaryGroupDto {
  items: ChoiceHardeningJobListItemDto[];
  totalItems: number;
}

export interface ChoiceHardeningJobSummaryDto {
  pending: ChoiceHardeningJobSummaryGroupDto;
  running: ChoiceHardeningJobSummaryGroupDto;
  failed: ChoiceHardeningJobSummaryGroupDto;
  applied: ChoiceHardeningJobSummaryGroupDto;
}

export interface ChoiceHardeningJobPageDto {
  items: ChoiceHardeningJobListItemDto[];
  page: number;
  pageSize: 10;
  totalItems: number;
  totalPages: number;
}

export type GenerationEngineDto = "CLAUDE" | "CODEX" | "ANTIGRAVITY";
export type CorrectAnswerCountDto = 1 | 2;
export type ChoiceCountDto = 4 | 5 | 6;
export type GenerationStatusDto = JobStatusDto;
export type QuestionGenerationStageDto =
  | "RUNNING"
  | "VERIFYING"
  | "SUCCEEDED"
  | "FAILED";
export type GenerationVerdictDto = "pass" | "fail" | "unverified";
export type GenerationJobTypeDto = "QUESTION_GENERATION" | "KEYWORD_TAGGING";
export type GenerationItemRevisionStatusDto = JobStatusDto;
export type GenerationRunStageDto =
  | "BLUEPRINT"
  | "BLUEPRINT_REPAIR"
  | "GENERATION"
  | "VERIFY"
  | "ITEM_REPAIR"
  | "REPAIR_VERIFY"
  | "MANUAL_ITEM_REVISION"
  | "KEYWORD_TAG"
  | "CHOICE_HARDENING"
  | "NOTE_TIDY"
  | "ANSWER_EXPLANATION"
  | "LEGACY_OUTPUT";
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
  id: number;
  status: GenerationItemRevisionStatusDto;
  engine: GenerationEngineDto;
  verdict: "pass" | "fail" | null;
  comment: string | null;
  proposedQuestion: unknown | null;
  selectedAt: string | null;
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
      selectedRevision: GenerationItemRevisionDto | null;
    }
  | { index: number; ok: false; errors: string[] };

export interface GenerationJobDto extends JobDtoBase {
  type: GenerationJobTypeDto;
  topicId: number;
  questionId: null;
  parentJobId: null;
  verifyEngine: GenerationEngineDto;
  instructions: string;
  referenceFiles: string[];
  correctAnswerCount: CorrectAnswerCountDto | null;
  choiceCount: ChoiceCountDto | null;
  stage: QuestionGenerationStageDto | null;
  items: GenerationItemDto[] | null;
  keywordItems: KeywordTagItemDto[] | null;
  verifyWarning: string | null;
  approvedAt: string | null;
  savedCount: number;
  sourceQuestionIds: number[] | null;
}

export interface GenerationJobSummaryDto extends JobDtoBase {
  type: GenerationJobTypeDto;
  topicId: number;
  questionId: null;
  parentJobId: null;
  topicName: string;
  verifyEngine: GenerationEngineDto;
  correctAnswerCount: CorrectAnswerCountDto | null;
  choiceCount: ChoiceCountDto | null;
  stage: QuestionGenerationStageDto | null;
  itemCount: number | null;
  savedCount: number;
  approvedAt: string | null;
}

export type NoteTidyJobStatusDto = "RUNNING" | "SUCCEEDED" | "FAILED";

export interface NoteTidyJobDto {
  id: number;
  topicId: number;
  sourceHash: string;
  engine: GenerationEngineDto;
  status: NoteTidyJobStatusDto;
  preview: string | null;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  appliedAt: string | null;
  dismissedAt: string | null;
}

export interface TopicNoteDto {
  content: string;
  updatedAt: string | null;
  activeTidyJob: { id: number; status: NoteTidyJobStatusDto } | null;
}

export interface NoteExtractDto {
  engine: GenerationEngineDto;
  /** 기존 노트에 없는 새 항목만 담긴 마크다운. 새 내용이 없으면 빈 문자열. */
  extracted: string;
}
