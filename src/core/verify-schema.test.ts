import { describe, expect, it } from "vitest";
import type { ImportItemResult } from "./import-schema";
import { mergeVerdicts, parseVerifyJson } from "./verify-schema";

const MCQ = {
  type: "mcq" as const,
  question: "질문?",
  choices: ["a", "b", "c", "d"],
  answer_index: 0,
};

describe("parseVerifyJson", () => {
  it("정상 verdicts를 파싱하고 빈 comment는 null로 정규화한다", () => {
    const result = parseVerifyJson(
      JSON.stringify({
        verdicts: [
          { index: 0, verdict: "pass", comment: "" },
          { index: 1, verdict: "fail", comment: " 정답 오류 " },
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      verdicts: [
        { index: 0, verdict: "pass", comment: null },
        { index: 1, verdict: "fail", comment: "정답 오류" },
      ],
    });
  });

  it("comment가 없어도 허용한다", () => {
    const result = parseVerifyJson(
      JSON.stringify({ verdicts: [{ index: 0, verdict: "pass" }] }),
    );
    expect(result).toEqual({
      ok: true,
      verdicts: [{ index: 0, verdict: "pass", comment: null }],
    });
  });

  it("형식이 어긋난 verdict는 건너뛴다", () => {
    const result = parseVerifyJson(
      JSON.stringify({
        verdicts: [
          { index: 0, verdict: "ok" },
          { index: "1", verdict: "pass" },
          { index: 2, verdict: "fail", comment: "사유" },
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      verdicts: [{ index: 2, verdict: "fail", comment: "사유" }],
    });
  });

  it("JSON이 아니면 실패한다", () => {
    expect(parseVerifyJson("검증했습니다!")).toEqual({
      ok: false,
      fatal: "올바른 JSON이 아닙니다",
    });
  });

  it("verdicts 배열이 없으면 실패한다", () => {
    expect(parseVerifyJson('{"result": []}')).toEqual({
      ok: false,
      fatal: "최상위에 verdicts 배열이 있어야 합니다",
    });
  });
});

describe("mergeVerdicts", () => {
  const items: ImportItemResult[] = [
    { index: 0, ok: true, question: MCQ },
    { index: 1, ok: false, errors: ["오류"] },
    { index: 2, ok: true, question: MCQ },
  ];

  it("index로 매칭해 verdict를 병합한다", () => {
    const merged = mergeVerdicts(items, [
      { index: 0, verdict: "pass", comment: null },
      { index: 2, verdict: "fail", comment: "복수 정답 소지" },
    ]);
    expect(merged).toEqual([
      { index: 0, ok: true, question: MCQ, verdict: "pass", verdictComment: null },
      { index: 1, ok: false, errors: ["오류"] },
      {
        index: 2,
        ok: true,
        question: MCQ,
        verdict: "fail",
        verdictComment: "복수 정답 소지",
      },
    ]);
  });

  it("verdict가 없는 유효 항목은 unverified로 남긴다", () => {
    const merged = mergeVerdicts(items, [
      { index: 0, verdict: "pass", comment: null },
    ]);
    expect(merged[2]).toEqual({
      index: 2,
      ok: true,
      question: MCQ,
      verdict: "unverified",
      verdictComment: null,
    });
  });

  it("빈 verdicts면 전 유효 항목이 unverified가 된다", () => {
    const merged = mergeVerdicts(items, []);
    expect(
      merged.filter((item) => item.ok).every((item) => item.verdict === "unverified"),
    ).toBe(true);
  });

  it("ok:false 항목은 그대로 통과시킨다", () => {
    const merged = mergeVerdicts(items, [
      { index: 1, verdict: "pass", comment: null },
    ]);
    expect(merged[1]).toEqual({ index: 1, ok: false, errors: ["오류"] });
  });
});
