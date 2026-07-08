import { describe, expect, it } from "vitest";
import { capSummaries, summarizeQuestionPayload } from "./question-summary";

describe("summarizeQuestionPayload", () => {
  it("MCQ는 질문 텍스트를 반환한다", () => {
    expect(
      summarizeQuestionPayload("MCQ", {
        question: "리눅스 커널을 만든 사람은?",
        choices: ["a", "b", "c", "d"],
        answer_index: 0,
      }),
    ).toBe("리눅스 커널을 만든 사람은?");
  });

  it("CLOZE는 빈칸을 정답 단어로 채운 문장을 반환한다", () => {
    expect(
      summarizeQuestionPayload("CLOZE", {
        text: "{{1}}는 {{2}}년에 발표되었다.",
        blanks: [
          { id: 1, answer: "리눅스" },
          { id: 2, answer: "1991" },
        ],
        distractors: ["유닉스"],
      }),
    ).toBe("리눅스는 1991년에 발표되었다.");
  });

  it("blanks에 없는 자리표시자는 원문 그대로 둔다", () => {
    expect(
      summarizeQuestionPayload("CLOZE", {
        text: "{{1}}과 {{9}}",
        blanks: [{ id: 1, answer: "커널" }],
        distractors: ["셸"],
      }),
    ).toBe("커널과 {{9}}");
  });

  it("payload가 객체가 아니거나 형태가 다르면 빈 문자열을 반환한다", () => {
    expect(summarizeQuestionPayload("MCQ", null)).toBe("");
    expect(summarizeQuestionPayload("MCQ", "문자열")).toBe("");
    expect(summarizeQuestionPayload("MCQ", { question: 123 })).toBe("");
    expect(summarizeQuestionPayload("CLOZE", { blanks: [] })).toBe("");
  });
});

describe("capSummaries", () => {
  it("빈 문자열을 제거하고 순서를 유지한다", () => {
    expect(capSummaries(["a", "", "b"])).toEqual({
      kept: ["a", "b"],
      truncated: false,
    });
  });

  it("합계가 maxChars를 넘기 직전에서 절단하고 truncated를 표시한다", () => {
    expect(capSummaries(["12345", "67890", "abc"], 10)).toEqual({
      kept: ["12345", "67890"],
      truncated: true,
    });
  });

  it("정확히 maxChars까지는 유지한다", () => {
    expect(capSummaries(["12345", "67890"], 10)).toEqual({
      kept: ["12345", "67890"],
      truncated: false,
    });
  });
});
