import { describe, expect, it } from "vitest";
import type { ImportItemResult } from "./import-schema";
import { prepareGeneratedItems } from "./generation-result";

describe("prepareGeneratedItems", () => {
  it("does not replace an original error with an invalid type error", () => {
    const input: ImportItemResult[] = [{ index: 0, ok: false, errors: ["keywords: keyword error"] }];
    expect(prepareGeneratedItems(input)).toEqual({
      items: input,
      validCount: 0,
      failureMessage: "생성된 1개 문항이 모두 유효성 검사를 통과하지 못했습니다. 첫 오류: #1 keywords: keyword error",
    });
  });

  it("keeps valid and invalid source items together", () => {
    const valid = { index: 2, ok: true as const, question: { type: "mcq" as const, question: "q", choices: ["a", "b", "c", "d"], answer_indices: [0], choice_explanations: ["a", "b", "c", "d"] } };
    const invalid: ImportItemResult = { index: 4, ok: false, errors: ["keywords: bad"] };
    const result = prepareGeneratedItems([valid, invalid]);
    expect(result.validCount).toBe(1);
    expect(result.items).toContainEqual(invalid);
    expect(result.failureMessage).toBeNull();
  });

  it("keeps the original index for generation-only validation failures", () => {
    const result = prepareGeneratedItems([{ index: 7, ok: true, question: { type: "mcq", question: "q", choices: ["a", "b", "c", "d"], answer_index: 0 } }]);
    expect(result.items).toEqual([{ index: 7, ok: false, errors: expect.any(Array) }]);
  });
});
