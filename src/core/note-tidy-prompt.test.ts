import { describe, expect, it } from "vitest";
import { buildNoteTidyPrompt } from "./note-tidy-prompt";

describe("buildNoteTidyPrompt", () => {
  const prompt = buildNoteTidyPrompt(
    "## Bedrock\n- Converse API: 모델 교체 쉬움",
    "D:/out/result.json",
  );

  it("노트 원문을 포함한다", () => {
    expect(prompt).toContain("- Converse API: 모델 교체 쉬움");
  });

  it("결과 저장 경로를 포함한다", () => {
    expect(prompt).toContain("D:/out/result.json");
  });

  it("핵심 정리 규칙을 포함한다", () => {
    expect(prompt).toContain("새로운 사실을 추가하지 마세요");
    expect(prompt).toContain("중복");
  });

  it("출력 형식으로 note 필드 JSON을 지시한다", () => {
    expect(prompt).toContain('"note"');
  });
});
