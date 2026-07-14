import { z } from "zod";
import { mcqPayloadSchema } from "./import-schema";
import type { McqPayload } from "./types";

const factualReviewSchema = z.object({
  verdict: z.enum(["confirmed", "rejected", "unverifiable"]),
  comment: z.string().trim().min(1),
  // 엔진이 근거 URL을 확신하지 못하면 빈 문자열이나 null로 보내는 경우가 있어 모두 허용한다.
  evidence_url: z.string().nullish(),
  revised: z.unknown().optional(),
});

export type FactualReviewParseResult =
  | {
      ok: true;
      verdict: "confirmed" | "rejected" | "unverifiable";
      comment: string;
      evidenceUrl: string | null;
      payload: McqPayload | null;
    }
  | { ok: false; fatal: string };

export function parseFactualReviewJson(rawText: string): FactualReviewParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return { ok: false, fatal: "올바른 JSON이 아닙니다" };
  }

  const outer = factualReviewSchema.safeParse(raw);
  if (!outer.success) {
    return { ok: false, fatal: "verdict와 comment가 필요합니다" };
  }

  const evidenceUrl = outer.data.evidence_url?.trim() || null;

  if (outer.data.verdict !== "confirmed") {
    return {
      ok: true,
      verdict: outer.data.verdict,
      comment: outer.data.comment,
      evidenceUrl,
      payload: null,
    };
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

  return {
    ok: true,
    verdict: "confirmed",
    comment: outer.data.comment,
    evidenceUrl,
    payload: {
      question: payload.question,
      choices: payload.choices,
      answer_indices: payload.answer_indices,
      choice_explanations: payload.choice_explanations,
    },
  };
}
