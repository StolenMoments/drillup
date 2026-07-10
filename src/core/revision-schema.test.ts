import { describe, expect, it } from "vitest";
import { parseRevisionJson } from "./revision-schema";

describe("parseRevisionJson", () => {
  it("유효한 수정 문제를 검증한다", () => {
    expect(
      parseRevisionJson(JSON.stringify({
        verdict: "fail",
        comment: "정답을 바로잡았습니다",
        revised_question: {
          type: "mcq",
          question: "질문",
          choices: ["a", "b", "c", "d"],
          answer_index: 0,
          explanation: "해설",
        },
      })),
    ).toMatchObject({ ok: true, verdict: "fail", comment: "정답을 바로잡았습니다" });
  });

  it("수정 문제가 유효하지 않으면 실패한다", () => {
    expect(
      parseRevisionJson('{"verdict":"pass","comment":"확인","revised_question":{"type":"mcq"}}'),
    ).toEqual({ ok: false, fatal: "수정 문제가 가져오기 형식에 맞지 않습니다" });
  });
});
