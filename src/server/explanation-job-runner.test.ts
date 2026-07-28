import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  answerExplanationJob: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
}));
const generateAndCacheExplanationMock = vi.hoisted(() => vi.fn());

vi.mock("./db", () => ({ prisma: prismaMock }));
vi.mock("./explanation-service", () => ({
  generateAndCacheExplanation: generateAndCacheExplanationMock,
}));

import { ServiceError } from "./errors";
import { runAnswerExplanationJob } from "./explanation-job-runner";

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    questionId: 7,
    engine: "CLAUDE" as const,
    status: "RUNNING" as const,
    errorMessage: null,
    createdAt: new Date("2026-07-15T00:00:00.000Z"),
    startedAt: new Date("2026-07-15T00:00:00.000Z"),
    finishedAt: null,
    ...overrides,
  };
}

describe("answer explanation job runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    generateAndCacheExplanationMock.mockReset();
    prismaMock.answerExplanationJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.answerExplanationJob.findUnique.mockResolvedValue(job());
  });

  it("정상 성공 경로는 SUCCEEDED로 전이한다", async () => {
    generateAndCacheExplanationMock.mockResolvedValue({
      content: "해설",
      choiceExplanations: null,
      factualConcern: null,
    });

    await runAnswerExplanationJob(11);

    expect(generateAndCacheExplanationMock).toHaveBeenCalledWith(7, "CLAUDE");
    expect(prismaMock.answerExplanationJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: 11, startedAt: expect.any(Date), status: "RUNNING" },
      data: { status: "SUCCEEDED", finishedAt: expect.any(Date) },
    });
  });

  it("실패 경로는 FAILED와 errorMessage를 기록한다", async () => {
    generateAndCacheExplanationMock.mockRejectedValue(
      new ServiceError("EXPLANATION_FAILED", "CLI 실행 실패", 502),
    );

    await runAnswerExplanationJob(11);

    expect(prismaMock.answerExplanationJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: 11, startedAt: expect.any(Date), status: "RUNNING" },
      data: {
        status: "FAILED",
        errorMessage: "CLI 실행 실패",
        finishedAt: expect.any(Date),
      },
    });
  });

  it("일반 Error도 FAILED와 메시지를 기록한다", async () => {
    generateAndCacheExplanationMock.mockRejectedValue(new Error("DB 연결 끊김"));

    await runAnswerExplanationJob(11);

    expect(prismaMock.answerExplanationJob.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: "DB 연결 끊김",
        }),
      }),
    );
  });

  it("알 수 없는 오류는 기본 메시지를 기록한다", async () => {
    generateAndCacheExplanationMock.mockRejectedValue("문자열 오류");

    await runAnswerExplanationJob(11);

    expect(prismaMock.answerExplanationJob.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: "해설 생성 중 알 수 없는 오류가 발생했습니다",
        }),
      }),
    );
  });

  it("이미 claim된 job은 CLI를 실행하지 않고 스킵한다", async () => {
    prismaMock.answerExplanationJob.updateMany.mockResolvedValueOnce({ count: 0 });

    await runAnswerExplanationJob(11);

    expect(generateAndCacheExplanationMock).not.toHaveBeenCalled();
    expect(prismaMock.answerExplanationJob.findUnique).not.toHaveBeenCalled();
  });

  it("claim 후 상태가 RUNNING이 아니면 실행하지 않는다", async () => {
    prismaMock.answerExplanationJob.findUnique.mockResolvedValue(
      job({ status: "SUCCEEDED" }),
    );

    await runAnswerExplanationJob(11);

    expect(generateAndCacheExplanationMock).not.toHaveBeenCalled();
  });
});
