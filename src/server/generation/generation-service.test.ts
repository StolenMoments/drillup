import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  job: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
  topic: {
    findUnique: vi.fn(),
  },
  generationJob: {
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  question: {
    count: vi.fn(),
    findMany: vi.fn(),
  },
  keyword: {
    findMany: vi.fn(),
  },
  generationItemRevision: {
    findUnique: vi.fn(),
    findMany: vi.fn(),
    upsert: vi.fn(),
  },
  questionGenerationJobData: {
    update: vi.fn(),
    updateMany: vi.fn(),
  },
}));
const transactionClientMock = vi.hoisted(() => ({
  $queryRaw: vi.fn(),
  job: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
  },
  question: {
    findMany: vi.fn(),
    create: vi.fn(),
  },
  srsState: { create: vi.fn() },
  questionGenerationJobData: { update: vi.fn() },
  keywordTaggingJobData: { update: vi.fn() },
}));
const commonJobServiceMock = vi.hoisted(() => ({
  createPendingJob: vi.fn(),
  retryJob: vi.fn(),
}));
const commonJobRunnerMock = vi.hoisted(() => ({
  runClaimedJob: vi.fn(),
  recoverStaleJobs: vi.fn(),
  updateJobProgress: vi.fn(),
}));
const importQuestionsMock = vi.hoisted(() => vi.fn());
const trackedRunMock = vi.hoisted(() => ({
  runTrackedEngine: vi.fn(),
  completeTrackedRun: vi.fn(),
  failTrackedRun: vi.fn(),
}));

vi.mock("../db", () => ({ prisma: prismaMock }));
vi.mock("../import-service", () => ({ importQuestions: importQuestionsMock }));
vi.mock("../job-service", () => commonJobServiceMock);
vi.mock("../job-runner", () => commonJobRunnerMock);
vi.mock("./tracked-run", () => trackedRunMock);

import type { QuestionBlueprint } from "@/core/question-blueprint";
import {
  approveJob,
  createItemRevision,
  createJob,
  getJob,
  repairGateFailures,
  runGenerationJob,
  runGenerationItemRevisionJob,
} from "./generation-service";

const originalQuestion = {
  type: "mcq",
  question: "원래 문제",
  choices: ["A", "B", "C", "D"],
  answer_index: 0,
};
const revisedQuestion = {
  ...originalQuestion,
  question: "수정된 문제",
};

function succeededJob() {
  return {
    id: 1,
    topicId: 2,
    engine: "CLAUDE",
    verifyEngine: "CODEX",
    instructions: "",
    referenceFiles: null,
    status: "SUCCEEDED",
    kind: "QUESTION",
    result: [{ index: 0, ok: true, question: originalQuestion, verdict: "fail", verdictComment: "수정 필요", testedDistinction: "관리형 대 자체 운영 구분" }],
    errorMessage: null,
    verifyWarning: null,
    createdAt: new Date("2026-07-11T00:00:00.000Z"),
    finishedAt: new Date("2026-07-11T00:01:00.000Z"),
    approvedAt: null,
    savedCount: 0,
    sourceQuestionIds: null,
  };
}

function commonSucceededJob(overrides: Record<string, unknown> = {}) {
  const legacy = succeededJob();
  return {
    id: legacy.id,
    type: "QUESTION_GENERATION",
    status: "SUCCEEDED",
    engine: legacy.engine,
    topicId: legacy.topicId,
    questionId: null,
    parentJobId: null,
    retryOfJobId: null,
    runToken: null,
    errorMessage: null,
    createdAt: legacy.createdAt,
    startedAt: new Date("2026-07-11T00:00:01.000Z"),
    heartbeatAt: new Date("2026-07-11T00:00:30.000Z"),
    finishedAt: legacy.finishedAt,
    questionGenerationData: {
      jobId: legacy.id,
      verifyEngine: legacy.verifyEngine,
      instructions: legacy.instructions,
      referenceFiles: legacy.referenceFiles as unknown,
      correctAnswerCount: 1,
      choiceCount: 4,
      sourceQuestionIds: legacy.sourceQuestionIds,
      stage: "SUCCEEDED",
      items: legacy.result as unknown,
      verifyWarning: legacy.verifyWarning,
      approvedAt: legacy.approvedAt,
      savedCount: legacy.savedCount,
    },
    keywordTaggingData: null,
    childJobs: [],
    ...overrides,
  };
}

