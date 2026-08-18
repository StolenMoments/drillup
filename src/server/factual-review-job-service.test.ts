import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  question: { findUnique: vi.fn() },
  factualReviewJob: {
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

const txMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  question: { findUnique: vi.fn() },
  factualReviewJob: {
    findFirst: vi.fn(),
    create: vi.fn(),
  },
}));

vi.mock("./db", () => ({ prisma: prismaMock }));

import {
  getFactualReviewJob,
  getFreshnessReviewJob,
  startFactualReviewJob,
  startFreshnessReviewJob,
} from "./factual-review-job-service";

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    questionId: 7,
    engine: "CLAUDE" as const,
    concern: "정답이 틀렸습니다",
    kind: "FACTUAL_CONCERN" as const,
    sourcePolicy: "OFFICIAL_DOCS" as const,
    sourceHash: null,
    sourceSnapshot: null,
    attempt: 1,
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
      topic: { verificationSourcePolicy: "OFFICIAL_DOCS" },
    });
    txMock.$queryRaw.mockResolvedValue([]);
    txMock.question.findUnique.mockResolvedValue({
      id: 7,
      type: "MCQ",
      payload: {
        question: "원본 질문",
        choices: ["정답", "오답 1", "오답 2", "오답 3"],
        answer_indices: [0],
        choice_explanations: ["근거 1", "근거 2", "근거 3", "근거 4"],
      },
      explanation: "전체 해설",
      topic: {
        name: "AWS",
        verificationSourcePolicy: "OFFICIAL_DOCS",
      },
    });
    txMock.factualReviewJob.findFirst.mockResolvedValue(null);
    prismaMock.$transaction.mockImplementation(
      async (callback: (client: typeof txMock) => Promise<unknown>) => callback(txMock),
    );
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
        data: { questionId: 7, engine: "CLAUDE", concern: "정답이 틀렸습니다", kind: "FACTUAL_CONCERN", sourcePolicy: "OFFICIAL_DOCS" },
      });
    });
  });

  describe("startFreshnessReviewJob", () => {
    it("MCQ의 주제 출처 정책을 snapshot으로 저장한다", async () => {
      txMock.question.findUnique.mockResolvedValue({
        id: 7,
        type: "MCQ",
        payload: {
          question: "원본 질문",
          choices: ["정답", "오답 1", "오답 2", "오답 3"],
          answer_indices: [0],
          choice_explanations: ["근거 1", "근거 2", "근거 3", "근거 4"],
        },
        explanation: "전체 해설",
        topic: { name: "AWS", verificationSourcePolicy: "AWS_DOCS_ONLY" },
      });
      txMock.factualReviewJob.create.mockResolvedValue(job({
        kind: "FRESHNESS",
        sourcePolicy: "AWS_DOCS_ONLY",
        sourceHash: "a".repeat(64),
        sourceSnapshot: {},
        concern: "",
      }));

      const result = await startFreshnessReviewJob(7, "CODEX");

      expect(txMock.factualReviewJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          questionId: 7,
          engine: "CODEX",
          concern: "",
          kind: "FRESHNESS",
          sourcePolicy: "AWS_DOCS_ONLY",
          sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/),
          sourceSnapshot: expect.objectContaining({
            cacheVersion: 1,
            explanation: "전체 해설",
            topicName: "AWS",
            sourcePolicy: "AWS_DOCS_ONLY",
          }),
          attempt: 1,
        }),
      });
      expect(result).toMatchObject({
        job: { sourcePolicy: "AWS_DOCS_ONLY", status: "RUNNING" },
        reused: false,
        shouldRun: true,
      });
    });

    it("CLOZE는 최신 정보 검증을 거절한다", async () => {
      txMock.question.findUnique.mockResolvedValue({ id: 7, type: "CLOZE", topic: { name: "주제", verificationSourcePolicy: "OFFICIAL_DOCS" } });
      await expect(startFreshnessReviewJob(7, "CLAUDE")).rejects.toMatchObject({ code: "VALIDATION", status: 400 });
    });

    it("같은 입력과 엔진의 진행 중 job을 재사용한다", async () => {
      txMock.factualReviewJob.findFirst.mockResolvedValueOnce(
        job({ kind: "FRESHNESS", sourceHash: "a".repeat(64), concern: "" }),
      );

      await expect(startFreshnessReviewJob(7, "CLAUDE")).resolves.toMatchObject({
        job: { id: 11, status: "RUNNING" },
        reused: true,
        shouldRun: false,
      });
      expect(txMock.factualReviewJob.create).not.toHaveBeenCalled();
      const lockSql = Array.from(
        txMock.$queryRaw.mock.calls[0][0] as TemplateStringsArray,
      ).join(" ");
      expect(lockSql).toContain("FROM question");
      expect(lockSql).toContain("FOR UPDATE");
    });

    it("같은 입력과 엔진의 성공 결과를 재사용한다", async () => {
      txMock.factualReviewJob.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(job({
          kind: "FRESHNESS",
          sourceHash: "a".repeat(64),
          concern: "",
          status: "SUCCEEDED",
          verdict: "pass",
          comment: "최신입니다",
          finishedAt: new Date("2026-08-18T00:00:00.000Z"),
        }));

      await expect(startFreshnessReviewJob(7, "CLAUDE")).resolves.toMatchObject({
        job: { id: 11, status: "SUCCEEDED", result: { verdict: "pass" } },
        reused: true,
        shouldRun: false,
      });
      expect(txMock.factualReviewJob.create).not.toHaveBeenCalled();
    });

    it("실패한 attempt만 있으면 다음 attempt를 새로 만든다", async () => {
      txMock.factualReviewJob.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ attempt: 2 });
      txMock.factualReviewJob.create.mockResolvedValue(job({
        id: 12,
        kind: "FRESHNESS",
        sourceHash: "a".repeat(64),
        concern: "",
        attempt: 3,
      }));

      await expect(startFreshnessReviewJob(7, "CLAUDE")).resolves.toMatchObject({
        job: { id: 12, status: "RUNNING" },
        reused: false,
        shouldRun: true,
      });
      expect(txMock.factualReviewJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ attempt: 3 }),
      });
    });

    it("force는 성공 결과를 보존하고 새 attempt를 만든다", async () => {
      txMock.factualReviewJob.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ attempt: 1 });
      txMock.factualReviewJob.create.mockResolvedValue(job({
        id: 12,
        kind: "FRESHNESS",
        sourceHash: "a".repeat(64),
        concern: "",
        attempt: 2,
      }));

      const result = await startFreshnessReviewJob(7, "CLAUDE", true);

      expect(result).toMatchObject({ job: { id: 12 }, reused: false, shouldRun: true });
      expect(txMock.factualReviewJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ attempt: 2 }),
      });
      expect(prismaMock.factualReviewJob.updateMany).toHaveBeenCalledTimes(1);
    });

    it("강제 재검증 실패 뒤 일반 요청은 보존된 이전 성공 결과를 반환한다", async () => {
      txMock.factualReviewJob.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(job({
          id: 11,
          kind: "FRESHNESS",
          status: "SUCCEEDED",
          verdict: "pass",
          comment: "이전 성공",
          attempt: 1,
          finishedAt: new Date(),
        }));

      await expect(startFreshnessReviewJob(7, "CLAUDE")).resolves.toMatchObject({
        job: { id: 11, status: "SUCCEEDED", result: { comment: "이전 성공" } },
        reused: true,
      });
      expect(txMock.factualReviewJob.create).not.toHaveBeenCalled();
    });

    it("엔진이 바뀌면 별도 캐시 key로 새 job을 만든다", async () => {
      txMock.factualReviewJob.findFirst.mockImplementation(
        async ({ where }: { where: { engine: string } }) =>
          where.engine === "CLAUDE"
            ? job({ kind: "FRESHNESS", status: "SUCCEEDED" })
            : null,
      );
      txMock.factualReviewJob.create.mockResolvedValue(job({
        id: 13,
        kind: "FRESHNESS",
        engine: "CODEX",
        concern: "",
      }));

      await expect(startFreshnessReviewJob(7, "CODEX")).resolves.toMatchObject({
        job: { id: 13, engine: "CODEX" },
        reused: false,
      });
      expect(txMock.factualReviewJob.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ engine: "CODEX", attempt: 1 }),
      });
    });

    it("동시 일반 요청은 잠금 순서대로 같은 RUNNING job을 공유한다", async () => {
      let stored: ReturnType<typeof job> | null = null;
      let queue = Promise.resolve();
      prismaMock.$transaction.mockImplementation(
        async (callback: (client: typeof txMock) => Promise<unknown>) => {
          const previous = queue;
          let release = () => {};
          queue = new Promise<void>((resolve) => { release = resolve; });
          await previous;
          try {
            return await callback(txMock);
          } finally {
            release();
          }
        },
      );
      txMock.factualReviewJob.findFirst.mockImplementation(
        async ({ where, select }: { where: { status?: string }; select?: unknown }) => {
          if (!stored) return null;
          if (where.status && stored.status !== where.status) return null;
          return select ? { attempt: stored.attempt } : stored;
        },
      );
      txMock.factualReviewJob.create.mockImplementation(async ({ data }) => {
        stored = job({ ...data, kind: "FRESHNESS", id: 21 });
        return stored;
      });

      const [first, second] = await Promise.all([
        startFreshnessReviewJob(7, "CLAUDE"),
        startFreshnessReviewJob(7, "CLAUDE"),
      ]);

      expect(txMock.factualReviewJob.create).toHaveBeenCalledOnce();
      expect(first).toMatchObject({ job: { id: 21 }, reused: false });
      expect(second).toMatchObject({ job: { id: 21 }, reused: true });
    });

    it("다른 종류 job은 조회할 수 없다", async () => {
      prismaMock.factualReviewJob.findUnique.mockResolvedValue(job());
      await expect(getFreshnessReviewJob(7, 11)).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
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
