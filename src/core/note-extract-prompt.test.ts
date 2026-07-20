import { describe, expect, it } from "vitest";
import type { ClozePayload, McqPayload } from "./types";
import { buildNoteExtractPrompt } from "./note-extract-prompt";

const mcq: McqPayload = {
  question: "정적 웹사이트를 가장 저렴하게 호스팅하는 방법은?",
  choices: ["S3 정적 웹사이트 호스팅", "EC2 t3.micro", "Lightsail", "ECS Fargate"],
  answer_indices: [0],
};

const cloze: ClozePayload = {
  text: "___1___은 객체 스토리지이고 ___2___는 블록 스토리지다.",
  blanks: [
    { id: 1, answer: "S3" },
    { id: 2, answer: "EBS" },
  ],
  distractors: ["EFS", "Glacier"],
};

describe("buildNoteExtractPrompt - MCQ", () => {
  const prompt = buildNoteExtractPrompt(
    "MCQ",
    mcq,
    "S3는 정적 콘텐츠를 서버 없이 제공한다.",
    "## 스토리지\n- EBS: 블록 스토리지",
    "D:/out/result.json",
  );

  it("문항과 보기를 포함한다", () => {
    expect(prompt).toContain("정적 웹사이트를 가장 저렴하게 호스팅하는 방법은?");
    expect(prompt).toContain("S3 정적 웹사이트 호스팅");
    expect(prompt).toContain("ECS Fargate");
  });

  it("정답을 보기 텍스트로 표기한다", () => {
    expect(prompt).toContain('정답: "S3 정적 웹사이트 호스팅"');
  });

  it("해설을 포함한다", () => {
    expect(prompt).toContain("S3는 정적 콘텐츠를 서버 없이 제공한다.");
  });

  it("기존 노트를 포함하고 중복 제외를 지시한다", () => {
    expect(prompt).toContain("- EBS: 블록 스토리지");
    expect(prompt).toContain("이미 있는 내용은 절대 다시 추출하지 마세요");
  });

  it("새 포인트가 없으면 빈 문자열을 반환하도록 지시한다", () => {
    expect(prompt).toContain('"note": ""');
  });

  it("출력 형식과 결과 저장 경로를 지시한다", () => {
    expect(prompt).toContain('"note"');
    expect(prompt).toContain("D:/out/result.json");
    expect(prompt).toContain("stdout에 출력하지 마세요");
  });
});

describe("buildNoteExtractPrompt - CLOZE", () => {
  const prompt = buildNoteExtractPrompt(
    "CLOZE",
    cloze,
    null,
    "",
    "D:/out/result.json",
  );

  it("본문과 빈칸 정답을 포함한다", () => {
    expect(prompt).toContain("___1___은 객체 스토리지이고");
    expect(prompt).toContain("1번 = S3");
    expect(prompt).toContain("2번 = EBS");
  });

  it("해설이 없으면 없음으로 표기한다", () => {
    expect(prompt).toContain("(해설 없음)");
  });

  it("기존 노트가 비어 있으면 비어 있음을 표기한다", () => {
    expect(prompt).toContain("(아직 노트가 비어 있습니다)");
  });
});
