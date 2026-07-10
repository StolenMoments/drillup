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

vi.mock("../db", () => ({ prisma: prismaMock }));
vi.mock("../import-service", () => ({ importQuestions: importQuestionsMock }));

import { approveJob } from "./generation-service";

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
