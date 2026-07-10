import { describe, expect, it } from "vitest";
import {
  buildAnswerExplanationPrompt,
  buildCliGenerationPrompt,
  buildCliKeywordTagPrompt,
  buildCliVerifyPrompt,
  buildGenerationPrompt,
  buildKeywordSuggestionPrompt,
} from "./prompt-template";

describe("buildGenerationPrompt (기존 수동용)", () => {
  it("주제명과 수동 사용 안내 문구를 포함한다", () => {
    const prompt = buildGenerationPrompt("리눅스 기초");
    expect(prompt).toContain('"리눅스 기초"');
    expect(prompt).toContain("여기에 범위, 난이도, 문제 수 같은 조건을 추가해 사용하세요");
    expect(prompt).toContain('"questions"');
    expect(prompt).toContain("choices는 4~6개");
    expect(prompt).toContain("## 웹 검색 기반 사실 확인");
    expect(prompt).toContain("공식 문서, 벤더 문서, 표준 문서 같은 1차 출처");
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
    expect(prompt).toContain("## 웹 검색 기반 사실 확인");
    expect(prompt).toContain("WebSearch/WebFetch/브라우징 도구");
    expect(prompt).toContain("최신 공식 웹 문서를 우선하세요");
    expect(prompt).toContain("별도 출처 필드를 추가하지 마세요");
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
    expect(prompt).toContain("## 웹 검색 기반 사실 확인");
    expect(prompt).toContain("판정하기 전에 사용 가능한 WebSearch/WebFetch/브라우징 도구");
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

describe("키워드/변형 확장", () => {
  const existing = { summaries: [], truncated: false };

  it("출력 형식 예시에 keywords 필드가 포함된다", () => {
    const prompt = buildCliGenerationPrompt("주제", "", "/tmp/r.json", existing);
    expect(prompt).toContain('"keywords"');
  });

  it("existingKeywords가 있으면 키워드 규칙 섹션과 목록이 포함된다", () => {
    const prompt = buildCliGenerationPrompt(
      "주제", "", "/tmp/r.json", existing, [], ["TCP", "UDP"],
    );
    expect(prompt).toContain("## 키워드 규칙");
    expect(prompt).toContain("- TCP");
    expect(prompt).toContain("- UDP");
  });

  it("existingKeywords가 비어 있으면 키워드 규칙 섹션이 없다", () => {
    const prompt = buildCliGenerationPrompt("주제", "", "/tmp/r.json", existing);
    expect(prompt).not.toContain("## 키워드 규칙");
  });

  it("variantSources가 있으면 변형 출제 섹션에 원본 JSON이 포함된다", () => {
    const prompt = buildCliGenerationPrompt(
      "주제", "", "/tmp/r.json", existing, [], [],
      [{ question: '{"type":"mcq","question":"원본Q"}' }],
    );
    expect(prompt).toContain("## 변형 출제 (원본 문제)");
    expect(prompt).toContain("원본Q");
    expect(prompt).toContain("표현만 바꾼 문제는 금지");
  });

  it("buildCliKeywordTagPrompt가 문제 목록·기존 키워드·저장 경로를 포함한다", () => {
    const prompt = buildCliKeywordTagPrompt(
      "네트워크",
      [{ id: 7, summary: "TCP 연결 수립 절차는?" }],
      ["TCP"],
      "/tmp/result.json",
    );
    expect(prompt).toContain("(id=7)");
    expect(prompt).toContain("TCP 연결 수립 절차는?");
    expect(prompt).toContain("## 키워드 규칙");
    expect(prompt).toContain('"assignments"');
    expect(prompt).toContain("/tmp/result.json");
    expect(prompt).toContain("stdout에 출력하지 마세요");
  });
});

describe("exam distractor requirements", () => {
  it("requires and verifies at least two close-but-wrong distractors", () => {
    const generation = buildCliGenerationPrompt("topic", "", "D:\\r.json", NO_EXISTING);
    const verification = buildCliVerifyPrompt("topic", VERIFY_ITEMS, "D:\\v.json");
    expect(generation).toContain("at least two distractors");
    expect(generation).toContain("realistic misconceptions");
    expect(verification).toContain("at least two distractors are close-but-wrong");
  });
});

describe("buildKeywordSuggestionPrompt", () => {
  it("문제·기존 키워드·이미 부여된 키워드·최대 5개 규칙을 포함한다", () => {
    const prompt = buildKeywordSuggestionPrompt(
      "네트워크",
      {
        type: "MCQ",
        payload: {
          question: "TCP 연결 수립 절차는?",
          choices: ["3-way handshake", "ARP", "DNS", "NAT"],
          answer_index: 0,
        },
        explanation: "TCP의 연결 수립 절차다.",
      },
      ["TCP", "UDP"],
      ["TCP"],
      "D:\\suggestions\\result.json",
    );

    expect(prompt).toContain("TCP 연결 수립 절차는?");
    expect(prompt).toContain("3-way handshake");
    expect(prompt).toContain("## 기존 키워드 목록");
    expect(prompt).toContain("## 이미 부여된 키워드");
    expect(prompt).toContain("위 키워드는 결과에 다시 넣지 마세요");
    expect(prompt).toContain("5개 이하");
    expect(prompt).toContain('"keywords"');
    expect(prompt).toContain("D:\\suggestions\\result.json");
  });
});

describe("buildAnswerExplanationPrompt", () => {
  it("MCQ: 질문·보기·정답 표시·저장 경로를 포함한다", () => {
    const prompt = buildAnswerExplanationPrompt(
      "MCQ",
      {
        question: "리눅스 커널을 만든 사람은?",
        choices: ["리누스 토르발스", "데니스 리치", "켄 톰프슨", "빌 게이츠"],
        answer_index: 0,
      },
      "D:\\explain\\1-claude\\result.json",
    );
    expect(prompt).toContain("리눅스 커널을 만든 사람은?");
    expect(prompt).toContain("- 리누스 토르발스");
    expect(prompt).toContain("- 데니스 리치");
    expect(prompt).toContain('정답: "리누스 토르발스"');
    expect(prompt).toContain("각 오답 보기가 왜 틀렸는지");
    expect(prompt).toContain("보기 텍스트를 그대로 인용");
    expect(prompt).toContain("번호나 순서");
    expect(prompt).not.toContain("1. 리누스 토르발스");
    expect(prompt).not.toContain("(정답)");
    expect(prompt).toContain("D:\\explain\\1-claude\\result.json");
    expect(prompt).toContain("stdout에 출력하지 마세요");
    expect(prompt).toContain('"explanation"');
  });

  it("CLOZE: 본문·정답·distractors·저장 경로를 포함한다", () => {
    const prompt = buildAnswerExplanationPrompt(
      "CLOZE",
      {
        text: "{{1}}는 OS다.",
        blanks: [{ id: 1, answer: "리눅스" }],
        distractors: ["윈도우", "맥OS"],
      },
      "D:\\explain\\2-codex\\result.json",
    );
    expect(prompt).toContain("{{1}}는 OS다.");
    expect(prompt).toContain("1번 = 리눅스");
    expect(prompt).toContain("윈도우, 맥OS");
    expect(prompt).toContain("각 오답 후보(distractor)가 왜 그 빈칸에 맞지 않는지");
    expect(prompt).not.toContain("번호나 순서");
    expect(prompt).toContain("D:\\explain\\2-codex\\result.json");
  });
});