function revisionJob(id: number, proposedQuestion: unknown, selectedAt: Date | null) {
  return {
    id,
    type: "GENERATION_ITEM_REVISION",
    status: "SUCCEEDED",
    engine: "CLAUDE",
    topicId: null,
    questionId: null,
    parentJobId: 1,
    retryOfJobId: null,
    runToken: null,
    errorMessage: null,
    createdAt: new Date("2026-07-11T00:01:00.000Z"),
    startedAt: new Date("2026-07-11T00:01:01.000Z"),
    heartbeatAt: new Date("2026-07-11T00:01:30.000Z"),
    finishedAt: new Date("2026-07-11T00:02:00.000Z"),
    generationItemRevisionData: {
      jobId: id,
      itemIndex: 0,
      instructions: "",
      verdict: "PASS",
      comment: "수정했습니다",
      proposedQuestion,
      selectedAt,
    },
  };
}

function pendingCommonJob(id: number, retryOfJobId: number | null = null) {
  return {
    id,
    type: "QUESTION_GENERATION",
    status: "PENDING",
    engine: "CLAUDE",
    topicId: 2,
    questionId: null,
    parentJobId: null,
    retryOfJobId,
    errorMessage: null,
    createdAt: "2026-07-30T00:00:00.000Z",
    startedAt: null,
    heartbeatAt: null,
    finishedAt: null,
  };
}

describe("common generation job creation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.topic.findUnique.mockResolvedValue({
      id: 2,
      name: "AWS",
      referenceDir: null,
    });
    prismaMock.question.count.mockResolvedValue(0);
    prismaMock.question.findMany.mockResolvedValue([]);
    prismaMock.keyword.findMany.mockResolvedValue([]);
    prismaMock.job.findFirst.mockResolvedValue(null);
  });

  it("같은 Topic의 PENDING 키워드 작업도 문제 생성을 막는다", async () => {
    commonJobServiceMock.createPendingJob.mockImplementation(
      async (_input: unknown, options: { resolveExisting?: (tx: unknown) => Promise<unknown> }) => {
        await options.resolveExisting?.({
          job: {
            findFirst: vi.fn().mockResolvedValue({
              ...pendingCommonJob(70),
              type: "KEYWORD_TAGGING",
            }),
          },
        });
        return pendingCommonJob(71);
      },
    );

    await expect(
      createJob({
        topicId: 2,
        engine: "CLAUDE",
        verifyEngine: "CODEX",
        instructions: "",
        correctAnswerCount: 1,
        choiceCount: 4,
        referenceFiles: [],
      }),
    ).rejects.toMatchObject({ code: "JOB_ALREADY_RUNNING", status: 409 });
  });

  it("재시도는 종료 행을 재사용하지 않고 lineage가 있는 새 PENDING Job을 반환한다", async () => {
    let policyCalled = false;
    commonJobServiceMock.retryJob.mockImplementation(async (_id, _input, options) => {
      await options?.resolveExisting?.({
        job: { findFirst: vi.fn().mockResolvedValue(null) },
      });
      policyCalled = Boolean(options?.resolveExisting);
      return pendingCommonJob(102, 41);
    });

    const result = await createJob({
      topicId: 2,
      engine: "CLAUDE",
      verifyEngine: "CODEX",
      instructions: "",
      correctAnswerCount: 1,
      choiceCount: 4,
      referenceFiles: [],
      retryOfJobId: 41,
    });

    expect(result).toMatchObject({
      id: 102,
      type: "QUESTION_GENERATION",
      status: "PENDING",
      retryOfJobId: 41,
      stage: "RUNNING",
    });
    expect(policyCalled).toBe(true);
  });

  it("재시도는 같은 type/Topic의 active Job도 잠금 안에서 409로 거절한다", async () => {
    let policyCalled = false;
    commonJobServiceMock.retryJob.mockImplementation(async (_id, _input, options) => {
      policyCalled = true;
      await options?.resolveExisting?.({
        job: { findFirst: vi.fn().mockResolvedValue({
          ...pendingCommonJob(88),
          status: "RUNNING",
        }) },
      });
      return pendingCommonJob(89, 41);
    });

    await expect(createJob({
      topicId: 2,
      engine: "CLAUDE",
      verifyEngine: "CODEX",
      instructions: "",
      correctAnswerCount: 1,
      choiceCount: 4,
      referenceFiles: [],
      retryOfJobId: 41,
    })).rejects.toMatchObject({ code: "JOB_ALREADY_RUNNING", status: 409 });
    expect(policyCalled).toBe(true);
  });

  it("재시도는 같은 Topic의 cross-type active Job을 409로 거절한다", async () => {
    commonJobServiceMock.retryJob.mockImplementation(async (_id, _input, options) => {
      await options?.resolveExisting?.({
        job: {
          findFirst: vi.fn().mockResolvedValue({
            ...pendingCommonJob(88),
            type: "KEYWORD_TAGGING",
          }),
        },
      });
      return pendingCommonJob(89, 41);
    });

    await expect(createJob({
      topicId: 2,
      engine: "CLAUDE",
      verifyEngine: "CODEX",
      instructions: "",
      correctAnswerCount: 1,
      choiceCount: 4,
      referenceFiles: [],
      retryOfJobId: 41,
    })).rejects.toMatchObject({ code: "JOB_ALREADY_RUNNING", status: 409 });
  });

  it("같은 항목의 두 번째 재검증도 첫 시도를 덮지 않는 새 child Job이다", async () => {
    prismaMock.job.findFirst.mockResolvedValue(commonSucceededJob());
    let nextId = 201;
    commonJobServiceMock.createPendingJob.mockImplementation(async () => ({
      ...pendingCommonJob(nextId++),
      type: "GENERATION_ITEM_REVISION",
      topicId: null,
      parentJobId: 1,
    }));

    const first = await createItemRevision({
      jobId: 1,
      itemIndex: 0,
      engine: "CLAUDE",
      instructions: "첫 시도",
    });
    const second = await createItemRevision({
      jobId: 1,
      itemIndex: 0,
      engine: "CODEX",
      instructions: "두 번째 시도",
    });

    expect(first.revisionJobId).toBe(201);
    expect(second.revisionJobId).toBe(202);
  });
});

