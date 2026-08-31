import { describe, expect, it } from "vitest";
import { aiOutputContracts } from "./ai-output-contracts";
import { parseAiOutputContract } from "./ai-output-contract";
import { parseRevisionJson } from "./revision-schema";

describe("parseAiOutputContract", () => {
  it("모든 계약이 구조화 출력용 strict object schema를 제공한다", () => {
    function assertStrict(value: unknown): void {
      if (Array.isArray(value)) {
        value.forEach(assertStrict);
        return;
      }
      if (typeof value !== "object" || value === null) return;
      const schema = value as Record<string, unknown>;
      if (schema.type === "object" && schema.properties) {
        expect(schema.additionalProperties).toBe(false);
        expect(new Set(schema.required as string[])).toEqual(
          new Set(Object.keys(schema.properties as Record<string, unknown>)),
        );
      }
      Object.values(schema).forEach(assertStrict);
    }
    Object.values(aiOutputContracts).forEach((contract) =>
      assertStrict(contract.schema),
    );
  });

  it("#109 revise 별칭을 fail로 정규화한다", () => {
    const result = parseAiOutputContract(
      aiOutputContracts.revisionPassFail,
      JSON.stringify({
        verdict: " revise ",
        comment: "수정 필요",
        revised_question: {
          type: "mcq",
          question: "정답을 고르세요.",
          choices: ["A", "B", "C", "D"],
          answer_indices: [0],
          choice_explanations: ["정답", "오답", "오답", "오답"],
          explanation: "정답 해설",
          keywords: ["핵심"],
        },
      }),
    );
    expect(result).toMatchObject({ ok: true });
    if (result.ok) {
      expect(result.value.verdict).toBe("fail");
      expect(result.warnings[0]).toContain("normalized");
      expect(parseRevisionJson(result.normalizedText)).toMatchObject({
        ok: true,
        verdict: "fail",
      });
    }
  });

  it("의미가 다른 사실 검증 verdict에는 별칭을 적용하지 않는다", () => {
    const result = parseAiOutputContract(
      aiOutputContracts.factualReview,
      JSON.stringify({ verdict: "approved", comment: "ok", evidence_url: null }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        "verdict: expected confirmed|rejected|unverifiable, received approved",
      );
    }
  });

  it("계약 오류에 실제 경로와 값을 남긴다", () => {
    const result = parseAiOutputContract(
      aiOutputContracts.revisionPassFail,
      JSON.stringify({
        verdict: "maybe",
        comment: "검토",
        revised_question: {},
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors).toContain(
        "verdict: expected pass|fail, received maybe",
      );
    }
  });

  it("rejects fields that are not declared by the contract", () => {
    const result = parseAiOutputContract(
      aiOutputContracts.note,
      JSON.stringify({ note: "ok", leaked: true }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("; ")).toContain("leaked");
  });
});
