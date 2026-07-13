import { describe, expect, it } from "vitest";
import type { ImportItemResult } from "./import-schema";
import { attachTestedDistinctions, prepareGeneratedItems } from "./generation-result";
import type { QuestionBlueprint } from "./question-blueprint";
import type { VerifiedItemResult } from "./verify-schema";

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

const question = {
  type: "mcq" as const,
  question: "q",
  choices: ["a", "b", "c", "d"],
  answer_index: 0,
};

function blueprintWith(testedDistinction: string): QuestionBlueprint {
  return { testedDistinction } as unknown as QuestionBlueprint;
}

describe("attachTestedDistinctions", () => {
  it("ok 아이템에 인덱스가 가리키는 블루프린트의 testedDistinction을 붙인다", () => {
    const items: VerifiedItemResult[] = [
      { index: 0, ok: true, question, verdict: "pass", verdictComment: null },
      { index: 1, ok: false, errors: ["bad"] },
    ];
    const blueprints = [blueprintWith("관리형 대 자체 운영 구분"), blueprintWith("무관")];
    expect(attachTestedDistinctions(items, blueprints)).toEqual([
      { index: 0, ok: true, question, verdict: "pass", verdictComment: null, testedDistinction: "관리형 대 자체 운영 구분" },
      { index: 1, ok: false, errors: ["bad"] },
    ]);
  });

  it("블루프린트가 없거나 distinction이 공백이면 null을 붙인다", () => {
    const items: VerifiedItemResult[] = [
      { index: 0, ok: true, question, verdict: "unverified", verdictComment: null },
      { index: 5, ok: true, question, verdict: "pass", verdictComment: null },
    ];
    const result = attachTestedDistinctions(items, [blueprintWith("   ")]);
    expect(result[0]).toMatchObject({ testedDistinction: null });
    expect(result[1]).toMatchObject({ testedDistinction: null }); // index 5는 범위 밖
  });
});