describe("approveJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    transactionClientMock.$queryRaw.mockResolvedValue([{ id: 1 }]);
    transactionClientMock.question.create.mockResolvedValue({ id: 501 });
    transactionClientMock.srsState.create.mockResolvedValue({});
    transactionClientMock.questionGenerationJobData.update.mockResolvedValue({});
    prismaMock.$transaction.mockImplementation(async (callback) => callback(transactionClientMock));
  });

  it("saves an applied revision even when the original verification verdict failed", async () => {
    const selected = revisionJob(81, revisedQuestion, new Date("2026-07-11T00:01:30.000Z"));
    transactionClientMock.job.findFirst
      .mockResolvedValueOnce(commonSucceededJob({ childJobs: [selected] }))
      .mockResolvedValueOnce(null);
    transactionClientMock.job.findMany.mockResolvedValue([selected]);
    prismaMock.job.findFirst.mockResolvedValue(commonSucceededJob({
      childJobs: [selected],
      questionGenerationData: {
        ...commonSucceededJob().questionGenerationData,
        approvedAt: new Date("2026-07-11T00:02:00.000Z"),
        savedCount: 1,
      },
    }));

    await expect(approveJob(1, [0])).resolves.toMatchObject({ savedCount: 1 });
    expect(transactionClientMock.question.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        topicId: 2,
        payload: expect.objectContaining({ question: "수정된 문제" }),
        testedDistinction: "관리형 대 자체 운영 구분",
      }),
      select: { id: true },
    });
  });

  it("approves the successful revision with the newest selectedAt instead of the highest Job id", async () => {
    const newerSelection = revisionJob(
      81,
      { ...revisedQuestion, question: "최근 선택 수정본" },
      new Date("2026-07-30T00:02:00.000Z"),
    );
    const higherIdOlderSelection = revisionJob(
      92,
      { ...revisedQuestion, question: "예전 선택 수정본" },
      new Date("2026-07-30T00:01:00.000Z"),
    );
    transactionClientMock.job.findFirst
      .mockResolvedValueOnce(commonSucceededJob({
        childJobs: [newerSelection, higherIdOlderSelection],
      }))
      .mockResolvedValueOnce(null);
    transactionClientMock.job.findMany.mockResolvedValue([
      newerSelection,
      higherIdOlderSelection,
    ]);
    prismaMock.job.findFirst.mockResolvedValue(commonSucceededJob({
      childJobs: [newerSelection, higherIdOlderSelection],
      questionGenerationData: {
        ...commonSucceededJob().questionGenerationData,
        approvedAt: new Date("2026-07-30T00:03:00.000Z"),
        savedCount: 1,
      },
    }));

    await approveJob(1, [0]);

    expect(transactionClientMock.question.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        payload: expect.objectContaining({ question: "최근 선택 수정본" }),
      }),
      select: { id: true },
    });
  });

  it("still rejects an original question whose verification verdict failed", async () => {
    transactionClientMock.job.findFirst
      .mockResolvedValueOnce(commonSucceededJob())
      .mockResolvedValueOnce(null);
    transactionClientMock.job.findMany.mockResolvedValue([]);

    await expect(approveJob(1, [0])).rejects.toMatchObject({
      code: "INVALID_ITEMS",
      status: 400,
    });
    expect(transactionClientMock.question.create).not.toHaveBeenCalled();
  });

  it("testedDistinction이 없는 구버전 잡 아이템은 null로 저장한다", async () => {
    const parent = commonSucceededJob();
    parent.questionGenerationData.items = [{
      index: 0,
      ok: true,
      question: originalQuestion,
      verdict: "pass",
      verdictComment: null,
    }];
    transactionClientMock.job.findFirst
      .mockResolvedValueOnce(parent)
      .mockResolvedValueOnce(null);
    transactionClientMock.job.findMany.mockResolvedValue([]);
    prismaMock.job.findFirst.mockResolvedValue(parent);

    await approveJob(1, [0]);
    expect(transactionClientMock.question.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ testedDistinction: null }),
      select: { id: true },
    });
  });
});

