import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  question: { findUnique: vi.fn() },
  factualReviewJob: {
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("./db", () => ({ prisma: prismaMock }));

import {
  getFactualReviewJob,
  startFactualReviewJob,
} from "./factual-review-job-service";

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    questionId: 7,
    engine: "CLAUDE" as const,
    concern: "정답이 틀렸습니다",
    status: "RUNNING" as const,
    verdict: null,
    comment: null,
    evidenceUrl: null,
    payload: null,
    errorMessage: null,
    createdAt: new Date("2026-07-15T00:00:00.000Z"),
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

describe("factual review job service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.factualReviewJob.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.question.findUnique.mockResolvedValue({
      id: 7,
      type: "MCQ",
      payload: {},
    });
  });

  describe("startFactualReviewJob", () => {
    it("문제가 없으면 NOT_FOUND를 던진다", async () => {
      prismaMock.question.findUnique.mockResolvedValue(null);

      await expect(
        startFactualReviewJob(7, "CLAUDE", "정답이 틀렸습니다"),
      ).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
      expect(prismaMock.factualReviewJob.create).not.toHaveBeenCalled();
    });

    it("MCQ가 아니면 VALIDATION 오류를 던진다", async () => {
      prismaMock.question.findUnique.mockResolvedValue({
        id: 7,
        type: "CLOZE",
        payload: {},
      });

      await expect(
        startFactualReviewJob(7, "CLAUDE", "정답이 틀렸습니다"),
      ).rejects.toMatchObject({
        code: "VALIDATION",
        status: 400,
        message: "MCQ 문제만 사실 확인을 요청할 수 있습니다",
      });
      expect(prismaMock.factualReviewJob.create).not.toHaveBeenCalled();
    });

    it("항상 새 job을 생성한다", async () => {
      prismaMock.factualReviewJob.create.mockResolvedValue(job());

      const result = await startFactualReviewJob(7, "CLAUDE", "정답이 틀렸습니다");

      expect(result).toMatchObject({ id: 11, status: "RUNNING", result: null });
      expect(prismaMock.factualReviewJob.create).toHaveBeenCalledWith({
        data: { questionId: 7, engine: "CLAUDE", concern: "정답이 틀렸습니다" },
      });
    });
  });

  describe("getFactualReviewJob", () => {
    it("job이 없으면 NOT_FOUND를 던진다", async () => {
      prismaMock.factualReviewJob.findUnique.mockResolvedValue(null);

      await expect(getFactualReviewJob(7, 11)).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
      });
    });

    it("questionId가 다르면 NOT_FOUND를 던진다", async () => {
      prismaMock.factualReviewJob.findUnique.mockResolvedValue(
        job({ questionId: 99 }),
      );

      await expect(getFactualReviewJob(7, 11)).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
      });
    });

    it("RUNNING job은 result 없이 그대로 반환한다", async () => {
      prismaMock.factualReviewJob.findUnique.mockResolvedValue(job());

      const result = await getFactualReviewJob(7, 11);

      expect(result).toMatchObject({ status: "RUNNING", result: null });
    });

    it("SUCCEEDED job은 저장된 verdict/comment/payload를 result로 반환한다", async () => {
      prismaMock.factualReviewJob.findUnique.mockResolvedValue(
        job({
          status: "SUCCEEDED",
          verdict: "confirmed",
          comment: "이의가 타당합니다",
          evidenceUrl: "https://docs.aws.amazon.com/x",
          payload: {
            question: "교정된 질문",
            choices: ["a", "b", "c", "d"],
            answer_indices: [0],
            choice_explanations: ["1", "2", "3", "4"],
          },
          finishedAt: new Date("2026-07-15T00:05:00.000Z"),
        }),
      );

      const result = await getFactualReviewJob(7, 11);

      expect(result).toMatchObject({
        status: "SUCCEEDED",
        result: {
          verdict: "confirmed",
          comment: "이의가 타당합니다",
          evidenceUrl: "https://docs.aws.amazon.com/x",
          payload: { question: "교정된 질문" },
        },
      });
    });

    it("FAILED job은 errorMessage와 함께 result 없이 반환한다", async () => {
      prismaMock.factualReviewJob.findUnique.mockResolvedValue(
        job({ status: "FAILED", errorMessage: "엔진 실행 실패" }),
      );

      const result = await getFactualReviewJob(7, 11);

      expect(result).toMatchObject({
        status: "FAILED",
        result: null,
        errorMessage: "엔진 실행 실패",
      });
    });

    it("오래된 RUNNING job은 조회 전에 stale FAILED 상태로 정리한다", async () => {
      const previousTimeout = process.env.GENERATION_TIMEOUT_MS;
      process.env.GENERATION_TIMEOUT_MS = "1000";
      try {
        prismaMock.factualReviewJob.findUnique.mockResolvedValue(
          job({ startedAt: new Date(Date.now() - 63_000) }),
        );

        await getFactualReviewJob(7, 11);

        expect(prismaMock.factualReviewJob.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            where: expect.objectContaining({ status: "RUNNING", OR: expect.any(Array) }),
            data: expect.objectContaining({ status: "FAILED" }),
          }),
        );
      } finally {
        if (previousTimeout === undefined) delete process.env.GENERATION_TIMEOUT_MS;
        else process.env.GENERATION_TIMEOUT_MS = previousTimeout;
      }
    });
  });
});
