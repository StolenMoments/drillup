import { DEFAULT_GENERATION_QUESTION_SHAPE } from "@/core/generation-shape";
import type {
  ChoiceCountDto,
  CorrectAnswerCountDto,
  GenerationEngineDto,
  GenerationJobDto,
} from "./api-types";

export interface GenerationRetryInput {
  topicId: number;
  engine: GenerationEngineDto;
  verifyEngine: GenerationEngineDto;
  instructions: string;
  correctAnswerCount: CorrectAnswerCountDto;
  choiceCount: ChoiceCountDto;
  referenceFiles: string[];
  sourceQuestionIds: number[];
}

export interface GenerationRetryResult {
  input: GenerationRetryInput | null;
  missingReferenceFiles: string[];
}

export function buildGenerationRetryInput(
  job: GenerationJobDto,
  availableReferenceFiles: Iterable<string>,
): GenerationRetryResult {
  if (job.kind !== "QUESTION") {
    return { input: null, missingReferenceFiles: [] };
  }

  const available = new Set(availableReferenceFiles);
  const requested = [...new Set(job.referenceFiles)];
  const referenceFiles = requested.filter((file) => available.has(file));
  const missingReferenceFiles = requested.filter((file) => !available.has(file));

  return {
    input: {
      topicId: job.topicId,
      engine: job.engine,
      verifyEngine: job.verifyEngine,
      instructions: job.instructions,
      correctAnswerCount:
        job.correctAnswerCount ??
        DEFAULT_GENERATION_QUESTION_SHAPE.correctAnswerCount,
      choiceCount:
        job.choiceCount ?? DEFAULT_GENERATION_QUESTION_SHAPE.choiceCount,
      referenceFiles,
      sourceQuestionIds: [...(job.sourceQuestionIds ?? [])],
    },
    missingReferenceFiles,
  };
}
