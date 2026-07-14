import { describe, expect, it } from "vitest";
import {
  buildAnswerExplanationPrompt,
  buildChoiceHardeningPrompt,
  buildChoiceHardeningVerificationPrompt,
  buildCliGenerationFromBlueprintPrompt,
  buildCliGenerationPrompt,
  buildCliQuestionBlueprintPrompt,
  buildCliQuestionBlueprintRepairPrompt,
  buildCliItemRepairPrompt,
  buildCliKeywordTagPrompt,
  buildCliRevisionPrompt,
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

const NO_EXISTING = { distinctions: [], truncated: false };
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

  it("기존 distinction이 없으면 배치 내 중복 금지 지시만 포함한다", () => {
    const prompt = buildCliGenerationPrompt("리눅스 기초", "", "D:\\r.json", NO_EXISTING);
    expect(prompt).toContain("이번에 생성하는 문제들끼리");
    expect(prompt).not.toContain("기존 출제 개념 목록");
  });

  it("기존 distinction이 있으면 목록과 중복 금지 지시를 포함한다", () => {
    const prompt = buildCliGenerationPrompt("리눅스 기초", "", "D:\\r.json", {
      distinctions: ["커널 모듈 로딩 방식 구분", "패키지 매니저 잠금 파일 역할 구분"],
      truncated: false,
    });
    expect(prompt).toContain("기존 출제 개념 목록");
    expect(prompt).toContain("- 커널 모듈 로딩 방식 구분");
    expect(prompt).toContain("- 패키지 매니저 잠금 파일 역할 구분");
    expect(prompt).toContain("표현을 바꿔도");
    expect(prompt).not.toContain("이 외에도 기존 출제 개념이 더 있습니다");
  });

  it("목록이 잘렸으면 더 있음을 명시한다", () => {
    const prompt = buildCliGenerationPrompt("리눅스 기초", "", "D:\\r.json", {
      distinctions: ["개념1"],
      truncated: true,
    });
    expect(prompt).toContain("이 외에도 기존 출제 개념이 더 있습니다");
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

  it("문제 JSON을 개행·들여쓰기 없는 compact 직렬화로 삽입한다 (토큰 절약)", () => {
    const prompt = buildCliVerifyPrompt("리눅스 기초", VERIFY_ITEMS, "D:\\v.json");
    expect(prompt).toContain(JSON.stringify(VERIFY_ITEMS[0].question));
    expect(prompt).not.toContain(JSON.stringify(VERIFY_ITEMS[0].question, null, 2));
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
    expect(prompt).toContain("자료에 없는 범위를 기억이나 추측으로 출제하지 마세요");
    expect(prompt).toContain("사실 우선순위: 최신 공식 웹 문서 > 참고 자료 > 당신의 기억");
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
    expect(prompt).toContain("사실 우선순위: 최신 공식 웹 문서 > 참고 자료 > 당신의 기억");
  });

  it("파일이 없으면 섹션을 생략한다", () => {
    const prompt = buildCliVerifyPrompt("주제", VERIFY_ITEMS, "D:\\v.json");
    expect(prompt).not.toContain("## 참고 자료");
  });
});

describe("키워드/변형 확장", () => {
  const existing = { distinctions: [], truncated: false };

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
    expect(generation).toContain("Avoid giveaway wording");
    expect(verification).toContain("at least two distractors are close-but-wrong");
    expect(verification).toContain("avoid giveaway narrow or absolute wording");
  });
});

describe("buildKeywordSuggestionPrompt", () => {
  it("does not instruct a keyword-count limit", () => {
    const prompt = buildKeywordSuggestionPrompt("topic", { type: "MCQ", payload: { question: "q" }, explanation: null }, [], [], "C:/result.json");
    expect(prompt).toContain("짧고 직접 관련되고 중복되지 않아야");
    expect(prompt).not.toContain("5개 이하");
    expect(prompt).not.toContain("1~3개");
  });

  it("enforces the requested answer and choice counts", () => {
    const shape = { correctAnswerCount: 2 as const, choiceCount: 4 as const };
    const verification = buildCliVerifyPrompt("topic", VERIFY_ITEMS, "C:/verify.json", [], shape);
    const generation = buildCliGenerationFromBlueprintPrompt("topic", [], "C:/result.json", [], shape);

    expect(verification).toContain("exactly 2 unique in-range values");
    expect(verification).toContain("exactly 4 choices");
    expect(generation).toContain("exactly 2 correct choices");
    expect(generation).toContain("exactly 4 choices");
  });
  it("문제·기존 키워드·이미 부여된 키워드·무제한 규칙을 포함한다", () => {
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
    expect(prompt).toContain("짧고 직접 관련되고 중복되지 않아야");
    expect(prompt).not.toContain("5개 이하");
    expect(prompt).toContain('"keywords"');
    expect(prompt).toContain("D:\\suggestions\\result.json");
  });
});

