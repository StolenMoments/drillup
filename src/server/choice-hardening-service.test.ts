import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Fingerprint } from "@/core/stable-json";

const prismaMock = vi.hoisted(() => ({
  question: { findUnique: vi.fn() },
  choiceHardeningJob: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("./db", () => ({ prisma: prismaMock }));

import {
  applyChoiceHardeningJob,
  getChoiceHardeningJob,
  startChoiceHardeningJob,
} from "./choice-hardening-service";

const original = {
  question: "원본 질문은 무엇인가요?",
  choices: ["원본 정답", "원본 오답 1", "원본 오답 2", "원본 오답 3"],
  answer_indices: [0],
  choice_explanations: ["근거 1", "근거 2", "근거 3", "근거 4"],
};

const preview = {
  engine: "CLAUDE" as const,
  comment: "변형했습니다",
  factualConcern: null,
  payload: {
    question: "원본 질문은 무엇인가요?",
    choices: ["원본 정답", "변형 오답 1", "변형 오답 2", "변형 오답 3"],
    answer_indices: [0],
    choice_explanations: ["새 근거 1", "새 근거 2", "새 근거 3", "새 근거 4"],
  },
};

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    questionId: 7,
    sourceHash: "a".repeat(64),
    sourcePayload: original,
    engine: "CLAUDE" as const,
    verifyEngine: "CODEX" as const,
    attempt: 1,
    status: "RUNNING" as const,
    stage: "GENERATING" as const,
    preview: null,
    errorMessage: null,
    createdAt: new Date("2026-07-15T00:00:00.000Z"),
    startedAt: null,
    finishedAt: null,
    appliedAt: null,
    ...overrides,
  };
}

function transactionClient(
  questionValue: unknown,
  jobValue: unknown,
) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    question: {
      findUnique: vi.fn().mockResolvedValue(questionValue),
      update: vi.fn(),
    },
    answerExplanation: { deleteMany: vi.fn() },
    choiceHardeningJob: {
      findUnique: vi.fn().mockResolvedValue(jobValue),
      update: vi.fn(),
    },
  };
}

