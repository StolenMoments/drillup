import { describe, expect, it } from "vitest";
import { shuffle, shuffleMcqChoices } from "./random";

describe("shuffle", () => {
  it("does not mutate the original array and returns the same items", () => {
    const input = [1, 2, 3, 4, 5];
    const copy = [...input];
    const result = shuffle(input);

    expect(input).toEqual(copy);
    expect([...result].sort()).toEqual([...input].sort());
    expect(result).toHaveLength(input.length);
  });
});

describe("shuffleMcqChoices", () => {
  it("keeps answers and choice explanations paired with their choices", () => {
    const original = {
      question: "Q",
      choices: ["A", "B", "C", "D"],
      answer_indices: [0, 2],
      choice_explanations: ["A 설명", "B 설명", "C 설명", "D 설명"],
    };
    const shuffled = shuffleMcqChoices(original);

    expect(shuffled.choices).not.toEqual(original.choices);
    expect(shuffled.answer_indices?.map((index) => shuffled.choices[index]).sort()).toEqual(["A", "C"]);
    expect(shuffled.choice_explanations?.[shuffled.choices.indexOf("C")]).toBe("C 설명");
  });
});
