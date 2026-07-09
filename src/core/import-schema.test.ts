import { describe, expect, it } from "vitest";
import { parseImportJson } from "./import-schema";

const validMcq = {
  type: "mcq",
  question: "1+1은?",
  choices: ["1", "2", "3", "4"],
  answer_index: 1,
  explanation: "연산",
};

const validCloze = {
  type: "cloze",
  text: "TCP는 {{1}} 지향이며 {{2}} 핸드셰이크를 사용한다.",
  blanks: [
    { id: 1, answer: "연결" },
    { id: 2, answer: "3-way" },
  ],
  distractors: ["비연결"],
};

function parseOne(question: unknown) {
  return parseImportJson(JSON.stringify({ questions: [question] }));
}

describe("parseImportJson fatal errors", () => {
  it("returns fatal when the input is not JSON", () => {
    const result = parseImportJson("not json");

    expect(result.ok).toBe(false);
  });

  it("returns fatal when questions is missing or empty", () => {
    expect(parseImportJson(JSON.stringify({})).ok).toBe(false);
    expect(parseImportJson(JSON.stringify({ questions: [] })).ok).toBe(false);
  });
});

describe("parseImportJson MCQ", () => {
  it("accepts a valid question with four choices", () => {
    const result = parseOne(validMcq);
    if (!result.ok) throw new Error("expected ok");

    expect(result.items[0].ok).toBe(true);
  });

  it("accepts a valid question with five choices", () => {
    const result = parseOne({
      ...validMcq,
      choices: ["1", "2", "3", "4", "5"],
      answer_index: 4,
    });
    if (!result.ok) throw new Error("expected ok");

    expect(result.items[0].ok).toBe(true);
  });

  it("accepts a valid question with six choices", () => {
    const result = parseOne({
      ...validMcq,
      choices: ["1", "2", "3", "4", "5", "6"],
      answer_index: 5,
    });
    if (!result.ok) throw new Error("expected ok");

    expect(result.items[0].ok).toBe(true);
  });

  it("rejects choices with fewer than four items", () => {
    const result = parseOne({ ...validMcq, choices: ["1", "2", "3"] });
    if (!result.ok) throw new Error("expected ok");

    expect(result.items[0].ok).toBe(false);
  });

  it("rejects choices with more than six items", () => {
    const result = parseOne({
      ...validMcq,
      choices: ["1", "2", "3", "4", "5", "6", "7"],
    });
    if (!result.ok) throw new Error("expected ok");

    expect(result.items[0].ok).toBe(false);
  });

  it("rejects answer_index outside the available choices", () => {
    const result = parseOne({ ...validMcq, answer_index: 4 });
    if (!result.ok) throw new Error("expected ok");

    expect(result.items[0].ok).toBe(false);
  });

  it("rejects duplicate choices", () => {
    const result = parseOne({ ...validMcq, choices: ["1", "1", "3", "4"] });
    if (!result.ok) throw new Error("expected ok");

    expect(result.items[0].ok).toBe(false);
  });
});

describe("parseImportJson CLOZE", () => {
  it("accepts a valid question", () => {
    const result = parseOne(validCloze);
    if (!result.ok) throw new Error("expected ok");

    expect(result.items[0].ok).toBe(true);
  });

  it("rejects blanks that do not match text placeholders", () => {
    const result = parseOne({
      ...validCloze,
      blanks: [{ id: 1, answer: "연결" }],
    });
    if (!result.ok) throw new Error("expected ok");

    expect(result.items[0].ok).toBe(false);
  });

  it("rejects empty distractors", () => {
    const result = parseOne({ ...validCloze, distractors: [] });
    if (!result.ok) throw new Error("expected ok");

    expect(result.items[0].ok).toBe(false);
  });

  it("rejects duplicate words across answers and distractors", () => {
    const result = parseOne({ ...validCloze, distractors: ["연결"] });
    if (!result.ok) throw new Error("expected ok");

    expect(result.items[0].ok).toBe(false);
  });
});

describe("parseImportJson mixed results", () => {
  it("returns index-level results for mixed valid and invalid questions", () => {
    const result = parseImportJson(
      JSON.stringify({
        questions: [validMcq, { type: "unknown" }, validCloze],
      }),
    );
    if (!result.ok) throw new Error("expected ok");

    expect(result.items.map((item) => item.ok)).toEqual([true, false, true]);
    expect(
      result.items[1].ok === false && result.items[1].errors.length,
    ).toBeGreaterThan(0);
  });
});
