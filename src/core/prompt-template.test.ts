import { describe, expect, it } from "vitest";
import {
  buildCliGenerationPrompt,
  buildGenerationPrompt,
} from "./prompt-template";

describe("buildGenerationPrompt (기존 수동용)", () => {
  it("주제명과 수동 사용 안내 문구를 포함한다", () => {
    const prompt = buildGenerationPrompt("리눅스 기초");
    expect(prompt).toContain('"리눅스 기초"');
    expect(prompt).toContain("여기에 범위, 난이도, 문제 수 같은 조건을 추가해 사용하세요");
    expect(prompt).toContain('"questions"');
  });
});

describe("buildCliGenerationPrompt", () => {
  it("주제명·추가 지시·결과 저장 경로를 포함한다", () => {
    const prompt = buildCliGenerationPrompt(
      "리눅스 기초",
      "쉬운 난이도로 5문제",
      "D:\\work\\drillup\\generation_output\\jobs\\1\\result.json",
    );
    expect(prompt).toContain('"리눅스 기초"');
    expect(prompt).toContain("쉬운 난이도로 5문제");
    expect(prompt).toContain(
      "D:\\work\\drillup\\generation_output\\jobs\\1\\result.json",
    );
    expect(prompt).toContain("stdout에 출력하지 마세요");
  });

  it("추가 지시가 공백뿐이면 (없음)으로 표기한다", () => {
    const prompt = buildCliGenerationPrompt("리눅스 기초", "   ", "D:\\r.json");
    expect(prompt).toContain("(없음)");
  });

  it("수동용 안내 문구를 포함하지 않는다", () => {
    const prompt = buildCliGenerationPrompt("리눅스 기초", "", "D:\\r.json");
    expect(prompt).not.toContain("여기에 범위, 난이도, 문제 수 같은 조건을 추가해 사용하세요");
  });
});
