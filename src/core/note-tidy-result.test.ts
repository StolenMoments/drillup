import { describe, expect, it } from "vitest";
import { parseNoteTidyResult } from "./note-tidy-result";

describe("parseNoteTidyResult", () => {
  it("정상 결과에서 note를 추출한다", () => {
    const raw = JSON.stringify({ note: "## Bedrock\n- 핵심 정리" });
    expect(parseNoteTidyResult(raw)).toEqual({
      ok: true,
      note: "## Bedrock\n- 핵심 정리",
    });
  });

  it("note 앞뒤 공백을 잘라낸다", () => {
    const raw = JSON.stringify({ note: "\n\n내용\n" });
    expect(parseNoteTidyResult(raw)).toEqual({ ok: true, note: "내용" });
  });

  it("JSON이 아니면 실패한다", () => {
    expect(parseNoteTidyResult("not json")).toEqual({
      ok: false,
      fatal: "올바른 JSON이 아닙니다",
    });
  });

  it("note 필드가 없으면 실패한다", () => {
    expect(parseNoteTidyResult(JSON.stringify({ text: "x" }))).toEqual({
      ok: false,
      fatal: "note 필드가 필요합니다",
    });
  });

  it("note가 빈 문자열이면 실패한다", () => {
    expect(parseNoteTidyResult(JSON.stringify({ note: "  " }))).toEqual({
      ok: false,
      fatal: "정리된 노트가 비어 있습니다",
    });
  });
});