describe("choice hardening job service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.choiceHardeningJob.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.question.findUnique.mockResolvedValue({
      id: 7,
      type: "MCQ",
      payload: original,
    });
  });

  it("같은 원본과 엔진 조합의 진행 중 job을 재사용한다", async () => {
    const running = job({ startedAt: new Date("2026-07-15T00:01:00.000Z") });
    prismaMock.choiceHardeningJob.findUnique.mockResolvedValue(running);

    const result = await startChoiceHardeningJob(7, "CLAUDE", false);

    expect(result).toMatchObject({ id: 11, status: "RUNNING", attempt: 1 });
    expect(prismaMock.choiceHardeningJob.create).not.toHaveBeenCalled();
  });

  it("완료된 preview를 같은 엔진 조합으로 재사용한다", async () => {
    prismaMock.choiceHardeningJob.findUnique.mockResolvedValue(
      job({ status: "SUCCEEDED", preview, finishedAt: new Date() }),
    );

    await expect(startChoiceHardeningJob(7, "CLAUDE", false)).resolves.toMatchObject({
      id: 11,
      status: "SUCCEEDED",
      preview,
    });
  });

  it("force 재실행은 완료 job의 attempt를 증가시킨다", async () => {
    const rerun = job({ attempt: 2 });
    prismaMock.choiceHardeningJob.findUnique
      .mockResolvedValueOnce(job({ status: "FAILED", errorMessage: "실패" }))
      .mockResolvedValueOnce(rerun);
    prismaMock.choiceHardeningJob.updateMany
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 1 });

    await expect(startChoiceHardeningJob(7, "CLAUDE", true)).resolves.toMatchObject({
      id: 11,
      attempt: 2,
      status: "RUNNING",
    });
    expect(prismaMock.choiceHardeningJob.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ where: { id: 11, status: { in: ["SUCCEEDED", "FAILED"] } } }),
    );
  });

  it("동시 force 요청은 조건부 갱신으로 attempt를 한 번만 증가시킨다", async () => {
    const failed = job({ status: "FAILED", errorMessage: "실패" });
    const rerun = job({ attempt: 2 });
    prismaMock.choiceHardeningJob.findUnique.mockImplementation(
      async ({ where }: { where: Record<string, unknown> }) =>
        "questionId_sourceHash_engine_verifyEngine" in where ? failed : rerun,
    );
    let forceUpdates = 0;
    prismaMock.choiceHardeningJob.updateMany.mockImplementation(
      async ({ where }: { where: { status?: unknown } }) => {
        if (where.status === "RUNNING") return { count: 0 };
        forceUpdates += 1;
        return { count: forceUpdates === 1 ? 1 : 0 };
      },
    );

    const results = await Promise.all([
      startChoiceHardeningJob(7, "CLAUDE", true),
      startChoiceHardeningJob(7, "CLAUDE", true),
    ]);

    expect(forceUpdates).toBe(2);
    expect(results.map((value) => value.attempt)).toEqual([2, 2]);
  });

  it("원본 payload가 바뀌면 새로운 job을 생성한다", async () => {
    prismaMock.question.findUnique.mockResolvedValue({
      id: 7,
      type: "MCQ",
      payload: { ...original, question: "수정된 원본 질문" },
    });
    prismaMock.choiceHardeningJob.findUnique.mockResolvedValue(null);
    prismaMock.choiceHardeningJob.create.mockResolvedValue(
      job({ id: 12, sourceHash: "b".repeat(64) }),
    );

    await expect(startChoiceHardeningJob(7, "CLAUDE", false)).resolves.toMatchObject({
      id: 12,
    });
    expect(prismaMock.choiceHardeningJob.create).toHaveBeenCalledTimes(1);
  });

  it("원본이 바뀐 뒤 preview 적용을 409로 거부한다", async () => {
    const tx = transactionClient({
      id: 7,
      type: "MCQ",
      payload: { ...original, question: "사용자가 수정한 질문" },
    }, job({ status: "SUCCEEDED", preview, sourceHash: "a".repeat(64) }));
    prismaMock.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<void>) => callback(tx),
    );

    await expect(applyChoiceHardeningJob(7, 11)).rejects.toMatchObject({
      code: "CHOICE_HARDENING_SOURCE_CHANGED",
      status: 409,
    });
    expect(tx.question.update).not.toHaveBeenCalled();
    expect(tx.answerExplanation.deleteMany).not.toHaveBeenCalled();
    expect(tx.choiceHardeningJob.update).not.toHaveBeenCalled();
  });

  it("preview 적용은 문제 수정, 해설 캐시 삭제, appliedAt 기록을 한 트랜잭션으로 처리한다", async () => {
    const sourceHash = await sha256Fingerprint(original);
    const completed = job({
      status: "SUCCEEDED",
      stage: "GENERATING",
      sourceHash,
      preview,
    });
    const tx = transactionClient(
      { id: 7, type: "MCQ", payload: original },
      completed,
    );
    prismaMock.$transaction.mockImplementation(async (callback: (client: typeof tx) => Promise<void>) => callback(tx));

    await expect(applyChoiceHardeningJob(7, 11)).resolves.toBeUndefined();

    expect(tx.question.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 7 } }),
    );
    expect(tx.answerExplanation.deleteMany).toHaveBeenCalledWith({ where: { questionId: 7 } });
    expect(tx.choiceHardeningJob.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 11 }, data: { appliedAt: expect.any(Date) } }),
    );
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    const lockSql = tx.$queryRaw.mock.calls
      .map(([query]) => Array.from(query as TemplateStringsArray).join(" "))
      .join("\n");
    expect(lockSql).toContain("FROM question");
    expect(lockSql).toContain("FROM choice_hardening_job");
    expect(lockSql.match(/FOR UPDATE/g)).toHaveLength(2);
  });

  it("잠금 후 이미 적용된 job은 idempotent 성공으로 처리한다", async () => {
    const sourceHash = await sha256Fingerprint(original);
    const tx = transactionClient(
      { id: 7, type: "MCQ", payload: original },
      job({ status: "SUCCEEDED", sourceHash, preview, appliedAt: new Date() }),
    );
    prismaMock.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<void>) => callback(tx),
    );

    await expect(applyChoiceHardeningJob(7, 11)).resolves.toBeUndefined();

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.question.update).not.toHaveBeenCalled();
    expect(tx.answerExplanation.deleteMany).not.toHaveBeenCalled();
    expect(tx.choiceHardeningJob.update).not.toHaveBeenCalled();
  });

  it("job 조회 DTO는 날짜를 ISO 문자열로 반환한다", async () => {
    prismaMock.choiceHardeningJob.findUnique.mockResolvedValue(
      job({
        status: "FAILED",
        errorMessage: "검증 실패",
        finishedAt: new Date("2026-07-15T00:02:00.000Z"),
      }),
    );

    await expect(getChoiceHardeningJob(7, 11)).resolves.toMatchObject({
      id: 11,
      finishedAt: "2026-07-15T00:02:00.000Z",
      errorMessage: "검증 실패",
    });
  });

  it("오래 실행된 job은 조회 전에 stale FAILED 상태로 정리한다", async () => {
    const previousTimeout = process.env.GENERATION_TIMEOUT_MS;
    process.env.GENERATION_TIMEOUT_MS = "1000";
    try {
      prismaMock.choiceHardeningJob.findUnique.mockResolvedValue(
        job({ startedAt: new Date(Date.now() - 63_000) }),
      );

      await getChoiceHardeningJob(7, 11);

      expect(prismaMock.choiceHardeningJob.updateMany).toHaveBeenCalledWith(
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

  it("선점되지 않은 채 orphan window를 넘긴 job도 stale 처리한다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T01:00:00.000Z"));
    const previousTimeout = process.env.GENERATION_TIMEOUT_MS;
    process.env.GENERATION_TIMEOUT_MS = "1000";
    try {
      prismaMock.choiceHardeningJob.findUnique.mockResolvedValue(job());

      await getChoiceHardeningJob(7, 11);

      expect(prismaMock.choiceHardeningJob.updateMany).toHaveBeenCalledWith({
        where: {
          status: "RUNNING",
          OR: [
            { startedAt: { lt: new Date("2026-07-15T00:58:58.000Z") } },
            {
              startedAt: null,
              createdAt: { lt: new Date("2026-07-15T00:58:58.000Z") },
            },
          ],
        },
        data: expect.objectContaining({ status: "FAILED" }),
      });
    } finally {
      vi.useRealTimers();
      if (previousTimeout === undefined) delete process.env.GENERATION_TIMEOUT_MS;
      else process.env.GENERATION_TIMEOUT_MS = previousTimeout;
    }
  });

  it("정확히 orphan window 경계인 job은 stale 처리 조건에서 제외한다", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-15T01:00:00.000Z"));
    const previousTimeout = process.env.GENERATION_TIMEOUT_MS;
    process.env.GENERATION_TIMEOUT_MS = "1000";
    try {
      prismaMock.choiceHardeningJob.findUnique.mockResolvedValue(job());

      await getChoiceHardeningJob(7, 11);

      const where = prismaMock.choiceHardeningJob.updateMany.mock.calls[0][0].where;
      expect(where.OR[0].startedAt.lt).toEqual(new Date("2026-07-15T00:58:58.000Z"));
      expect(where.OR[0].startedAt).not.toHaveProperty("lte");
      expect(where.OR[1].createdAt).not.toHaveProperty("lte");
    } finally {
      vi.useRealTimers();
      if (previousTimeout === undefined) delete process.env.GENERATION_TIMEOUT_MS;
      else process.env.GENERATION_TIMEOUT_MS = previousTimeout;
    }
  });
});