describe("getJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("includes normalized instructions and reference files in the DTO", async () => {
    const job = commonSucceededJob();
    job.questionGenerationData.instructions = "실패한 생성의 추가 지시";
    job.questionGenerationData.referenceFiles = ["common/a.md", 123, null, "common/b.md"];
    prismaMock.job.findFirst.mockResolvedValue(job);

    await expect(getJob(1)).resolves.toMatchObject({
      instructions: "실패한 생성의 추가 지시",
      referenceFiles: ["common/a.md", "common/b.md"],
    });
    expect(commonJobRunnerMock.recoverStaleJobs).toHaveBeenCalledOnce();
  });

  it("renders a stale-recovered FAILED job with FAILED detail stage", async () => {
    const job = commonSucceededJob({
      status: "FAILED",
      errorMessage: "stale job recovered after heartbeat timeout",
      finishedAt: new Date("2026-07-30T00:03:01.001Z"),
    });
    job.questionGenerationData.stage = "VERIFYING";
    prismaMock.job.findFirst.mockResolvedValue(job);

    await expect(getJob(1)).resolves.toMatchObject({
      status: "FAILED",
      stage: "FAILED",
      items: null,
    });
  });

  it("displays the selected revision with the newest selectedAt instead of the highest Job id", async () => {
    const newerSelection = revisionJob(
      81,
      { ...revisedQuestion, question: "최근 선택 수정본" },
      new Date("2026-07-30T00:02:00.000Z"),
    );
    const higherIdOlderSelection = revisionJob(
      92,
      { ...revisedQuestion, question: "예전 선택 수정본" },
      new Date("2026-07-30T00:01:00.000Z"),
    );
    prismaMock.job.findFirst.mockResolvedValue(commonSucceededJob({
      childJobs: [newerSelection, higherIdOlderSelection],
    }));

    await expect(getJob(1)).resolves.toMatchObject({
      items: [{
        index: 0,
        selectedRevision: {
          id: 81,
          proposedQuestion: expect.objectContaining({ question: "최근 선택 수정본" }),
        },
      }],
    });
  });
});

