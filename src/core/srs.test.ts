import { describe, expect, it } from "vitest";
import { INITIAL_SRS, MIN_EASE_FACTOR, applyAnswer } from "./srs";

describe("applyAnswer for correct answers", () => {
  it("sets interval to 1 day and repetitions to 1 for the first correct answer", () => {
    const next = applyAnswer(INITIAL_SRS, true);

    expect(next).toEqual({
      easeFactor: 2.5,
      intervalDays: 1,
      repetitions: 1,
      lapses: 0,
      dueInDays: 1,
    });
  });

  it("sets interval to 3 days for the second correct answer", () => {
    const next = applyAnswer(
      { easeFactor: 2.5, intervalDays: 1, repetitions: 1, lapses: 0 },
      true,
    );

    expect(next.intervalDays).toBe(3);
    expect(next.repetitions).toBe(2);
    expect(next.dueInDays).toBe(3);
  });

  it("uses round(previous interval * ease factor) from the third correct answer", () => {
    const next = applyAnswer(
      { easeFactor: 2.5, intervalDays: 3, repetitions: 2, lapses: 0 },
      true,
    );

    expect(next.intervalDays).toBe(8);
    expect(next.easeFactor).toBe(2.5);
    expect(next.repetitions).toBe(3);
  });
});

describe("applyAnswer for wrong answers", () => {
  it("resets repetitions and interval, lowers ease factor, increments lapses, and keeps dueInDays at 0", () => {
    const next = applyAnswer(
      { easeFactor: 2.5, intervalDays: 8, repetitions: 3, lapses: 0 },
      false,
    );

    expect(next).toEqual({
      easeFactor: 2.3,
      intervalDays: 0,
      repetitions: 0,
      lapses: 1,
      dueInDays: 0,
    });
  });

  it("does not lower ease factor below the minimum", () => {
    const next = applyAnswer(
      { easeFactor: 1.4, intervalDays: 1, repetitions: 1, lapses: 5 },
      false,
    );

    expect(next.easeFactor).toBe(MIN_EASE_FACTOR);
  });
});
