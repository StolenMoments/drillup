import { describe, expect, it } from "vitest";
import type { GenerationItemDto, GenerationJobDto } from "./api-types";
import {
  getSavedFlashMessage,
  getRevisionCounts,
  isQuestionItemSaveable,
  selectValidItemIndices,
} from "./generation-ux";

function item(
  overrides: Partial<Extract<GenerationItemDto, { ok: true }>> = {},
): Extract<GenerationItemDto, { ok: true }> {
  return {
    index: 0,
    ok: true,
    question: { type: "mcq", question: "문제", choices: [], answer_index: 0 },
    verdict: "pass",
    verdictComment: null,
    revision: null,
    ...overrides,
  };
}

describe("generation review UX state", () => {
  it("검증 실패 문항은 수정본이 적용된 경우에만 저장 가능하다", () => {
    const failed = item({ verdict: "fail" });
    const applied = item({
      verdict: "fail",
      revision: {
        status: "SUCCEEDED",
        engine: "CLAUDE",
        verdict: "pass",
        comment: "수정했습니다",
        proposedQuestion: { type: "mcq" },
        appliedQuestion: { type: "mcq" },
        errorMessage: null,
      },
    });

    expect(isQuestionItemSaveable(failed)).toBe(false);
    expect(isQuestionItemSaveable(applied)).toBe(true);
  });

  it("선택 초기화와 수정본 진행/적용 개수를 같은 기준으로 계산한다", () => {
    const items: GenerationItemDto[] = [
      item({ index: 0 }),
      item({
        index: 1,
        verdict: "fail",
        revision: {
          status: "RUNNING",
          engine: "CLAUDE",
          verdict: null,
          comment: null,
          proposedQuestion: null,
          appliedQuestion: null,
          errorMessage: null,
        },
      }),
      item({
        index: 2,
        verdict: "fail",
        revision: {
          status: "SUCCEEDED",
          engine: "CLAUDE",
          verdict: "pass",
          comment: null,
          proposedQuestion: { type: "mcq" },
          appliedQuestion: { type: "mcq" },
          errorMessage: null,
        },
      }),
      { index: 3, ok: false, errors: ["잘못된 문항"] },
    ];
    const job = {
      status: "SUCCEEDED",
      kind: "QUESTION",
      items,
    } as unknown as GenerationJobDto;

    expect([...selectValidItemIndices(job)]).toEqual([0, 2]);
    expect(getRevisionCounts(items)).toEqual({ applied: 1, running: 1 });
  });

  it("저장 완료 쿼리는 양의 정수일 때만 플래시 문구가 된다", () => {
    expect(getSavedFlashMessage("3")).toBe("✅ 3개 항목을 저장했습니다.");
    expect(getSavedFlashMessage("0")).toBe("✅ 0개 항목을 저장했습니다.");
    expect(getSavedFlashMessage("-1")).toBeNull();
    expect(getSavedFlashMessage("not-a-number")).toBeNull();
  });
});
