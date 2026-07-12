import { describe, expect, it } from "vitest";
import { importMcqSchema, parseImportJson, validateGeneratedQuestions } from "./import-schema";

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

  it("accepts one or two answer indices and per-choice explanations", () => {
    const result = parseOne({
      ...validMcq,
      answer_index: undefined,
      answer_indices: [0, 2],
      choice_explanations: ["a", "b", "c", "d"],
    });
    expect(result.ok && result.items[0].ok).toBe(true);
  });

  it("rejects duplicate or out-of-range indices and mismatched explanations", () => {
    const cases = [
      { answer_indices: [0, 0], choice_explanations: ["a", "b", "c", "d"] },
      { answer_indices: [4], choice_explanations: ["a", "b", "c", "d"] },
      { answer_indices: [0], choice_explanations: ["a"] },
    ];
    for (const candidate of cases) {
      const result = parseOne({ ...validMcq, answer_index: undefined, ...candidate });
      expect(result.ok && result.items[0].ok).toBe(false);
    }
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

describe("validateGeneratedQuestions", () => {
  it("rejects MCQs that do not match the requested answer and choice counts", () => {
    const result = validateGeneratedQuestions([
      {
        type: "mcq",
        question: "Q",
        choices: ["A", "B", "C", "D", "E"],
        answer_indices: [0],
        choice_explanations: ["a", "b", "c", "d", "e"],
      },
    ], { correctAnswerCount: 2, choiceCount: 4 });

    expect(result[0]).toMatchObject({ ok: false });
    if (!result[0]?.ok) {
      expect(result[0].errors.join(" ")).toContain("정답은 2개여야 합니다");
      expect(result[0].errors.join(" ")).toContain("보기는 4개여야 합니다");
    }
  });

  it("requires the two-answer instruction for two-answer MCQs", () => {
    const result = validateGeneratedQuestions([
      {
        type: "mcq",
        question: "가장 적절한 해법은 무엇인가요?",
        choices: ["A", "B", "C", "D"],
        answer_indices: [0, 1],
        choice_explanations: ["a", "b", "c", "d"],
      },
    ], { correctAnswerCount: 2, choiceCount: 4 });

    expect(result[0]).toMatchObject({ ok: false });
    if (!result[0]?.ok) expect(result[0].errors.join(" ")).toContain("2개를 선택하세요");
  });
});

describe("keywords 필드", () => {
  const baseMcq = {
    type: "mcq",
    question: "질문",
    choices: ["a", "b", "c", "d"],
    answer_index: 0,
  };

  it("keywords가 있으면 통과하고 값을 유지한다", () => {
    const result = importMcqSchema.safeParse({
      ...baseMcq,
      keywords: ["TCP", "3-way handshake"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.keywords).toEqual(["TCP", "3-way handshake"]);
    }
  });

  it("keywords가 없어도 통과한다", () => {
    expect(importMcqSchema.safeParse(baseMcq).success).toBe(true);
  });

  it("keywords가 6개 이상이면 거부한다", () => {
    const result = importMcqSchema.safeParse({
      ...baseMcq,
      keywords: ["1", "2", "3", "4", "5", "6", "7"],
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.keywords).toEqual(["1", "2", "3", "4", "5", "6", "7"]);
  });

  it("빈 문자열 키워드는 거부한다", () => {
    const result = importMcqSchema.safeParse({ ...baseMcq, keywords: ["  "] });
    expect(result.success).toBe(false);
  });

  it("50자를 넘는 키워드는 거부한다", () => {
    const result = importMcqSchema.safeParse({
      ...baseMcq,
      keywords: ["a".repeat(51)],
    });
    expect(result.success).toBe(false);
  });
});
