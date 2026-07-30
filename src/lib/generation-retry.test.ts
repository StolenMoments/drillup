import { describe, expect, it } from "vitest";
import type { GenerationJobDto } from "./api-types";
import { buildGenerationRetryInput } from "./generation-retry";

function questionJob(overrides: Partial<GenerationJobDto> = {}): GenerationJobDto {
  return {
    id: 42,
    topicId: 7,
    engine: "CODEX",
    verifyEngine: "ANTIGRAVITY",
    instructions: "기존 추가 지시",
    referenceFiles: ["common/a.md", "missing.md"],
    correctAnswerCount: 2,
    choiceCount: 6,
    status: "FAILED",
    kind: "QUESTION",
    items: null,
    keywordItems: null,
    errorMessage: "실패",
    verifyWarning: null,
    createdAt: "2026-07-13T00:00:00.000Z",
    finishedAt: "2026-07-13T00:01:00.000Z",
    approvedAt: null,
    savedCount: 0,
    sourceQuestionIds: [101, 102],
    ...overrides,
  };
}

describe("buildGenerationRetryInput", () => {
  it("maps all question-generation inputs and reports missing references", () => {
    expect(
      buildGenerationRetryInput(questionJob(), ["common/a.md", "common/other.md"]),
    ).toEqual({
      input: {
        topicId: 7,
        engine: "CODEX",
        verifyEngine: "ANTIGRAVITY",
        instructions: "기존 추가 지시",
        correctAnswerCount: 2,
        choiceCount: 6,
        referenceFiles: ["common/a.md"],
        sourceQuestionIds: [101, 102],
      },
      missingReferenceFiles: ["missing.md"],
    });
  });

  it("uses safe defaults when the stored question shape is null", () => {
    const result = buildGenerationRetryInput(
      questionJob({ correctAnswerCount: null, choiceCount: null }),
      [],
    );

    expect(result.input).toMatchObject({
      correctAnswerCount: 1,
      choiceCount: 5,
      referenceFiles: [],
    });
  });

  it("does not produce retry input for keyword-tag jobs", () => {
    const result = buildGenerationRetryInput(
      questionJob({ kind: "KEYWORD_TAG", referenceFiles: ["missing.md"] }),
      [],
    );

    expect(result).toEqual({ input: null, missingReferenceFiles: [] });
  });

  it("keeps only currently available reference files", () => {
    const result = buildGenerationRetryInput(
      questionJob({ referenceFiles: ["a.md", "a.md", "b.md"] }),
      ["b.md", "c.md"],
    );

    expect(result.input?.referenceFiles).toEqual(["b.md"]);
    expect(result.missingReferenceFiles).toEqual(["a.md"]);
  });
});