describe("buildCliQuestionBlueprintPrompt", () => {
  it("uses null misconceptions for correct choices and requires them for distractors", () => {
    const prompt = buildCliQuestionBlueprintPrompt("topic", "", "C:/result.json", NO_EXISTING);
    expect(prompt).toContain('"misconception": null');
    expect(prompt).toContain("Every distractor must have a nonblank misconception");
  });

  it("requires the selected answer and choice counts", () => {
    const prompt = buildCliQuestionBlueprintPrompt(
      "topic",
      "",
      "C:/result.json",
      NO_EXISTING,
      [],
      [],
      [],
      { correctAnswerCount: 2, choiceCount: 4 },
    );
    expect(prompt).toContain("exactly 2 correct choices");
    expect(prompt).toContain("exactly 4 choices");
    expect(prompt).toContain('"2개를 선택하세요"');
  });

  it("난이도 게이트의 제약 분류 규칙을 기계적으로 설명한다", () => {
    const prompt = buildCliQuestionBlueprintPrompt("topic", "", "C:/result.json", NO_EXISTING);
    expect(prompt).toContain("every constraint id must appear in exactly one of satisfiedConstraintIds or violatedConstraintIds");
    expect(prompt).toContain("violates exactly one constraint and lists every other constraint id as satisfied");
  });

  it("블루프린트 프롬프트에 기존 출제 개념 목록을 포함한다", () => {
    const prompt = buildCliQuestionBlueprintPrompt("t", "", "D:\\b.json", {
      distinctions: ["관리형 대 자체 운영 구분"],
      truncated: false,
    });
    expect(prompt).toContain("기존 출제 개념 목록");
    expect(prompt).toContain("- 관리형 대 자체 운영 구분");
  });
});

describe("buildCliQuestionBlueprintRepairPrompt", () => {
  const blueprint = {
    id: "b1",
    domainTask: "task",
    testedDistinction: "distinction",
    referenceFacts: [{ id: "f1", statement: "fact", sourceFile: "ref.md" }],
    constraints: [{ id: "c1", statement: "constraint", kind: "FUNCTIONAL" as const, factIds: ["f1"] }],
    choices: [
      {
        id: "a",
        solution: "solution",
        serviceNames: ["svc"],
        satisfiedConstraintIds: ["c1"],
        violatedConstraintIds: [],
        misconception: null,
        correct: true as const,
      },
    ],
    reasoningSteps: ["step one", "step two"],
  };

  it("위반 상세와 난이도 게이트 규칙을 포함한다", () => {
    const violations = "b1: CLOSE_DISTRACTOR_COUNT At least two close distractors are required.";
    const prompt = buildCliQuestionBlueprintRepairPrompt([blueprint], violations, "C:/repair.json");
    expect(prompt).toContain(violations);
    expect(prompt).toContain("every constraint id must appear in exactly one of satisfiedConstraintIds or violatedConstraintIds");
    expect(prompt).toContain("violates exactly one constraint and lists every other constraint id as satisfied");
    expect(prompt).toContain("At least two close distractors");
  });

  it("blueprint 목록을 compact 직렬화로 삽입한다 (토큰 절약)", () => {
    const violations = "b1: CLOSE_DISTRACTOR_COUNT At least two close distractors are required.";
    const prompt = buildCliQuestionBlueprintRepairPrompt([blueprint], violations, "C:/repair.json");
    expect(prompt).toContain(JSON.stringify([blueprint]));
    expect(prompt).not.toContain(JSON.stringify([blueprint], null, 2));
  });
});

