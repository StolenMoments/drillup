import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  question: { findUnique: vi.fn() },
}));
const runEngineMock = vi.hoisted(() => vi.fn());

vi.mock("./db", () => ({ prisma: prismaMock }));
vi.mock("./generation/run-engine", () => ({ runEngine: runEngineMock }));

import { reviewFactualConcern } from "./factual-review-service";

const original = {
  question: "원본 질문은 무엇인가요?",
  choices: ["원본 정답", "원본 오답 1", "원본 오답 2", "원본 오답 3"],
  answer_indices: [0],
  choice_explanations: ["근거 1", "근거 2", "근거 3", "근거 4"],
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

describe("reviewFactualConcern", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.question.findUnique.mockResolvedValue({
      id: 7,
      type: "MCQ",
      payload: original,
      topic: { name: "주제" },
    });
  });

  it("문제를 찾을 수 없으면 NOT_FOUND를 던진다", async () => {
    prismaMock.question.findUnique.mockResolvedValue(null);
    await expect(
      reviewFactualConcern(7, "CLAUDE", "정답이 틀렸습니다"),
    ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(runEngineMock).not.toHaveBeenCalled();
  });

  it("MCQ가 아니면 VALIDATION 오류를 던진다", async () => {
    prismaMock.question.findUnique.mockResolvedValue({
      id: 7,
      type: "CLOZE",
      payload: { text: "t", blanks: [], distractors: [] },
      topic: { name: "주제" },
    });
    await expect(
      reviewFactualConcern(7, "CLAUDE", "정답이 틀렸습니다"),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      status: 400,
      message: "MCQ 문제만 사실 확인을 요청할 수 있습니다",
    });
    expect(runEngineMock).not.toHaveBeenCalled();
  });

  it("rejected 판정이면 payload 없이 DTO를 반환한다", async () => {
    runEngineMock.mockResolvedValueOnce(
      engineResult(
        JSON.stringify({ verdict: "rejected", comment: "문제에 이상이 없습니다" }),
      ),
    );

    await expect(
      reviewFactualConcern(7, "CLAUDE", "정답이 틀렸다는 주장"),
    ).resolves.toEqual({
      engine: "CLAUDE",
      verdict: "rejected",
      comment: "문제에 이상이 없습니다",
      evidenceUrl: null,
      payload: null,
    });
    expect(runEngineMock).toHaveBeenCalledTimes(1);
    expect(runEngineMock).toHaveBeenNthCalledWith(
      1,
      "CLAUDE",
      expect.any(String),
      expect.any(String),
    );
  });

  it("confirmed 판정이면 교정된 payload를 포함한 DTO를 반환한다", async () => {
    const revised = {
      question: "교정된 질문",
      choices: ["교정된 정답", "원본 오답 1", "원본 오답 2", "원본 오답 3"],
      answer_indices: [0],
      choice_explanations: ["새 근거 1", "근거 2", "근거 3", "근거 4"],
    };
    runEngineMock.mockResolvedValueOnce(
      engineResult(
        JSON.stringify({
          verdict: "confirmed",
          comment: "이의가 타당합니다",
          evidence_url: "https://docs.aws.amazon.com/x",
          revised,
        }),
      ),
    );

    await expect(
      reviewFactualConcern(7, "CODEX", "정답이 틀렸다는 주장"),
    ).resolves.toEqual({
      engine: "CODEX",
      verdict: "confirmed",
      comment: "이의가 타당합니다",
      evidenceUrl: "https://docs.aws.amazon.com/x",
      payload: revised,
    });
  });

  it("엔진 실행이 실패하면 FACT_REVIEW_FAILED를 던진다", async () => {
    runEngineMock.mockResolvedValueOnce({
      ok: false,
      failureReason: "엔진 실행 파일을 찾을 수 없습니다",
      stdoutTail: "",
      stderrTail: "",
      exitCode: 1,
      timedOut: false,
      durationMs: 10,
    });

    await expect(
      reviewFactualConcern(7, "CLAUDE", "정답이 틀렸다는 주장"),
    ).rejects.toMatchObject({
      code: "FACT_REVIEW_FAILED",
      status: 502,
      message: "엔진 실행 파일을 찾을 수 없습니다",
    });
  });

  it("결과 파싱이 실패하면 FACT_REVIEW_PARSE_ERROR를 던진다", async () => {
    runEngineMock.mockResolvedValueOnce(engineResult("not json"));

    await expect(
      reviewFactualConcern(7, "CLAUDE", "정답이 틀렸다는 주장"),
    ).rejects.toMatchObject({
      code: "FACT_REVIEW_PARSE_ERROR",
      status: 502,
      message: "올바른 JSON이 아닙니다",
    });
  });
});
