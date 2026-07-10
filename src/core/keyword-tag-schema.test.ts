import { describe, expect, it } from "vitest";
import { parseKeywordTagJson } from "./keyword-tag-schema";

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