describe("buildCliGenerationFromBlueprintPrompt", () => {
  const blueprint = {
    id: "b1",
    domainTask: "task",
    testedDistinction: "distinction",
    referenceFacts: [{ id: "f1", statement: "fact", sourceFile: "ref.md" }],
    constraints: [{ id: "c1", statement: "constraint", kind: "FUNCTIONAL" as const, factIds: ["f1"] }],
    choices: [
      {
        id: "a",
        solution: "solution",
        serviceNames: ["svc"],
        satisfiedConstraintIds: ["c1"],
        violatedConstraintIds: [],
        misconception: null,
        correct: true as const,
      },
    ],
    reasoningSteps: ["step one", "step two"],
  };

  it("blueprint 목록을 compact 직렬화로 삽입한다 (토큰 절약)", () => {
    const prompt = buildCliGenerationFromBlueprintPrompt("topic", [blueprint], "C:/result.json");
    expect(prompt).toContain(JSON.stringify([blueprint]));
    expect(prompt).not.toContain(JSON.stringify([blueprint], null, 2));
  });
});

describe("buildCliItemRepairPrompt", () => {
  const blueprint = {
    id: "b1",
    domainTask: "deploy securely",
    testedDistinction: "managed versus self-managed",
    referenceFacts: [{ id: "f1", statement: "fact statement", sourceFile: "ref.md" }],
    constraints: [{ id: "c1", statement: "security constraint", kind: "SECURITY" as const, factIds: ["f1"] }],
    choices: [
      {
        id: "a",
        solution: "managed service",
        serviceNames: ["Managed Service"],
        satisfiedConstraintIds: ["c1"],
        violatedConstraintIds: [],
        misconception: null,
        correct: true as const,
      },
    ],
    reasoningSteps: ["compare solutions"],
  };
  const failureReason = "verdict=fail: 고유한 자동 수선 실패 사유";
  const referenceFiles = ["C:/reference/a.md"];
  const shape = { correctAnswerCount: 1 as const, choiceCount: 4 as const };

  it("실패 사유·블루프린트·참고 자료·shape와 완전한 수정 지시를 포함한다", () => {
    const prompt = buildCliItemRepairPrompt(
      "AWS 보안",
      blueprint,
      failureReason,
      "C:/repair/result.json",
      referenceFiles,
      shape,
    );

    expect(prompt).toContain(failureReason);
    expect(prompt).toContain(JSON.stringify(blueprint));
    expect(prompt).not.toContain(JSON.stringify(blueprint, null, 2));
    expect(prompt).toContain("C:/reference/a.md");
    expect(prompt).toContain("정확히 4개");
    expect(prompt).toContain("정확히 1개");
    expect(prompt).toContain("완전한 가져오기 문제 형식");
    expect(prompt).toContain('"revised_question"');
    expect(prompt).toContain("C:/repair/result.json");
  });

  it("대상 문제의 원문 JSON이나 고유 문자열을 포함하지 않는다", () => {
    const originalQuestion = {
      type: "mcq",
      question: "이 문자열은 자동 수선 프롬프트에 들어가면 안 됩니다",
      choices: ["A", "B", "C", "D"],
      answer_indices: [0],
    };
    const prompt = buildCliItemRepairPrompt(
      "AWS 보안",
      blueprint,
      failureReason,
      "C:/repair/result.json",
    );

    expect(prompt).not.toContain(JSON.stringify(originalQuestion));
    expect(prompt).not.toContain(originalQuestion.question);
  });

  it("대표 fixture에서 기존 full-question revision 프롬프트보다 짧다", () => {
    const originalQuestion = {
      type: "mcq",
      question: "대상 문제의 긴 질문 텍스트입니다. " + "세부 조건과 문맥을 반복합니다. ".repeat(8),
      choices: ["정답", "가까운 오답 1", "가까운 오답 2", "가까운 오답 3"],
      answer_indices: [0],
      choice_explanations: ["근거", "근거", "근거", "근거"],
      explanation: "기존 문제 해설",
    };
    const oldPrompt = buildCliRevisionPrompt(
      "AWS 보안",
      originalQuestion,
      failureReason,
      "C:/repair/result.json",
      referenceFiles,
      blueprint,
      shape,
    );
    const newPrompt = buildCliItemRepairPrompt(
      "AWS 보안",
      blueprint,
      failureReason,
      "C:/repair/result.json",
      referenceFiles,
      shape,
    );

    expect(newPrompt.length).toBeLessThan(oldPrompt.length);
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
    expect(prompt).toContain('"choice_explanations"');
    expect(prompt).toContain('"aws_reference"');
    expect(prompt).toContain("https://docs.aws.amazon.com/");
    expect(prompt).toContain("모든 보기를 한 번씩만");
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
    expect(prompt).not.toContain('"choice_explanations"');
    expect(prompt).toContain("D:\\explain\\2-codex\\result.json");
  });
});

