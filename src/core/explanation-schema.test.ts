import { describe, expect, it } from "vitest";
import { parseExplanationJson } from "./explanation-schema";

describe("parseExplanationJson", () => {
  it("정상 JSON을 파싱한다", () => {
    const result = parseExplanationJson('{"explanation":"정답은 A입니다."}');
    expect(result).toEqual({ ok: true, explanation: "정답은 A입니다." });
  });

  it("JSON이 아니면 실패한다", () => {
    const result = parseExplanationJson("이건 JSON이 아님");
    expect(result.ok).toBe(false);
  });

  it("explanation이 빈 문자열이면 실패한다", () => {
    const result = parseExplanationJson('{"explanation":"   "}');
    expect(result.ok).toBe(false);
  });

  it("explanation 필드가 없으면 실패한다", () => {
    const result = parseExplanationJson('{"foo":"bar"}');
    expect(result.ok).toBe(false);
  });
});
