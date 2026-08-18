import { z } from "zod";
import { sha256Fingerprint } from "./stable-json";
import type { McqPayload } from "./types";
import type { VerificationSourcePolicy } from "./freshness-review-schema";

export const FRESHNESS_REVIEW_CACHE_VERSION = 1;

export interface FreshnessReviewSourceSnapshot {
  cacheVersion: number;
  payload: McqPayload;
  explanation: string | null;
  topicName: string;
  sourcePolicy: VerificationSourcePolicy;
}

const snapshotSchema = z.object({
  cacheVersion: z.number().int().positive(),
  payload: z.custom<McqPayload>(
    (value) => typeof value === "object" && value !== null,
  ),
  explanation: z.string().nullable(),
  topicName: z.string(),
  sourcePolicy: z.enum(["OFFICIAL_DOCS", "AWS_DOCS_ONLY"]),
});

export function createFreshnessReviewSourceSnapshot(input: {
  payload: McqPayload;
  explanation: string | null;
  topicName: string;
  sourcePolicy: VerificationSourcePolicy;
}): FreshnessReviewSourceSnapshot {
  return {
    cacheVersion: FRESHNESS_REVIEW_CACHE_VERSION,
    payload: input.payload,
    explanation: input.explanation,
    topicName: input.topicName,
    sourcePolicy: input.sourcePolicy,
  };
}

export function parseFreshnessReviewSourceSnapshot(
  value: unknown,
): FreshnessReviewSourceSnapshot | null {
  const parsed = snapshotSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export function freshnessReviewSourceHash(
  snapshot: FreshnessReviewSourceSnapshot,
): Promise<string> {
  return sha256Fingerprint(snapshot);
}
