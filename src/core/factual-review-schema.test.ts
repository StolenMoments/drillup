import { describe, expect, it } from "vitest";
import { parseFactualReviewJson } from "./factual-review-schema";

const confirmedRevised = {
  question: "Q 교정",
  choices: ["a 교정", "b", "c", "d"],
  answer_indices: [0],
  choice_explanations: ["e1 교정", "e2", "e3", "e4"],
};

describe("parseFactualReviewJson", () => {
  it("JSON이 아니면 실패한다", () => {
    expect(parseFactualReviewJson("not json")).toEqual({
      ok: false,
      fatal: "올바른 JSON이 아닙니다",
    });
  });

  it("verdict나 comment가 없으면 실패한다", () => {
    const result = parseFactualReviewJson(JSON.stringify({ verdict: "rejected" }));
    expect(result).toMatchObject({ ok: false });
  });

  it("verdict가 허용되지 않은 값이면 실패한다", () => {
    const result = parseFactualReviewJson(
      JSON.stringify({ verdict: "maybe", comment: "의견" }),
    );
    expect(result).toMatchObject({ ok: false });
  });

  describe("rejected", () => {
    it("payload는 null이고 comment/evidenceUrl을 반환한다", () => {
      const result = parseFactualReviewJson(
        JSON.stringify({
          verdict: "rejected",
          comment: "현재 문제가 옳습니다",
          evidence_url: "https://docs.aws.amazon.com/x",
        }),
      );
      expect(result).toEqual({
        ok: true,
        verdict: "rejected",
        comment: "현재 문제가 옳습니다",
        evidenceUrl: "https://docs.aws.amazon.com/x",
        payload: null,
      });
    });

    it("revised가 있어도 무시하고 payload는 null이다", () => {
      const result = parseFactualReviewJson(
        JSON.stringify({
          verdict: "rejected",
          comment: "현재 문제가 옳습니다",
          revised: confirmedRevised,
        }),
      );
      expect(result).toMatchObject({ ok: true, verdict: "rejected", payload: null });
    });
  });

  describe("unverifiable", () => {
    it("payload는 null이다", () => {
      const result = parseFactualReviewJson(
        JSON.stringify({ verdict: "unverifiable", comment: "판단할 수 없습니다" }),
      );
      expect(result).toMatchObject({ ok: true, verdict: "unverifiable", payload: null });
    });
  });

  describe("evidence_url 정규화", () => {
    it("없으면 null이다", () => {
      const result = parseFactualReviewJson(
        JSON.stringify({ verdict: "rejected", comment: "의견" }),
      );
      expect(result).toMatchObject({ ok: true, evidenceUrl: null });
    });

    it("빈 문자열이면 null로 정규화한다", () => {
      const result = parseFactualReviewJson(
        JSON.stringify({ verdict: "rejected", comment: "의견", evidence_url: "" }),
      );
      expect(result).toMatchObject({ ok: true, evidenceUrl: null });
    });

    it("null이면 null로 정규화한다", () => {
      const result = parseFactualReviewJson(
        JSON.stringify({ verdict: "rejected", comment: "의견", evidence_url: null }),
      );
      expect(result).toMatchObject({ ok: true, evidenceUrl: null });
    });
  });

  describe("confirmed", () => {
    it("revised가 없으면 실패한다", () => {
      const result = parseFactualReviewJson(
        JSON.stringify({ verdict: "confirmed", comment: "이의가 타당합니다" }),
      );
      expect(result).toMatchObject({ ok: false });
    });

    it("revised가 MCQ payload 형식이 아니면 실패한다", () => {
      const result = parseFactualReviewJson(
        JSON.stringify({
          verdict: "confirmed",
          comment: "이의가 타당합니다",
          revised: { question: "q" },
        }),
      );
      expect(result).toMatchObject({ ok: false });
    });

    it("answer_indices나 choice_explanations가 없으면 실패한다", () => {
      const revised = { ...confirmedRevised } as Record<string, unknown>;
      delete revised.answer_indices;
      const result = parseFactualReviewJson(
        JSON.stringify({ verdict: "confirmed", comment: "이의가 타당합니다", revised }),
      );
      expect(result).toMatchObject({ ok: false });
    });

    it("choice_explanations 개수가 choices 개수와 다르면 실패한다", () => {
      const result = parseFactualReviewJson(
        JSON.stringify({
          verdict: "confirmed",
          comment: "이의가 타당합니다",
          revised: { ...confirmedRevised, choice_explanations: ["e1"] },
        }),
      );
      expect(result).toMatchObject({ ok: false });
    });

    it("answer_indices가 비어있으면 실패한다", () => {
      const result = parseFactualReviewJson(
        JSON.stringify({
          verdict: "confirmed",
          comment: "이의가 타당합니다",
          revised: { ...confirmedRevised, answer_indices: [] },
        }),
      );
      expect(result).toMatchObject({ ok: false });
    });

    it("answer_indices에 choices 범위를 벗어난 인덱스가 있으면 실패한다", () => {
      const result = parseFactualReviewJson(
        JSON.stringify({
          verdict: "confirmed",
          comment: "이의가 타당합니다",
          revised: { ...confirmedRevised, answer_indices: [9] },
        }),
      );
      expect(result).toMatchObject({ ok: false });
    });

    it("answer_indices에 중복이 있으면 실패한다", () => {
      const result = parseFactualReviewJson(
        JSON.stringify({
          verdict: "confirmed",
          comment: "이의가 타당합니다",
          revised: { ...confirmedRevised, answer_indices: [0, 0] },
        }),
      );
      expect(result).toMatchObject({ ok: false });
    });

    it("원본과 동일성 검증 없이 정답 텍스트·인덱스 변경을 허용한다", () => {
      const result = parseFactualReviewJson(
        JSON.stringify({
          verdict: "confirmed",
          comment: "정답이 바뀌어야 합니다",
          evidence_url: "https://docs.aws.amazon.com/y",
          revised: {
            question: "Q 교정",
            choices: ["a", "b 새 정답", "c", "d"],
            answer_indices: [1],
            choice_explanations: ["e1", "e2 새 근거", "e3", "e4"],
          },
        }),
      );
      expect(result).toEqual({
        ok: true,
        verdict: "confirmed",
        comment: "정답이 바뀌어야 합니다",
        evidenceUrl: "https://docs.aws.amazon.com/y",
        payload: {
          question: "Q 교정",
          choices: ["a", "b 새 정답", "c", "d"],
          answer_indices: [1],
          choice_explanations: ["e1", "e2 새 근거", "e3", "e4"],
        },
      });
    });
  });
});
