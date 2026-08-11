import { describe, expect, it } from "vitest";
import { parseFreshnessReviewJson } from "./freshness-review-schema";

const revised = {
  question: "교정된 질문",
  choices: ["정답", "오답 1", "오답 2", "오답 3"],
  answer_indices: [0],
  choice_explanations: ["근거 1", "근거 2", "근거 3", "근거 4"],
};

describe("parseFreshnessReviewJson", () => {
  it("pass와 선택적 교정안을 파싱한다", () => {
    expect(parseFreshnessReviewJson(JSON.stringify({ verdict: "pass", comment: "최신입니다", evidence_url: "https://vendor.example/docs" }), "OFFICIAL_DOCS")).toMatchObject({ ok: true, verdict: "pass", payload: null });
    expect(parseFreshnessReviewJson(JSON.stringify({ verdict: "fail", comment: "변경됨", revised }), "OFFICIAL_DOCS")).toMatchObject({ ok: true, verdict: "fail", payload: revised });
  });

  it("AWS 정책에서 docs.aws.amazon.com 이외 근거는 판단 불가로 낮춘다", () => {
    expect(parseFreshnessReviewJson(JSON.stringify({ verdict: "fail", comment: "오류", evidence_url: "https://aws.amazon.com/blogs/x", revised }), "AWS_DOCS_ONLY")).toMatchObject({ ok: true, verdict: "unverified", payload: null });
    expect(parseFreshnessReviewJson(JSON.stringify({ verdict: "fail", comment: "오류", evidence_url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/x.html", revised }), "AWS_DOCS_ONLY")).toMatchObject({ ok: true, verdict: "fail", payload: revised });
  });

  it("fail이 아닌 판정의 교정안과 불완전한 교정안을 거부한다", () => {
    expect(parseFreshnessReviewJson(JSON.stringify({ verdict: "pass", comment: "정확", revised }), "OFFICIAL_DOCS")).toEqual({ ok: false, fatal: "revised는 fail 판정일 때만 포함할 수 있습니다" });
    expect(parseFreshnessReviewJson(JSON.stringify({ verdict: "fail", comment: "오류", revised: { question: "x" } }), "OFFICIAL_DOCS")).toEqual({ ok: false, fatal: "revised가 완전한 MCQ payload 형식에 맞지 않습니다" });
  });
});