describe("해설 프롬프트 factual_concern", () => {
  it("정답 이의 제기 지시와 출력 필드를 포함한다", () => {
    const prompt = buildAnswerExplanationPrompt(
      "MCQ",
      { question: "Q", choices: ["a", "b"], answer_index: 0 },
      "C:/out/result.json",
    );
    expect(prompt).toContain("factual_concern");
    expect(prompt).toContain("정답 표기 자체가");
  });
});

describe("사실 우선순위 지시", () => {
  const sampleBlueprint = {
    id: "b1",
    domainTask: "task",
    testedDistinction: "distinction",
    referenceFacts: [{ id: "f1", statement: "fact", sourceFile: "d1/a.md" }],
    constraints: [{ id: "c1", statement: "constraint", kind: "FUNCTIONAL" as const, factIds: ["f1"] }],
    choices: [{ id: "a", solution: "solution", serviceNames: ["svc"], satisfiedConstraintIds: ["c1"], violatedConstraintIds: [], misconception: "reason", correct: true }],
    reasoningSteps: ["step"],
  };

  it("referenceSection이 공식 문서 우선순위를 명시하고 자료 우선 지시를 제거한다", () => {
    const prompt = buildCliVerifyPrompt("주제", [{ index: 0, question: {} }], "C:/out/result.json", ["C:/ref/a.md"]);
    expect(prompt).toContain("사실 우선순위: 최신 공식 웹 문서 > 참고 자료 > 당신의 기억");
    expect(prompt).toContain("공식 웹 문서로 확인");
    expect(prompt).not.toContain("자료와 당신의 기억이 다르면 자료를 우선하세요");
  });

  it("verify 프롬프트에서 사실 정확성이 블루프린트보다 우선한다", () => {
    const prompt = buildCliVerifyPrompt("주제", [{ index: 0, question: {}, blueprint: sampleBlueprint }], "C:/out/result.json");
    expect(prompt).toContain("factual accuracy overrides the blueprint");
    expect(prompt).not.toContain("are immutable");
  });

  it("revision 프롬프트가 사실 오류 수정을 허용한다", () => {
    const prompt = buildCliRevisionPrompt("주제", { type: "mcq" }, "지시", "C:/out/result.json", [], sampleBlueprint);
    expect(prompt).not.toContain("unchanged");
    expect(prompt).toContain("correct factual errors");
  });

  it("기존 full-question revision 프롬프트는 대상 문제를 계속 포함한다", () => {
    const question = {
      type: "mcq",
      question: "수동 수정 대상 문제의 고유 문자열",
      choices: ["A", "B", "C", "D"],
      answer_indices: [0],
    };
    const prompt = buildCliRevisionPrompt("주제", question, "수동 수정", "C:/out/result.json");
    expect(prompt).toContain(JSON.stringify(question));
    expect(prompt).toContain(question.question);
  });

  it("revision 프롬프트가 원본 검증 의견을 포함한다", () => {
    const withComment = buildCliRevisionPrompt("주제", { type: "mcq" }, "지시", "C:/out/result.json", [], undefined, undefined, "원본 검증 의견 텍스트");
    expect(withComment).toContain("## 원본 검증 의견");
    expect(withComment).toContain("원본 검증 의견 텍스트");

    const withoutComment = buildCliRevisionPrompt("주제", { type: "mcq" }, "지시", "C:/out/result.json");
    expect(withoutComment).toContain("## 원본 검증 의견");
    expect(withoutComment).toContain("(없음)");
  });
});

