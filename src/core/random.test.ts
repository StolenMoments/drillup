import { describe, expect, it } from "vitest";
import { shuffle } from "./random";

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
