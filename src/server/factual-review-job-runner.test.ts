import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  factualReviewJob: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
}));
const runEngineMock = vi.hoisted(() => vi.fn());

vi.mock("./db", () => ({ prisma: prismaMock }));
vi.mock("./generation/run-engine", () => ({ runEngine: runEngineMock }));

import { runFactualReviewJob } from "./factual-review-job-runner";

const original = {
  question: "원본 질문은 무엇인가요?",
  choices: ["원본 정답", "원본 오답 1", "원본 오답 2", "원본 오답 3"],
  answer_indices: [0],
  choice_explanations: ["근거 1", "근거 2", "근거 3", "근거 4"],
};

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    questionId: 7,
    engine: "CLAUDE" as const,
    concern: "정답이 틀렸다는 주장",
    kind: "FACTUAL_CONCERN" as const,
    sourcePolicy: "OFFICIAL_DOCS" as const,
    status: "RUNNING" as const,
    verdict: null,
    comment: null,
    evidenceUrl: null,
    payload: null,
    errorMessage: null,
    createdAt: new Date("2026-07-15T00:00:00.000Z"),
    startedAt: new Date("2026-07-15T00:00:00.000Z"),
    finishedAt: null,
    question: { id: 7, type: "MCQ", payload: original, explanation: "원본 해설", topic: { name: "주제" } },
    ...overrides,
  };
}

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

describe("factual review job runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runEngineMock.mockReset();
    prismaMock.factualReviewJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.factualReviewJob.findUnique.mockResolvedValue(job());
  });

  it("rejected 판정이면 verdict/comment만 저장한다", async () => {
    runEngineMock.mockResolvedValueOnce(
      engineResult(
        JSON.stringify({ verdict: "rejected", comment: "문제에 이상이 없습니다" }),
      ),
    );

    await runFactualReviewJob(11);

    expect(runEngineMock).toHaveBeenCalledTimes(1);
    expect(runEngineMock).toHaveBeenNthCalledWith(
      1,
      "CLAUDE",
      expect.any(String),
      expect.any(String),
    );
    expect(prismaMock.factualReviewJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: 11, startedAt: expect.any(Date), status: "RUNNING" },
      data: {
        status: "SUCCEEDED",
        verdict: "rejected",
        comment: "문제에 이상이 없습니다",
        evidenceUrl: null,
        payload: undefined,
        finishedAt: expect.any(Date),
      },
    });
  });

  it("confirmed 판정이면 교정된 payload도 함께 저장한다", async () => {
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

    await runFactualReviewJob(11);

    expect(prismaMock.factualReviewJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: 11, startedAt: expect.any(Date), status: "RUNNING" },
      data: {
        status: "SUCCEEDED",
        verdict: "confirmed",
        comment: "이의가 타당합니다",
        evidenceUrl: "https://docs.aws.amazon.com/x",
        payload: revised,
        finishedAt: expect.any(Date),
      },
    });
  });

  it("엔진 실행이 실패하면 FAILED로 저장한다", async () => {
    runEngineMock.mockResolvedValueOnce({
      ok: false,
      failureReason: "엔진 실행 파일을 찾을 수 없습니다",
      stdoutTail: "",
      stderrTail: "",
      exitCode: 1,
      timedOut: false,
      durationMs: 10,
    });

    await runFactualReviewJob(11);

    expect(prismaMock.factualReviewJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: 11, startedAt: expect.any(Date), status: "RUNNING" },
      data: {
        status: "FAILED",
        errorMessage: "엔진 실행 파일을 찾을 수 없습니다",
        finishedAt: expect.any(Date),
      },
    });
  });

  it("결과 파싱이 실패하면 FAILED로 저장한다", async () => {
    runEngineMock.mockResolvedValueOnce(engineResult("not json"));

    await runFactualReviewJob(11);

    expect(prismaMock.factualReviewJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: 11, startedAt: expect.any(Date), status: "RUNNING" },
      data: {
        status: "FAILED",
        errorMessage: "올바른 JSON이 아닙니다",
        finishedAt: expect.any(Date),
      },
    });
  });

  it("이미 claim된 job은 엔진을 실행하지 않고 스킵한다", async () => {
    prismaMock.factualReviewJob.updateMany.mockResolvedValueOnce({ count: 0 });

    await runFactualReviewJob(11);

    expect(runEngineMock).not.toHaveBeenCalled();
    expect(prismaMock.factualReviewJob.findUnique).not.toHaveBeenCalled();
  });

  it("claim 후 상태가 RUNNING이 아니면 실행하지 않는다", async () => {
    prismaMock.factualReviewJob.findUnique.mockResolvedValue(
      job({ status: "SUCCEEDED" }),
    );

    await runFactualReviewJob(11);

    expect(runEngineMock).not.toHaveBeenCalled();
  });

  it("최신 정보 검증은 AWS Docs 정책 프롬프트와 fail 교정안을 저장한다", async () => {
    const revised = { ...original, question: "교정된 질문" };
    prismaMock.factualReviewJob.findUnique.mockResolvedValue(job({
      kind: "FRESHNESS",
      sourcePolicy: "AWS_DOCS_ONLY",
      concern: "",
    }));
    runEngineMock.mockResolvedValueOnce(engineResult(JSON.stringify({
      verdict: "fail",
      comment: "문서 기준으로 변경되었습니다",
      evidence_url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/x.html",
      revised,
    })));

    await runFactualReviewJob(11);

    expect(runEngineMock).toHaveBeenCalledWith(
      "CLAUDE",
      expect.stringContaining("https://docs.aws.amazon.com/ 로 시작하는 AWS 공식 문서만 허용"),
      expect.stringContaining("freshness-review"),
    );
    expect(prismaMock.factualReviewJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: 11, startedAt: expect.any(Date), status: "RUNNING" },
      data: {
        status: "SUCCEEDED",
        verdict: "fail",
        comment: "문서 기준으로 변경되었습니다",
        evidenceUrl: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/x.html",
        payload: revised,
        finishedAt: expect.any(Date),
      },
    });
  });
});