describe("buildChoiceHardeningPrompt", () => {
  const payload = {
    question: "S3 버킷 보호 방법은?",
    choices: ["정답 선지", "쉬운 오답 1", "쉬운 오답 2", "쉬운 오답 3"],
    answer_indices: [0],
  };

  it("보수적 패러프레이즈 조건과 원본 문제를 포함한다", () => {
    const prompt = buildChoiceHardeningPrompt(
      "AWS SAA",
      payload,
      "C:\\out\\result.json",
    );
    expect(prompt).toContain("보수적으로 패러프레이즈");
    expect(prompt).toContain("숫자");
    expect(prompt).toContain("고유명사");
    expect(prompt).toContain("모든 정답 선지");
    expect(prompt).toContain("S3 버킷 보호 방법은?");
    expect(prompt).toContain("정답 선지");
    expect(prompt).toContain("오답 선지 중 최소 1개");
    expect(prompt).toContain("C:\\out\\result.json");
  });

  it("레거시 answer_index를 answer_indices로 정규화해 보여준다", () => {
    const prompt = buildChoiceHardeningPrompt(
      "AWS SAA",
      { question: "q?", choices: ["a", "b", "c", "d"], answer_index: 2 },
      "/tmp/result.json",
    );
    expect(prompt).toContain('"answer_indices":[2]');
  });

  it("시험 스타일 오답 규칙을 재사용한다", () => {
    const prompt = buildChoiceHardeningPrompt("AWS SAA", payload, "/tmp/r.json");
    expect(prompt).toContain("Mandatory exam-style MCQ contract");
  });

  it("오답 선지는 내용 교체를 허용하고, 사실 추가 금지 규칙은 본문·정답 선지에만 적용됨을 명시한다", () => {
    const prompt = buildChoiceHardeningPrompt("AWS SAA", payload, "/tmp/r.json");
    expect(prompt).toContain("표현만 다듬는 것이 아니라 내용을 교체");
    expect(prompt).toContain("새로운 그럴듯한 서비스명");
    expect(prompt).toContain("명백한 오답");
    expect(prompt).toContain("본문과 정답 선지에만 적용");
  });
});

describe("buildChoiceHardeningVerificationPrompt", () => {
  it("원본·변형 데이터와 의미 보존 검증 규칙 및 결과 경로를 포함한다", () => {
    const prompt = buildChoiceHardeningVerificationPrompt(
      "AWS SAA",
      { question: "원본 질문", choices: ["원본 정답", "원본 오답 1", "원본 오답 2", "원본 오답 3"], answer_indices: [0] },
      { question: "바뀐 질문", choices: ["바뀐 정답", "바뀐 오답 1", "원본 오답 2", "원본 오답 3"], answer_indices: [0], choice_explanations: ["1", "2", "3", "4"] },
      "C:\\out\\verify-result.json",
    );
    expect(prompt).toContain("의미 보존");
    expect(prompt).toContain("원본 질문");
    expect(prompt).toContain("바뀐 질문");
    expect(prompt).toContain("숫자");
    expect(prompt).toContain('"verdict": "pass"');
    expect(prompt).toContain("C:\\out\\verify-result.json");
  });

  it("오답 선지는 변형 폭을 판정하지 않고, 오답 fail 조건이 두 가지로 한정됨을 명시한다", () => {
    const prompt = buildChoiceHardeningVerificationPrompt(
      "AWS SAA",
      { question: "원본 질문", choices: ["원본 정답", "원본 오답 1", "원본 오답 2", "원본 오답 3"], answer_indices: [0] },
      { question: "바뀐 질문", choices: ["바뀐 정답", "바뀐 오답 1", "원본 오답 2", "원본 오답 3"], answer_indices: [0], choice_explanations: ["1", "2", "3", "4"] },
      "C:\\out\\verify-result.json",
    );
    expect(prompt).toContain("변형의 폭이나 원본과의 차이는 판정 대상이 아닙니다");
    expect(prompt).toContain("사실상 정답이 되는 경우");
    expect(prompt).toContain("정답 선지와 의미가 겹쳐 답이 모호해지는 경우");
  });
});

describe("선지 강화 프롬프트 factual_concern", () => {
  it("이의 제기 지시와 출력 필드를 포함한다", () => {
    const prompt = buildChoiceHardeningPrompt(
      "주제",
      { question: "Q", choices: ["a", "b", "c", "d"], answer_index: 0 },
      "C:/out/result.json",
    );
    expect(prompt).toContain("factual_concern");
  });
});
