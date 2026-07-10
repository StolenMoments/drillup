import { mcqAnswerIndices, type McqPayload } from "./types";

export function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/** Reorders MCQ choices while keeping answers and per-choice explanations aligned. */
export function shuffleMcqChoices(payload: McqPayload): McqPayload {
  const originalIndexes = payload.choices.map((_, index) => index);
  let order = shuffle(originalIndexes);
  if (order.every((value, index) => value === index) && order.length > 1) {
    order = [...order.slice(1), order[0]];
  }
  const nextIndexByOriginal = new Map(order.map((originalIndex, nextIndex) => [originalIndex, nextIndex]));
  const answerIndices = mcqAnswerIndices(payload).map((index) => nextIndexByOriginal.get(index) as number);
  const choices = order.map((index) => payload.choices[index]);
  const choiceExplanations = payload.choice_explanations?.length === payload.choices.length
    ? order.map((index) => payload.choice_explanations![index])
    : payload.choice_explanations;

  return {
    ...payload,
    choices,
    ...(payload.answer_indices
      ? { answer_indices: answerIndices, answer_index: undefined }
      : { answer_index: answerIndices[0] }),
    ...(choiceExplanations ? { choice_explanations: choiceExplanations } : {}),
  };
}
