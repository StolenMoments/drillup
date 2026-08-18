import { describe, expect, it } from "vitest";
import {
  createFreshnessReviewSourceSnapshot,
  freshnessReviewSourceHash,
  parseFreshnessReviewSourceSnapshot,
} from "./freshness-review-source";

const payload = {
  question: "현재 사실과 일치하는 것은?",
  choices: ["정답", "오답 1", "오답 2", "오답 3"],
  answer_indices: [0],
  choice_explanations: ["근거 1", "근거 2", "근거 3", "근거 4"],
};

function snapshot(overrides: Record<string, unknown> = {}) {
  return createFreshnessReviewSourceSnapshot({
    payload,
    explanation: "전체 해설",
    topicName: "AWS",
    sourcePolicy: "AWS_DOCS_ONLY",
    ...overrides,
  });
}

describe("freshness review source", () => {
  it("같은 입력은 객체 key 순서와 무관하게 같은 hash를 만든다", async () => {
    const first = snapshot();
    const reordered = {
      sourcePolicy: first.sourcePolicy,
      topicName: first.topicName,
      explanation: first.explanation,
      payload: first.payload,
      cacheVersion: first.cacheVersion,
    };

    await expect(freshnessReviewSourceHash(first)).resolves.toBe(
      await freshnessReviewSourceHash(reordered),
    );
  });

  it.each([
    ["payload", { payload: { ...payload, question: "수정된 질문" } }],
    ["해설", { explanation: "수정된 해설" }],
    ["주제명", { topicName: "Kubernetes" }],
    ["출처 정책", { sourcePolicy: "OFFICIAL_DOCS" }],
  ])("%s 변경 시 다른 hash를 만든다", async (_label, overrides) => {
    expect(await freshnessReviewSourceHash(snapshot(overrides))).not.toBe(
      await freshnessReviewSourceHash(snapshot()),
    );
  });

  it("snapshot에 캐시 버전을 저장하고 다시 읽는다", () => {
    const value = snapshot();
    expect(value.cacheVersion).toBe(1);
    expect(parseFreshnessReviewSourceSnapshot(value)).toEqual(value);
    expect(parseFreshnessReviewSourceSnapshot(null)).toBeNull();
  });

  it("캐시 버전이 바뀌면 다른 hash를 만든다", async () => {
    const current = snapshot();
    const next = { ...current, cacheVersion: current.cacheVersion + 1 };

    expect(await freshnessReviewSourceHash(next)).not.toBe(
      await freshnessReviewSourceHash(current),
    );
  });
});
