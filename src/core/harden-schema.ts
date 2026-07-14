import { z } from "zod";
import { mcqPayloadSchema } from "./import-schema";
import { mcqAnswerIndices, type McqPayload } from "./types";

const hardenSchema = z.object({
  comment: z.string().trim().min(1),
  // 엔진이 "할 말 없음"을 빈 문자열이나 null로 보내는 경우가 있어 모두 허용한다.
  factual_concern: z.string().nullish(),
  revised: z.unknown(),
});

export type HardenParseResult =
  | { ok: true; comment: string; payload: McqPayload; factualConcern: string | null }
  | { ok: false; fatal: string };

function sameIndexSet(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort((x, y) => x - y);
  const sortedB = [...b].sort((x, y) => x - y);
  return sortedA.every((value, i) => value === sortedB[i]);
}

export function parseHardenJson(
  rawText: string,
  original: McqPayload,
): HardenParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return { ok: false, fatal: "올바른 JSON이 아닙니다" };
  }
  const outer = hardenSchema.safeParse(raw);
  if (!outer.success) {
    return { ok: false, fatal: "comment와 revised가 필요합니다" };
  }
  const revised = mcqPayloadSchema.safeParse(outer.data.revised);
  if (!revised.success) {
    return { ok: false, fatal: "revised가 MCQ payload 형식에 맞지 않습니다" };
  }
  const payload = revised.data;
  if (!payload.answer_indices || !payload.choice_explanations) {
    return {
      ok: false,
      fatal: "revised에는 answer_indices와 choice_explanations가 필요합니다",
    };
  }
  if (payload.question === original.question.trim()) {
    return { ok: false, fatal: "질문 텍스트가 변경되지 않았습니다" };
  }
  if (payload.choices.length !== original.choices.length) {
    return { ok: false, fatal: "선지 개수가 변경되었습니다" };
  }
  const answerIndices = mcqAnswerIndices(original);
  if (!sameIndexSet(payload.answer_indices, answerIndices)) {
    return { ok: false, fatal: "answer_indices가 변경되었습니다" };
  }
  const allCorrectChanged = answerIndices.every(
    (index) => payload.choices[index] !== original.choices[index].trim(),
  );
  if (!allCorrectChanged) {
    return { ok: false, fatal: "모든 정답 선지가 변경되어야 합니다" };
  }
  const distractorChanged = payload.choices.some(
    (choice, index) =>
      !answerIndices.includes(index) &&
      choice !== original.choices[index].trim(),
  );
  if (!distractorChanged) {
    return { ok: false, fatal: "오답 선지가 하나도 변경되지 않았습니다" };
  }
  return { ok: true, comment: outer.data.comment, payload, factualConcern: outer.data.factual_concern?.trim() || null };
}
