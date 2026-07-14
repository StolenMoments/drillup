import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  question: { findUnique: vi.fn() },
}));
const runEngineMock = vi.hoisted(() => vi.fn());

vi.mock("./db", () => ({ prisma: prismaMock }));
vi.mock("./generation/run-engine", () => ({ runEngine: runEngineMock }));

import { hardenQuestionChoices } from "./choice-hardening-service";

const original = {
  question: "원본 질문은 무엇인가요?",
  choices: ["원본 정답", "원본 오답 1", "원본 오답 2", "원본 오답 3"],
  answer_indices: [0],
  choice_explanations: ["근거 1", "근거 2", "근거 3", "근거 4"],
};
const generated = {
  comment: "문제와 정답을 바꾸고 오답도 보강했습니다",
  revised: {
    question: "변형 질문은 무엇인가요?",
    choices: ["변형 정답", "변형 오답 1", "원본 오답 2", "원본 오답 3"],
    answer_indices: [0],
    choice_explanations: ["새 근거 1", "새 근거 2", "근거 3", "근거 4"],
  },
};

function engineResult(resultText: string) {
  return {
    ok: true,
    resultText,
    stdoutTail: "",
    stderrTail: "",
    exitCode: 0,
    timedOut: false,
    durationMs: 10,
  };
}

describe("hardenQuestionChoices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.question.findUnique.mockResolvedValue({
      id: 7,
      type: "MCQ",
      payload: original,
      topic: { name: "주제" },
    });
  });

  it("생성 후 별도 검증을 실행하고 통과한 DTO를 반환한다", async () => {
    runEngineMock
      .mockResolvedValueOnce(engineResult(JSON.stringify(generated)))
      .mockResolvedValueOnce(engineResult(JSON.stringify({ verdict: "pass", comment: "의미가 보존되었습니다" })));

    await expect(hardenQuestionChoices(7, "CLAUDE", "CODEX")).resolves.toMatchObject({
      engine: "CLAUDE",
      verifyEngine: "CODEX",
      comment: generated.comment,
      verificationComment: "의미가 보존되었습니다",
      payload: generated.revised,
    });
    expect(runEngineMock).toHaveBeenCalledTimes(2);
    expect(runEngineMock).toHaveBeenNthCalledWith(
      1,
      "CLAUDE",
      expect.stringContaining("generate-result.json"),
      expect.any(String),
      "generate-",
    );
    expect(runEngineMock).toHaveBeenNthCalledWith(
      2,
      "CODEX",
      expect.stringContaining("verify-result.json"),
      expect.any(String),
      "verify-",
    );
  });

  it("검증 fail이면 HARDEN_VERIFY_REJECTED로 미리보기를 거부한다", async () => {
    runEngineMock
      .mockResolvedValueOnce(engineResult(JSON.stringify(generated)))
      .mockResolvedValueOnce(engineResult(JSON.stringify({ verdict: "fail", comment: "정답 의미가 달라졌습니다" })));

    await expect(hardenQuestionChoices(7, "CLAUDE", "CODEX")).rejects.toMatchObject({
      code: "HARDEN_VERIFY_REJECTED",
      status: 422,
      message: expect.stringContaining("정답 의미가 달라졌습니다"),
    });
  });
});