describe("runGenerationItemRevisionJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the successful revision with the newest selectedAt as its source", async () => {
    const newerSelection = revisionJob(
      81,
      { ...revisedQuestion, question: "최근 선택 수정본" },
      new Date("2026-07-30T00:02:00.000Z"),
    );
    const higherIdOlderSelection = revisionJob(
      92,
      { ...revisedQuestion, question: "예전 선택 수정본" },
      new Date("2026-07-30T00:01:00.000Z"),
    );
    const parent = commonSucceededJob({
      topic: { id: 2, name: "AWS", referenceDir: null },
      childJobs: [newerSelection, higherIdOlderSelection],
    });
    const currentRevision = {
      ...revisionJob(103, null, null),
      status: "RUNNING",
      parentJob: parent,
    };
    prismaMock.job.findFirst.mockResolvedValue(currentRevision);
    let prompt = "";
    trackedRunMock.runTrackedEngine.mockImplementation(async (input: { prompt: string }) => {
      prompt = input.prompt;
      return {
        ok: true as const,
        resultText: JSON.stringify({
          verdict: "pass",
          comment: "수정 완료",
          revised_question: {
            type: "mcq",
            question: "검증 가능한 수정 결과",
            choices: ["A", "B", "C", "D"],
            answer_indices: [0],
            choice_explanations: ["근거", "근거", "근거", "근거"],
          },
        }),
        runLogId: 5,
        stdoutTail: "",
        stderrTail: "",
        exitCode: 0,
        timedOut: false,
        durationMs: 0,
      };
    });
    commonJobRunnerMock.runClaimedJob.mockImplementation(async (_jobId, options) => {
      await options.execute({ job: pendingCommonJob(103), runToken: "run-token" });
      return "SUCCEEDED";
    });

    await runGenerationItemRevisionJob(103);

    expect(prompt).toContain("최근 선택 수정본");
    expect(prompt).not.toContain("예전 선택 수정본");
  });
});

// 난이도 게이트를 통과하는 설계표 (close distractor 2개: b, c)
function passingBlueprint(): QuestionBlueprint {
  return {
    id: "b1",
    domainTask: "deploy securely",
    testedDistinction: "managed versus self-managed",
    referenceFacts: [
      { id: "f1", statement: "a", sourceFile: "a.md" },
      { id: "f2", statement: "b", sourceFile: "b.md" },
    ],
    constraints: ["c1", "c2", "c3"].map((id, index) => ({
      id,
      statement: id,
      kind: index === 0 ? "SECURITY" : "OPERATIONS",
      factIds: [index === 2 ? "f2" : "f1"],
    })),
    choices: [
      { id: "a", solution: "correct", serviceNames: ["A", "B"], satisfiedConstraintIds: ["c1", "c2", "c3"], violatedConstraintIds: [], misconception: null, correct: true },
      { id: "b", solution: "near 1", serviceNames: ["A"], satisfiedConstraintIds: ["c1", "c2"], violatedConstraintIds: ["c3"], misconception: "misses c3", correct: false },
      { id: "c", solution: "near 2", serviceNames: ["B"], satisfiedConstraintIds: ["c1", "c3"], violatedConstraintIds: ["c2"], misconception: "misses c2", correct: false },
      { id: "d", solution: "wrong", serviceNames: ["C"], satisfiedConstraintIds: ["c1"], violatedConstraintIds: ["c2", "c3"], misconception: "misses", correct: false },
    ],
    reasoningSteps: ["compare", "select"],
  };
}

// job #50 사례: violated 1개지만 satisfied가 나머지 전부가 아니라 close distractor로 인정되지 않는다.
function failingBlueprint() {
  const blueprint = passingBlueprint();
  blueprint.choices[1].satisfiedConstraintIds = ["c1"];
  return blueprint;
}

function engineSuccess(blueprints: unknown[], runLogId: number) {
  return {
    ok: true as const,
    resultText: JSON.stringify({ blueprints }),
    runLogId,
    stdoutTail: "",
    stderrTail: "",
    exitCode: 0,
    timedOut: false,
    durationMs: 1000,
  };
}

