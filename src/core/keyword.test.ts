import { describe, expect, it } from "vitest";
import {
  dedupeKeywordNames,
  KEYWORD_MAX_LENGTH,
  normalizeKeywordName,
} from "./keyword";

describe("normalizeKeywordName", () => {
  it("양끝 공백을 제거한다", () => {
    expect(normalizeKeywordName("  TCP  ")).toBe("TCP");
  });

  it("연속 공백을 하나로 줄인다", () => {
    expect(normalizeKeywordName("서브넷   마스크")).toBe("서브넷 마스크");
  });

  it("탭/개행도 공백 하나로 정규화한다", () => {
    expect(normalizeKeywordName("서브넷\t\n마스크")).toBe("서브넷 마스크");
  });
});

describe("dedupeKeywordNames", () => {
  it("정규화 후 같은 이름은 하나만 남긴다", () => {
    expect(dedupeKeywordNames(["TCP", " TCP ", "UDP"])).toEqual(["TCP", "UDP"]);
  });

  it("빈 문자열과 공백만 있는 항목은 제외한다", () => {
    expect(dedupeKeywordNames(["", "   ", "TCP"])).toEqual(["TCP"]);
  });

  it("최대 길이를 넘는 이름은 제외한다", () => {
    expect(dedupeKeywordNames(["a".repeat(KEYWORD_MAX_LENGTH + 1)])).toEqual([]);
  });

  it("입력 순서를 유지한다", () => {
    expect(dedupeKeywordNames(["b", "a", "b"])).toEqual(["b", "a"]);
  });
});
