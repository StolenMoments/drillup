import { z } from "zod";
import type { McqPayload, QuestionType } from "./types";

const explanationSchema = z.object({
  explanation: z.string().trim().min(1, "explanation은 비어 있으면 안 됩니다"),
  factual_concern: z.string().trim().min(1).optional(),
});

const awsReferenceSchema = z.object({
  title: z.string().trim().min(1, "AWS 문서 제목은 비어 있으면 안 됩니다"),
  url: z
    .string()
    .url("AWS 문서 URL 형식이 올바르지 않습니다")
    .refine((url) => {
      try {
        const parsed = new URL(url);
        return parsed.protocol === "https:" && parsed.hostname === "docs.aws.amazon.com";
      } catch {
        return false;
      }
    }, "AWS 공식 문서 URL만 사용할 수 있습니다"),
});

const mcqExplanationSchema = explanationSchema.extend({
  choice_explanations: z.array(
    z.object({
      choice: z.string().trim().min(1, "보기 텍스트는 비어 있으면 안 됩니다"),
      explanation: z.string().trim().min(1, "보기 해설은 비어 있으면 안 됩니다"),
      aws_reference: awsReferenceSchema,
    }),
  ),
});

export interface ChoiceExplanation {
  choice: string;
  explanation: string;
  awsReference: {
    title: string;
    url: string;
  };
}

export type ExplanationParseResult =
  | { ok: true; explanation: string; choiceExplanations: ChoiceExplanation[] | null; factualConcern: string | null }
  | { ok: false; fatal: string };

export function parseExplanationJson(
  rawText: string,
  type: QuestionType = "CLOZE",
  payload: McqPayload | null = null,
): ExplanationParseResult {
  let data: unknown;
  try {
    data = JSON.parse(rawText);
  } catch {
    return { ok: false, fatal: "올바른 JSON이 아닙니다" };
  }

  if (type !== "MCQ") {
    const parsed = explanationSchema.safeParse(data);
    if (!parsed.success) {
      return {
        ok: false,
        fatal: "explanation 필드가 없거나 형식이 올바르지 않습니다",
      };
    }
    return { ok: true, explanation: parsed.data.explanation, choiceExplanations: null, factualConcern: parsed.data.factual_concern ?? null };
  }

  const parsed = mcqExplanationSchema.safeParse(data);
  if (!parsed.success) {
    return {
      ok: false,
      fatal: "explanation 또는 선택지별 AWS 문서 해설 형식이 올바르지 않습니다",
    };
  }

  if (!payload) {
    return { ok: false, fatal: "객관식 선택지 정보가 없습니다" };
  }

  const choiceExplanations = parsed.data.choice_explanations;
  const expectedChoices = new Set(payload.choices);
  const actualChoices = new Set(choiceExplanations.map((item) => item.choice));
  if (
    choiceExplanations.length !== payload.choices.length ||
    actualChoices.size !== payload.choices.length ||
    [...actualChoices].some((choice) => !expectedChoices.has(choice))
  ) {
    return { ok: false, fatal: "모든 선택지에 대해 중복 없이 해설과 AWS 문서가 필요합니다" };
  }

  return {
    ok: true,
    explanation: parsed.data.explanation,
    factualConcern: parsed.data.factual_concern ?? null,
    choiceExplanations: choiceExplanations.map((item) => ({
      choice: item.choice,
      explanation: item.explanation,
      awsReference: item.aws_reference,
    })),
  };
}
