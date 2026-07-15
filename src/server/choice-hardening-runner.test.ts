import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  choiceHardeningJob: {
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));
const runEngineMock = vi.hoisted(() => vi.fn());

vi.mock("./db", () => ({ prisma: prismaMock }));
vi.mock("./generation/run-engine", () => ({
  runEngine: runEngineMock,
  generationTimeoutMs: () => 1_000,
}));

import { runChoiceHardeningJob } from "./choice-hardening-runner";

const original = {
  question: "원본 질문은 무엇인가요?",
  choices: ["원본 정답", "원본 오답 1", "원본 오답 2", "원본 오답 3"],
  answer_indices: [0],
  choice_explanations: ["근거 1", "근거 2", "근거 3", "근거 4"],
};
const generated = {
  comment: "변형했습니다",
  revised: {
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
    attempt: 2,
    status: "RUNNING" as const,
    stage: "GENERATING" as const,
    preview: null,
    errorMessage: null,
    createdAt: new Date(),
    startedAt: null,
    finishedAt: null,
    appliedAt: null,
    question: { topic: { name: "주제" } },
    ...overrides,
  };
}

function success(resultText: string) {
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

describe("choice hardening runner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runEngineMock.mockReset();
    prismaMock.choiceHardeningJob.findUnique.mockResolvedValue(
      job({ startedAt: new Date("2026-07-15T00:00:00.000Z") }),
    );
    prismaMock.choiceHardeningJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.choiceHardeningJob.update.mockResolvedValue(undefined);
  });

  it("생성 엔진을 한 번만 실행하고 preview를 저장한다", async () => {
    runEngineMock.mockResolvedValueOnce(success(JSON.stringify(generated)));

    await runChoiceHardeningJob(11);

    expect(runEngineMock).toHaveBeenCalledTimes(1);
    expect(runEngineMock).toHaveBeenNthCalledWith(
      1,
      "CLAUDE",
      expect.any(String),
      expect.stringMatching(/harden[\\/]jobs[\\/]11[\\/]attempt-2$/),
      "generate-",
    );
    expect(prismaMock.choiceHardeningJob.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 11, attempt: 2, status: "RUNNING" }),
        data: expect.objectContaining({ status: "SUCCEEDED", preview: expect.any(Object) }),
      }),
    );
  });

  it("엔진 실패는 HTTP 예외 대신 FAILED job으로 저장한다", async () => {
    runEngineMock.mockResolvedValue({
      ok: false,
      failureReason: "CLI 실행 실패",
      stdoutTail: "",
      stderrTail: "오류",
      exitCode: 1,
      timedOut: false,
      durationMs: 10,
    });

    await expect(runChoiceHardeningJob(11)).resolves.toBeUndefined();
    expect(prismaMock.choiceHardeningJob.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: 11, attempt: 2, status: "RUNNING" }),
        data: expect.objectContaining({ status: "FAILED", errorMessage: "CLI 실행 실패" }),
      }),
    );
  });

  it("생성 JSON 파싱 실패도 FAILED job으로 저장한다", async () => {
    runEngineMock.mockResolvedValue(success(JSON.stringify({ comment: "불완전" })));

    await runChoiceHardeningJob(11);

    expect(prismaMock.choiceHardeningJob.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "FAILED",
          errorMessage: expect.stringContaining("생성 결과를 해석하지 못했습니다"),
        }),
      }),
    );
  });

  it("중복 runner 선점은 CLI를 한 번만 실행한다", async () => {
    prismaMock.choiceHardeningJob.updateMany.mockResolvedValue({ count: 0 });

    await runChoiceHardeningJob(11);

    expect(runEngineMock).not.toHaveBeenCalled();
  });

  it("선점 후 다시 읽은 현재 attempt로 결과 경로를 계산한다", async () => {
    prismaMock.choiceHardeningJob.findUnique
      .mockReset()
      .mockResolvedValueOnce(job({ attempt: 3, startedAt: new Date() }));
    runEngineMock.mockResolvedValueOnce(success(JSON.stringify(generated)));

    await runChoiceHardeningJob(11);

    expect(runEngineMock).toHaveBeenNthCalledWith(
      1,
      "CLAUDE",
      expect.any(String),
      expect.stringContaining("attempt-3"),
      "generate-",
    );
  });

  it("상태 갱신은 attempt와 선점 시각으로 fencing한다", async () => {
    vi.useFakeTimers();
    const claimedAt = new Date("2026-07-15T00:00:00.000Z");
    vi.setSystemTime(claimedAt);
    prismaMock.choiceHardeningJob.findUnique
      .mockReset()
      .mockResolvedValueOnce(job({ startedAt: claimedAt }));
    runEngineMock.mockResolvedValueOnce(success(JSON.stringify(generated)));
    try {
      await runChoiceHardeningJob(11);

      expect(prismaMock.choiceHardeningJob.update).not.toHaveBeenCalled();
      expect(prismaMock.choiceHardeningJob.updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: 11, attempt: 2, startedAt: claimedAt, status: "RUNNING" },
          data: expect.objectContaining({ status: "SUCCEEDED" }),
        }),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("이전 attempt의 늦은 성공은 새 attempt 상태를 변경하지 않는다", async () => {
    prismaMock.choiceHardeningJob.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    runEngineMock.mockResolvedValueOnce(success(JSON.stringify(generated)));

    await runChoiceHardeningJob(11);

    expect(runEngineMock).toHaveBeenCalledTimes(1);
  });

  it("이전 attempt의 늦은 실패도 fencing 조건 밖 상태를 변경하지 않는다", async () => {
    prismaMock.choiceHardeningJob.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    runEngineMock.mockResolvedValue({
      ok: false,
      failureReason: "늦은 실패",
      stdoutTail: "",
      stderrTail: "",
      exitCode: 1,
      timedOut: false,
      durationMs: 10,
    });

    await runChoiceHardeningJob(11);

    expect(prismaMock.choiceHardeningJob.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: 11,
          attempt: 2,
          status: "RUNNING",
          startedAt: expect.any(Date),
        }),
        data: expect.objectContaining({ status: "FAILED" }),
      }),
    );
  });
});
