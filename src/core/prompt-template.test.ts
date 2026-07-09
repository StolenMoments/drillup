import { describe, expect, it } from "vitest";
import {
  buildCliGenerationPrompt,
  buildCliVerifyPrompt,
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

const NO_EXISTING = { summaries: [], truncated: false };
const VERIFY_ITEMS = [
  {
    index: 0,
    question: {
      type: "mcq",
      question: "리눅스 커널을 만든 사람은?",
      choices: ["리누스 토르발스", "데니스 리치", "켄 톰프슨", "빌 게이츠"],
      answer_index: 0,
    },
  },
  { index: 2, question: { type: "cloze", text: "{{1}}는 OS다." } },
];
const REF_FILES = [
  "C:\\work\\drillup\\generation_reference\\aip-c01\\common\\00-exam-guide.md",
  "C:\\work\\drillup\\generation_reference\\aip-c01\\d1\\bedrock.md",
];

describe("buildCliGenerationPrompt", () => {
  it("주제명·추가 지시·결과 저장 경로를 포함한다", () => {
    const prompt = buildCliGenerationPrompt(
      "리눅스 기초",
      "쉬운 난이도로 5문제",
      "D:\\work\\drillup\\generation_output\\jobs\\1\\result.json",
      NO_EXISTING,
    );
    expect(prompt).toContain('"리눅스 기초"');
    expect(prompt).toContain("쉬운 난이도로 5문제");
    expect(prompt).toContain(
      "D:\\work\\drillup\\generation_output\\jobs\\1\\result.json",
    );
    expect(prompt).toContain("stdout에 출력하지 마세요");
  });

  it("추가 지시가 공백뿐이면 (없음)으로 표기한다", () => {
    const prompt = buildCliGenerationPrompt(
      "리눅스 기초",
      "   ",
      "D:\\r.json",
      NO_EXISTING,
    );
    expect(prompt).toContain("(없음)");
  });

  it("수동용 안내 문구를 포함하지 않는다", () => {
    const prompt = buildCliGenerationPrompt(
      "리눅스 기초",
      "",
      "D:\\r.json",
      NO_EXISTING,
    );
    expect(prompt).not.toContain(
      "여기에 범위, 난이도, 문제 수 같은 조건을 추가해 사용하세요",
    );
  });

  it("기존 문제가 없으면 배치 내 중복 금지 지시만 포함한다", () => {
    const prompt = buildCliGenerationPrompt(
      "리눅스 기초",
      "",
      "D:\\r.json",
      NO_EXISTING,
    );
    expect(prompt).toContain("이번에 생성하는 문제들끼리");
    expect(prompt).not.toContain("기존 문제 목록");
  });

  it("기존 문제가 있으면 목록과 중복 금지 지시를 포함한다", () => {
    const prompt = buildCliGenerationPrompt("리눅스 기초", "", "D:\\r.json", {
      summaries: ["리눅스 커널을 만든 사람은?", "리눅스는 1991년에 발표되었다."],
      truncated: false,
    });
    expect(prompt).toContain("기존 문제 목록");
    expect(prompt).toContain("- 리눅스 커널을 만든 사람은?");
    expect(prompt).toContain("- 리눅스는 1991년에 발표되었다.");
    expect(prompt).toContain("표현만 바꾼 문제");
    expect(prompt).not.toContain("이 외에도 기존 문제가 더 있습니다");
  });

  it("목록이 잘렸으면 더 있음을 명시한다", () => {
    const prompt = buildCliGenerationPrompt("리눅스 기초", "", "D:\\r.json", {
      summaries: ["요약1"],
      truncated: true,
    });
    expect(prompt).toContain("이 외에도 기존 문제가 더 있습니다");
  });
});

describe("buildCliVerifyPrompt", () => {
  it("주제명·판정 기준·출력 규격·저장 경로를 포함한다", () => {
    const prompt = buildCliVerifyPrompt("리눅스 기초", VERIFY_ITEMS, "D:\\v.json");
    expect(prompt).toContain('"리눅스 기초"');
    expect(prompt).toContain("정답 정확성");
    expect(prompt).toContain("answer_index");
    expect(prompt).toContain('"verdicts"');
    expect(prompt).toContain("D:\\v.json");
    expect(prompt).toContain("stdout에 출력하지 마세요");
  });

  it("각 문제를 index 번호와 JSON 내용으로 나열한다", () => {
    const prompt = buildCliVerifyPrompt("리눅스 기초", VERIFY_ITEMS, "D:\\v.json");
    expect(prompt).toContain("### 문제 0");
    expect(prompt).toContain("### 문제 2");
    expect(prompt).toContain("리눅스 커널을 만든 사람은?");
    expect(prompt).toContain("리누스 토르발스");
  });
});

describe("buildCliGenerationPrompt 참고 자료 섹션", () => {
  it("파일 목록과 근거 우선 지시를 포함한다", () => {
    const prompt = buildCliGenerationPrompt(
      "AIP-C01 D1",
      "",
      "D:\\r.json",
      NO_EXISTING,
      REF_FILES,
    );
    expect(prompt).toContain("## 참고 자료 (반드시 먼저 읽을 것)");
    expect(prompt).toContain(`- ${REF_FILES[0]}`);
    expect(prompt).toContain(`- ${REF_FILES[1]}`);
    expect(prompt).toContain("자료에 없는 내용을 기억이나 추측으로 출제하지 마세요");
    expect(prompt).toContain("자료와 당신의 기억이 다르면 자료를 우선하세요");
    expect(prompt).toContain("읽을 수 없는 파일이 있으면 그 파일은 무시하고");
  });

  it("파일이 없으면 섹션을 생략한다 (기본값 포함)", () => {
    const withEmpty = buildCliGenerationPrompt(
      "주제",
      "",
      "D:\\r.json",
      NO_EXISTING,
      [],
    );
    const withDefault = buildCliGenerationPrompt(
      "주제",
      "",
      "D:\\r.json",
      NO_EXISTING,
    );
    expect(withEmpty).not.toContain("## 참고 자료");
    expect(withDefault).not.toContain("## 참고 자료");
  });
});

describe("buildCliVerifyPrompt 참고 자료 섹션", () => {
  it("파일 목록과 근거 기반 판정 지시를 포함한다", () => {
    const prompt = buildCliVerifyPrompt(
      "AIP-C01 D1",
      VERIFY_ITEMS,
      "D:\\v.json",
      REF_FILES,
    );
    expect(prompt).toContain("## 참고 자료 (반드시 먼저 읽을 것)");
    expect(prompt).toContain(`- ${REF_FILES[0]}`);
    expect(prompt).toContain("판정하기 전에 아래 파일들을 모두 읽으세요");
    expect(prompt).toContain("자료와 당신의 기억이 다르면 자료를 우선하세요");
  });

  it("파일이 없으면 섹션을 생략한다", () => {
    const prompt = buildCliVerifyPrompt("주제", VERIFY_ITEMS, "D:\\v.json");
    expect(prompt).not.toContain("## 참고 자료");
  });
});
