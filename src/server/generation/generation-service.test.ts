import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  generationJob: {
    findUnique: vi.fn(),
    update: vi.fn(),
  },
  generationItemRevision: {
    findMany: vi.fn(),
  },
}));
const importQuestionsMock = vi.hoisted(() => vi.fn());
const trackedRunMock = vi.hoisted(() => ({
  runTrackedEngine: vi.fn(),
  completeTrackedRun: vi.fn(),
  failTrackedRun: vi.fn(),
}));

vi.mock("../db", () => ({ prisma: prismaMock }));
vi.mock("../import-service", () => ({ importQuestions: importQuestionsMock }));
vi.mock("./tracked-run", () => trackedRunMock);

import type { QuestionBlueprint } from "@/core/question-blueprint";
import { approveJob, repairGateFailures } from "./generation-service";

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
    status: "SUCCEEDED",
    kind: "QUESTION",
    result: [{ index: 0, ok: true, question: originalQuestion, verdict: "fail", verdictComment: "수정 필요" }],
    errorMessage: null,
    verifyWarning: null,
    createdAt: new Date("2026-07-11T00:00:00.000Z"),
    finishedAt: new Date("2026-07-11T00:01:00.000Z"),
    approvedAt: null,
    savedCount: 0,
    sourceQuestionIds: null,
  };
}

describe("approveJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.generationJob.findUnique.mockResolvedValue(succeededJob());
    prismaMock.generationJob.update.mockResolvedValue({ ...succeededJob(), approvedAt: new Date("2026-07-11T00:02:00.000Z"), savedCount: 1 });
    importQuestionsMock.mockResolvedValue(1);
  });

  it("saves an applied revision even when the original verification verdict failed", async () => {
    prismaMock.generationItemRevision.findMany.mockResolvedValue([
      { itemIndex: 0, appliedQuestion: revisedQuestion },
    ]);

    await expect(approveJob(1, [0])).resolves.toMatchObject({ savedCount: 1 });
    expect(importQuestionsMock).toHaveBeenCalledWith(2, [revisedQuestion]);
  });

  it("still rejects an original question whose verification verdict failed", async () => {
    prismaMock.generationItemRevision.findMany.mockResolvedValue([]);

    await expect(approveJob(1, [0])).rejects.toMatchObject({
      code: "INVALID_ITEMS",
      status: 400,
    });
    expect(importQuestionsMock).not.toHaveBeenCalled();
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
    generationJobId: 50,
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

  it("수선 프롬프트에 위반 코드·메시지·게이트 규칙을 담아 보낸다", async () => {
    trackedRunMock.runTrackedEngine.mockResolvedValueOnce(engineSuccess([passingBlueprint()], 7));

    const result = await repairGateFailures({ ...input(), blueprints: [failingBlueprint()] });

    expect(result.passed).toHaveLength(1);
    const call = trackedRunMock.runTrackedEngine.mock.calls[0][0];
    expect(call).toMatchObject({ generationJobId: 50, stage: "BLUEPRINT_REPAIR", attempt: 1 });
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
