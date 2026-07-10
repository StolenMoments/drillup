import { describe, expect, it } from "vitest";
import { gradeCloze, gradeMcq } from "./grading";
import type { ClozePayload, McqPayload } from "./types";

const mcq: McqPayload = {
  question: "1+1은?",
  choices: ["1", "2", "3", "4"],
  answer_index: 1,
};

const cloze: ClozePayload = {
  text: "TCP는 {{1}} 지향이며 {{2}} 핸드셰이크를 사용한다.",
  blanks: [
    { id: 1, answer: "연결" },
    { id: 2, answer: "3-way" },
  ],
  distractors: ["비연결", "4-way"],
};

describe("gradeMcq", () => {
  it("returns true when the selected index is correct", () => {
    expect(gradeMcq(mcq, { selected_indices: [1] })).toBe(true);
  });

  it("returns false when the selected index is wrong", () => {
    expect(gradeMcq(mcq, { selected_indices: [0] })).toBe(false);
  });

  it("requires the same two answers regardless of selection order", () => {
    const twoAnswers: McqPayload = { ...mcq, answer_index: undefined, answer_indices: [0, 2] };
    expect(gradeMcq(twoAnswers, { selected_indices: [2, 0] })).toBe(true);
    expect(gradeMcq(twoAnswers, { selected_indices: [0] })).toBe(false);
    expect(gradeMcq(twoAnswers, { selected_indices: [0, 1] })).toBe(false);
  });
});

describe("gradeCloze", () => {
  it("returns true when every blank is correct", () => {
    expect(gradeCloze(cloze, { filled: { "1": "연결", "2": "3-way" } })).toBe(
      true,
    );
  });

  it("ignores leading and trailing whitespace when comparing answers", () => {
    expect(
      gradeCloze(cloze, { filled: { "1": " 연결 ", "2": "3-way" } }),
    ).toBe(true);
  });

  it("returns false when any blank is wrong", () => {
    expect(
      gradeCloze(cloze, { filled: { "1": "연결", "2": "4-way" } }),
    ).toBe(false);
  });

  it("returns false when a blank is missing", () => {
    expect(gradeCloze(cloze, { filled: { "1": "연결" } })).toBe(false);
  });
});
