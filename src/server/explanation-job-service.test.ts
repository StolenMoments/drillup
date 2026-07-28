import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  question: { findUnique: vi.fn() },
  answerExplanation: { findUnique: vi.fn() },
  answerExplanationJob: {
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
}));

vi.mock("./db", () => ({ prisma: prismaMock }));

import {
  getAnswerExplanationJob,
  startAnswerExplanationJob,
} from "./explanation-job-service";

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    questionId: 7,
    engine: "CLAUDE" as const,
    status: "RUNNING" as const,
    errorMessage: null,
    createdAt: new Date("2026-07-15T00:00:00.000Z"),
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

function cache(overrides: Record<string, unknown> = {}) {
  return {
    id: 3,
    questionId: 7,
    engine: "CLAUDE" as const,
    content: "해설 내용",
    choiceExplanations: null,
    factualConcern: null,
    createdAt: new Date("2026-07-15T00:05:00.000Z"),
    ...overrides,
  };
}

describe("answer explanation job service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.answerExplanationJob.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.question.findUnique.mockResolvedValue({
      id: 7,
      type: "MCQ",
      payload: {},
    });
    prismaMock.answerExplanation.findUnique.mockResolvedValue(null);
    prismaMock.answerExplanationJob.findUnique.mockResolvedValue(null);
  });

  describe("startAnswerExplanationJob", () => {
    it("캐시가 있으면 job을 생성하지 않고 SUCCEEDED를 즉시 반환한다", async () => {
      prismaMock.answerExplanation.findUnique.mockResolvedValue(cache());

      const result = await startAnswerExplanationJob(7, "CLAUDE");

      expect(result).toMatchObject({
        questionId: 7,
        engine: "CLAUDE",
        status: "SUCCEEDED",
        result: {
          content: "해설 내용",
          choiceExplanations: null,
          factualConcern: null,
        },
      });
      expect(prismaMock.answerExplanationJob.create).not.toHaveBeenCalled();
    });

    it("문제가 없으면 NOT_FOUND를 던진다", async () => {
      prismaMock.question.findUnique.mockResolvedValue(null);

      await expect(startAnswerExplanationJob(7, "CLAUDE")).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
      });
    });

    it("캐시가 없으면 새 job을 생성한다", async () => {
      prismaMock.answerExplanationJob.create.mockResolvedValue(job());

      const result = await startAnswerExplanationJob(7, "CLAUDE");

      expect(result).toMatchObject({ id: 11, status: "RUNNING", result: null });
      expect(prismaMock.answerExplanationJob.create).toHaveBeenCalledWith({
        data: { questionId: 7, engine: "CLAUDE" },
      });
    });

    it("이미 RUNNING인 job은 그대로 재사용한다", async () => {
      prismaMock.answerExplanationJob.findUnique.mockResolvedValue(job());

      const result = await startAnswerExplanationJob(7, "CLAUDE");

      expect(result).toMatchObject({ id: 11, status: "RUNNING" });
      expect(prismaMock.answerExplanationJob.create).not.toHaveBeenCalled();
    });

    it("FAILED job은 재시도를 위해 RUNNING으로 리셋한다", async () => {
      const failed = job({ status: "FAILED", errorMessage: "실패" });
      const reset = job({ status: "RUNNING" });
      prismaMock.answerExplanationJob.findUnique
        .mockResolvedValueOnce(failed)
        .mockResolvedValueOnce(reset);
      prismaMock.answerExplanationJob.updateMany.mockResolvedValue({ count: 1 });

      const result = await startAnswerExplanationJob(7, "CLAUDE");

      expect(result).toMatchObject({ id: 11, status: "RUNNING" });
      expect(prismaMock.answerExplanationJob.updateMany).toHaveBeenCalledWith({
        where: { id: 11, status: "FAILED" },
        data: {
          status: "RUNNING",
          errorMessage: null,
          startedAt: null,
          finishedAt: null,
        },
      });
    });

    it("SUCCEEDED job인데 캐시가 삭제되어 있으면 재생성을 위해 RUNNING으로 리셋한다", async () => {
      // choice-hardening apply 등으로 AnswerExplanation 캐시만 삭제되고
      // AnswerExplanationJob은 SUCCEEDED로 남아있는 상황을 재현한다.
      const succeededStale = job({
        status: "SUCCEEDED",
        finishedAt: new Date("2026-07-15T00:05:00.000Z"),
      });
      const reset = job({ status: "RUNNING" });
      prismaMock.answerExplanation.findUnique.mockResolvedValue(null);
      prismaMock.answerExplanationJob.findUnique
        .mockResolvedValueOnce(succeededStale)
        .mockResolvedValueOnce(reset);
      prismaMock.answerExplanationJob.updateMany.mockResolvedValue({ count: 1 });

      const result = await startAnswerExplanationJob(7, "CLAUDE");

      expect(result).toMatchObject({ id: 11, status: "RUNNING", result: null });
      expect(prismaMock.answerExplanationJob.updateMany).toHaveBeenCalledWith({
        where: { id: 11, status: "SUCCEEDED" },
        data: {
          status: "RUNNING",
          errorMessage: null,
          startedAt: null,
          finishedAt: null,
        },
      });
    });
  });

  describe("getAnswerExplanationJob", () => {
    it("job이 없으면 NOT_FOUND를 던진다", async () => {
      prismaMock.answerExplanationJob.findUnique.mockResolvedValue(null);

      await expect(getAnswerExplanationJob(7, 11)).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
      });
    });

    it("questionId가 다르면 NOT_FOUND를 던진다", async () => {
      prismaMock.answerExplanationJob.findUnique.mockResolvedValue(
        job({ questionId: 99 }),
      );

      await expect(getAnswerExplanationJob(7, 11)).rejects.toMatchObject({
        code: "NOT_FOUND",
        status: 404,
      });
    });

    it("SUCCEEDED job은 캐시를 조인해 result를 채운다", async () => {
      prismaMock.answerExplanationJob.findUnique.mockResolvedValue(
        job({ status: "SUCCEEDED", finishedAt: new Date("2026-07-15T00:05:00.000Z") }),
      );
      prismaMock.answerExplanation.findUnique.mockResolvedValue(cache());

      const result = await getAnswerExplanationJob(7, 11);

      expect(result).toMatchObject({
        status: "SUCCEEDED",
        result: { content: "해설 내용" },
      });
    });

    it("SUCCEEDED인데 캐시가 없으면 INTERNAL 오류를 던진다", async () => {
      prismaMock.answerExplanationJob.findUnique.mockResolvedValue(
        job({ status: "SUCCEEDED" }),
      );
      prismaMock.answerExplanation.findUnique.mockResolvedValue(null);

      await expect(getAnswerExplanationJob(7, 11)).rejects.toMatchObject({
        code: "INTERNAL",
        status: 500,
      });
    });

    it("RUNNING job은 result 없이 그대로 반환한다", async () => {
      prismaMock.answerExplanationJob.findUnique.mockResolvedValue(job());

      const result = await getAnswerExplanationJob(7, 11);

      expect(result).toMatchObject({ status: "RUNNING", result: null });
    });

    it("오래된 RUNNING job은 조회 전에 stale FAILED 상태로 정리한다", async () => {
      const previousTimeout = process.env.GENERATION_TIMEOUT_MS;
      process.env.GENERATION_TIMEOUT_MS = "1000";
      try {
        prismaMock.answerExplanationJob.findUnique.mockResolvedValue(
          job({ startedAt: new Date(Date.now() - 63_000) }),
        );

        await getAnswerExplanationJob(7, 11);

        expect(prismaMock.answerExplanationJob.updateMany).toHaveBeenCalledWith(
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
