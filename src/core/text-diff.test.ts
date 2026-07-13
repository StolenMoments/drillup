import { describe, expect, it } from "vitest";
import { diffText } from "./text-diff";

describe("diffText", () => {
  it("returns one equal part for identical text", () => {
    expect(diffText("같은 문장", "같은 문장")).toEqual([
      { type: "equal", text: "같은 문장" },
    ]);
  });

  it("preserves inserted words and whitespace", () => {
    expect(diffText("원본 문장", "원본 새 문장")).toEqual([
      { type: "equal", text: "원본 " },
      { type: "insert", text: "새 " },
      { type: "equal", text: "문장" },
    ]);
  });

  it("marks deleted words while keeping surrounding whitespace", () => {
    expect(diffText("원본 오래된 문장", "원본 문장")).toEqual([
      { type: "equal", text: "원본 " },
      { type: "delete", text: "오래된 " },
      { type: "equal", text: "문장" },
    ]);
  });

  it("represents a replacement as a deletion and an insertion", () => {
    expect(diffText("정답은 하나입니다", "정답은 둘입니다")).toEqual([
      { type: "equal", text: "정답은 " },
      { type: "delete", text: "하나입니다" },
      { type: "insert", text: "둘입니다" },
    ]);
  });

  it("keeps repeated spaces as meaningful tokens", () => {
    expect(diffText("두 단어", "두  단어")).toEqual([
      { type: "equal", text: "두 " },
      { type: "insert", text: " " },
      { type: "equal", text: "단어" },
    ]);
  });

  it("handles Korean text with an empty original", () => {
    expect(diffText("", "새 한국어")).toEqual([
      { type: "insert", text: "새 한국어" },
    ]);
  });

  it("handles an empty revision", () => {
    expect(diffText("삭제할 내용", "")).toEqual([
      { type: "delete", text: "삭제할 내용" },
    ]);
  });
});
