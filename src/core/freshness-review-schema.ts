import { z } from "zod";
import { mcqPayloadSchema } from "./import-schema";
import type { McqPayload } from "./types";

export type VerificationSourcePolicy = "OFFICIAL_DOCS" | "AWS_DOCS_ONLY";

const freshnessReviewSchema = z.object({
  verdict: z.enum(["pass", "fail", "unverified"]),
  comment: z.string().trim().min(1),
  evidence_url: z.string().nullish(),
  revised: z.unknown().optional(),
});

export type FreshnessReviewParseResult =
  | { ok: true; verdict: "pass" | "fail" | "unverified"; comment: string; evidenceUrl: string | null; payload: McqPayload | null }
  | { ok: false; fatal: string };

export function isAwsDocsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "docs.aws.amazon.com";
  } catch {
    return false;
  }
}

export function parseFreshnessReviewJson(rawText: string, sourcePolicy: VerificationSourcePolicy): FreshnessReviewParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(rawText);
  } catch {
    return { ok: false, fatal: "올바른 JSON이 아닙니다" };
  }
  const parsed = freshnessReviewSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, fatal: "verdict와 comment가 필요합니다" };

  const evidenceUrl = parsed.data.evidence_url?.trim() || null;
  if (sourcePolicy === "AWS_DOCS_ONLY" && parsed.data.verdict !== "unverified" && (!evidenceUrl || !isAwsDocsUrl(evidenceUrl))) {
    return { ok: true, verdict: "unverified", comment: "AWS 공식 문서(docs.aws.amazon.com) 근거를 확인할 수 없어 판단할 수 없습니다.", evidenceUrl: null, payload: null };
  }

  if (parsed.data.revised == null) {
    return { ok: true, verdict: parsed.data.verdict, comment: parsed.data.comment, evidenceUrl, payload: null };
  }
  const revised = mcqPayloadSchema.safeParse(parsed.data.revised);
  if (!revised.success || !revised.data.answer_indices || !revised.data.choice_explanations) {
    return { ok: false, fatal: "revised가 완전한 MCQ payload 형식에 맞지 않습니다" };
  }
  if (parsed.data.verdict !== "fail") return { ok: false, fatal: "revised는 fail 판정일 때만 포함할 수 있습니다" };
  return {
    ok: true,
    verdict: "fail",
    comment: parsed.data.comment,
    evidenceUrl,
    payload: { question: revised.data.question, choices: revised.data.choices, answer_indices: revised.data.answer_indices, choice_explanations: revised.data.choice_explanations },
  };
}
