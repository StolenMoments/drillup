import { describe, expect, it } from "vitest";
import {
  parseKeywordSuggestionJson,
  parseKeywordTagJson,
} from "./keyword-tag-schema";

describe("parseKeywordTagJson", () => {
  it("정상 JSON을 파싱한다", () => {
    const result = parseKeywordTagJson(
      JSON.stringify({
        assignments: [{ id: 3, keywords: ["TCP", " TCP ", "UDP"] }],
      }),
    );
    expect(result).toEqual({
      ok: true,
      assignments: [{ id: 3, keywords: ["TCP", "UDP"] }],
    });
  });

  it("JSON이 아니면 fatal을 반환한다", () => {
    expect(parseKeywordTagJson("not json")).toEqual({
      ok: false,
      fatal: "올바른 JSON이 아닙니다",
    });
  });

  it("assignments 배열이 없으면 fatal을 반환한다", () => {
    expect(parseKeywordTagJson("{}")).toEqual({
      ok: false,
      fatal: "최상위에 assignments 배열이 있어야 합니다",
    });
  });

  it("형식이 어긋난 항목은 건너뛴다", () => {
    const result = parseKeywordTagJson(
      JSON.stringify({
        assignments: [
          { id: "x", keywords: ["a"] },
          { id: 2, keywords: [] },
          { id: 3, keywords: ["ok"] },
        ],
      }),
    );
    expect(result).toEqual({
      ok: true,
      assignments: [{ id: 3, keywords: ["ok"] }],
    });
  });

  it("정규화 후 키워드가 모두 사라진 항목은 건너뛴다", () => {
    const result = parseKeywordTagJson(
      JSON.stringify({ assignments: [{ id: 1, keywords: ["   "] }] }),
    );
    expect(result).toEqual({ ok: true, assignments: [] });
  });
});

describe("parseKeywordSuggestionJson", () => {
  it("does not limit tag or suggestion keyword counts", () => {
    const keywords = ["1", "2", "3", "4", "5", "6", "7"];
    expect(parseKeywordSuggestionJson(JSON.stringify({ keywords }))).toEqual({ ok: true, keywords });
    expect(parseKeywordTagJson(JSON.stringify({ assignments: [{ id: 9, keywords }] }))).toEqual({
      ok: true,
      assignments: [{ id: 9, keywords }],
    });
  });

  it("rejects blank and overlong keywords", () => {
    expect(parseKeywordSuggestionJson(JSON.stringify({ keywords: ["  "] })).ok).toBe(false);
    expect(parseKeywordSuggestionJson(JSON.stringify({ keywords: ["a".repeat(51)] })).ok).toBe(false);
  });
  it("최대 5개의 키워드를 정규화해 파싱한다", () => {
    expect(
      parseKeywordSuggestionJson(
        JSON.stringify({ keywords: ["TCP", " TCP ", "UDP"] }),
      ),
    ).toEqual({ ok: true, keywords: ["TCP", "UDP"] });
  });

  it("accepts six keywords", () => {
    expect(
      parseKeywordSuggestionJson(
        JSON.stringify({ keywords: ["1", "2", "3", "4", "5", "6"] }),
      ),
    ).toEqual({ ok: true, keywords: ["1", "2", "3", "4", "5", "6"] });
  });

  it("형식이 잘못되면 오류를 반환한다", () => {
    expect(parseKeywordSuggestionJson("not json")).toEqual({
      ok: false,
      fatal: "올바른 JSON이 아닙니다",
    });
  });
});
