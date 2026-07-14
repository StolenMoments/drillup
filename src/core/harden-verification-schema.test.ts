import { describe, expect, it } from "vitest";
import { parseHardenVerificationJson } from "./harden-verification-schema";

describe("parseHardenVerificationJson", () => {
  it("pass 판정과 의견을 파싱한다", () => {
    expect(parseHardenVerificationJson('{"verdict":"pass","comment":"의미가 보존되었습니다"}')).toEqual({
      ok: true,
      verdict: "pass",
      comment: "의미가 보존되었습니다",
    });
  });

  it("fail 판정과 의견을 파싱한다", () => {
    expect(parseHardenVerificationJson('{"verdict":"fail","comment":"정답 의미가 달라졌습니다"}')).toEqual({
      ok: true,
      verdict: "fail",
      comment: "정답 의미가 달라졌습니다",
    });
  });

  it("의견이 누락되면 실패한다", () => {
    expect(parseHardenVerificationJson('{"verdict":"pass"}')).toEqual({
      ok: false,
      fatal: "verdict와 comment가 필요합니다",
    });
  });

  it("잘못된 JSON이면 실패한다", () => {
    expect(parseHardenVerificationJson("not json")).toEqual({
      ok: false,
      fatal: "올바른 JSON이 아닙니다",
    });
  });
});