describe("repairGateFailures", () => {
  const input = () => ({
    jobId: 50,
    engine: "CODEX" as const,
    dir: "C:/jobs/50",
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("전부 통과하면 수선 호출 없이 그대로 반환한다", async () => {
    const result = await repairGateFailures({ ...input(), blueprints: [passingBlueprint()] });
    expect(result.passed).toHaveLength(1);
    expect(result.violationSummary).toBeNull();
    expect(trackedRunMock.runTrackedEngine).not.toHaveBeenCalled();
  });

  it("설계표 호출 기록을 게이트 결과로 닫는다", async () => {
    await repairGateFailures({ ...input(), blueprints: [passingBlueprint()], blueprintRunLogId: 5 });
    expect(trackedRunMock.completeTrackedRun).toHaveBeenCalledWith(5);

    trackedRunMock.runTrackedEngine.mockResolvedValueOnce(engineSuccess([passingBlueprint()], 7));
    await repairGateFailures({ ...input(), blueprints: [failingBlueprint()], blueprintRunLogId: 6 });
    expect(trackedRunMock.failTrackedRun).toHaveBeenCalledWith(6, expect.stringContaining("CLOSE_DISTRACTOR_COUNT"));
  });

  it("수선 프롬프트에 위반 코드·메시지·게이트 규칙을 담아 보낸다", async () => {
    trackedRunMock.runTrackedEngine.mockResolvedValueOnce(engineSuccess([passingBlueprint()], 7));

    const result = await repairGateFailures({ ...input(), blueprints: [failingBlueprint()] });

    expect(result.passed).toHaveLength(1);
    const call = trackedRunMock.runTrackedEngine.mock.calls[0][0];
    expect(call).toMatchObject({ jobId: 50, stage: "BLUEPRINT_REPAIR", attempt: 1 });
    expect(call.prompt).toContain("CLOSE_DISTRACTOR_COUNT At least two close distractors are required.");
    expect(call.prompt).toContain("every constraint id must appear in exactly one of satisfiedConstraintIds or violatedConstraintIds");
    expect(trackedRunMock.completeTrackedRun).toHaveBeenCalledWith(7);
  });

  it("1차 수선이 실패하면 갱신된 위반으로 2차 수선을 시도한다", async () => {
    trackedRunMock.runTrackedEngine
      .mockResolvedValueOnce(engineSuccess([failingBlueprint()], 7))
      .mockResolvedValueOnce(engineSuccess([passingBlueprint()], 8));

    const result = await repairGateFailures({ ...input(), blueprints: [failingBlueprint()] });

    expect(result.passed).toHaveLength(1);
    expect(trackedRunMock.runTrackedEngine).toHaveBeenCalledTimes(2);
    expect(trackedRunMock.runTrackedEngine.mock.calls[1][0]).toMatchObject({ attempt: 2 });
    expect(trackedRunMock.failTrackedRun).toHaveBeenCalledWith(7, expect.stringContaining("CLOSE_DISTRACTOR_COUNT"));
    expect(trackedRunMock.completeTrackedRun).toHaveBeenCalledWith(8);
  });

  it("2차 수선까지 실패하면 위반 요약과 함께 빈 결과를 반환한다", async () => {
    trackedRunMock.runTrackedEngine
      .mockResolvedValueOnce(engineSuccess([failingBlueprint()], 7))
      .mockResolvedValueOnce(engineSuccess([failingBlueprint()], 8));

    const result = await repairGateFailures({ ...input(), blueprints: [failingBlueprint()] });

    expect(result.passed).toHaveLength(0);
    expect(result.excludedCount).toBe(1);
    expect(result.violationSummary).toContain("b1: CLOSE_DISTRACTOR_COUNT At least two close distractors are required.");
    expect(trackedRunMock.runTrackedEngine).toHaveBeenCalledTimes(2);
    expect(trackedRunMock.failTrackedRun).toHaveBeenCalledWith(8, expect.stringContaining("CLOSE_DISTRACTOR_COUNT"));
  });
});

describe("자동 ITEM_REPAIR", () => {
  const generatedQuestion = {
    type: "mcq",
    question: "원래 문제의 고유 문자열",
    choices: ["정답", "가까운 오답 1", "가까운 오답 2", "가까운 오답 3"],
    answer_indices: [0],
    choice_explanations: ["근거", "근거", "근거", "근거"],
    explanation: "해설",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    commonJobRunnerMock.updateJobProgress.mockImplementation(
      async (_jobId, _runToken, persist) => {
        await persist({ questionGenerationJobData: { update: vi.fn() } });
      },
    );
  });

  it("중간 상세 저장의 fence를 잃으면 VERIFY를 실행하지 않고 즉시 멈춘다", async () => {
    const blueprint = passingBlueprint();
    const stages: string[] = [];
    const pending = pendingCommonJob(1);
    const executionJob = commonSucceededJob({
      status: "RUNNING",
      finishedAt: null,
      topic: { id: 2, name: "AWS", referenceDir: null },
    });
    executionJob.questionGenerationData.stage = "RUNNING";
    executionJob.questionGenerationData.items = null;
    prismaMock.job.findUnique.mockResolvedValue(executionJob);
    prismaMock.question.count.mockResolvedValue(0);
    prismaMock.question.findMany.mockResolvedValue([]);
    prismaMock.keyword.findMany.mockResolvedValue([]);
    prismaMock.questionGenerationJobData.update.mockResolvedValue({});
    commonJobRunnerMock.updateJobProgress.mockRejectedValue(new Error("fence lost"));
    commonJobRunnerMock.runClaimedJob.mockImplementation(async (_jobId, options) => {
      try {
        await options.execute({ job: pending, runToken: "stale-token" });
        return "SUCCEEDED";
      } catch {
        return "FENCED";
      }
    });
    trackedRunMock.runTrackedEngine.mockImplementation(async (input: { stage: string }) => {
      stages.push(input.stage);
      const results: Record<string, unknown> = {
        BLUEPRINT: { blueprints: [blueprint] },
        GENERATION: { questions: [generatedQuestion] },
        VERIFY: { verdicts: [{ index: 0, verdict: "pass", comment: "" }] },
      };
      return {
        ok: true as const,
        resultText: JSON.stringify(results[input.stage]),
        runLogId: stages.length,
        stdoutTail: "",
        stderrTail: "",
        exitCode: 0,
        timedOut: false,
        durationMs: 0,
      };
    });

    await runGenerationJob(1);

    expect(commonJobRunnerMock.updateJobProgress).toHaveBeenCalledWith(
      1,
      "stale-token",
      expect.any(Function),
    );
    expect(stages).toEqual(["BLUEPRINT", "GENERATION"]);
  });

  it("수선 프롬프트에는 원본 문제 대신 블루프린트와 실패 사유를 전달한다", async () => {
    const blueprint = passingBlueprint();
    const promptByStage: Record<string, string> = {};
    prismaMock.topic.findUnique.mockResolvedValue({ id: 2, name: "AWS", referenceDir: null });
    prismaMock.question.count.mockResolvedValue(0);
    prismaMock.question.findMany.mockResolvedValue([]);
    prismaMock.keyword.findMany.mockResolvedValue([]);
    prismaMock.questionGenerationJobData.update.mockResolvedValue({});
    const pending = pendingCommonJob(1);
    commonJobServiceMock.createPendingJob.mockResolvedValue(pending);
    const executionJob = commonSucceededJob({
      status: "RUNNING",
      finishedAt: null,
      topic: { id: 2, name: "AWS", referenceDir: null },
    });
    executionJob.questionGenerationData.stage = "RUNNING";
    executionJob.questionGenerationData.items = null;
    prismaMock.job.findUnique.mockResolvedValue(executionJob);
    commonJobRunnerMock.runClaimedJob.mockImplementation(async (jobId, options) => {
      const result = await options.execute({ job: pending, runToken: "run-token" });
      await options.persistResult(
        { questionGenerationJobData: { update: vi.fn() } },
        result,
        { id: jobId, type: "QUESTION_GENERATION", topicId: 2, questionId: null, parentJobId: null },
      );
      return "SUCCEEDED";
    });

    trackedRunMock.runTrackedEngine.mockImplementation(async (input: { stage: string; prompt: string }) => {
      const results: Record<string, unknown> = {
        BLUEPRINT: { blueprints: [blueprint] },
        GENERATION: { questions: [generatedQuestion] },
        VERIFY: { verdicts: [{ index: 0, verdict: "fail", comment: "검증 실패 사유" }] },
        ITEM_REPAIR: { verdict: "fail", comment: "자동 수선 완료", revised_question: generatedQuestion },
        REPAIR_VERIFY: { verdicts: [{ index: 0, verdict: "pass", comment: "" }] },
      };
      promptByStage[input.stage] = input.prompt;
      return {
        ok: true as const,
        resultText: JSON.stringify(results[input.stage]),
        runLogId: Object.keys(promptByStage).length,
        stdoutTail: "",
        stderrTail: "",
        exitCode: 0,
        timedOut: false,
        durationMs: 0,
      };
    });

    const created = await createJob({
      topicId: 2,
      engine: "CLAUDE",
      verifyEngine: "CODEX",
      instructions: "",
      correctAnswerCount: 1,
      choiceCount: 4,
      referenceFiles: [],
    });
    await runGenerationJob(created.id);

    expect(promptByStage.ITEM_REPAIR).toContain("검증 실패 사유");
    expect(promptByStage.ITEM_REPAIR).toContain('"testedDistinction":"managed versus self-managed"');
    expect(promptByStage.ITEM_REPAIR).not.toContain(generatedQuestion.question);
  });
});
