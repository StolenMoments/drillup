import { beforeEach, describe, expect, it, vi } from "vitest";

const afterMock = vi.hoisted(() => vi.fn());
const generationServiceMock = vi.hoisted(() => ({
  createJob: vi.fn(),
  listJobs: vi.fn(),
  runGenerationJob: vi.fn(),
}));

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: afterMock,
}));
vi.mock("@/server/generation/generation-service", () => generationServiceMock);

import { POST } from "./route";

function generationJob(status: "PENDING" | "SUCCEEDED") {
  return {
    id: 77,
    type: "QUESTION_GENERATION",
    status,
    engine: "CLAUDE",
    topicId: 2,
    questionId: null,
    parentJobId: null,
    retryOfJobId: null,
    errorMessage: null,
    createdAt: "2026-07-30T00:00:00.000Z",
    startedAt: null,
    heartbeatAt: null,
    finishedAt: status === "SUCCEEDED" ? "2026-07-30T00:01:00.000Z" : null,
    verifyEngine: "CODEX",
    instructions: "",
    referenceFiles: [],
    correctAnswerCount: 1,
    choiceCount: 4,
    stage: status === "SUCCEEDED" ? "SUCCEEDED" : "RUNNING",
    items: null,
    keywordItems: null,
    verifyWarning: null,
    approvedAt: null,
    savedCount: 0,
    sourceQuestionIds: null,
  };
}

function request(): Request {
  return new Request("http://localhost/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topicId: 2,
      engine: "CLAUDE",
      verifyEngine: "CODEX",
      instructions: "",
      correctAnswerCount: 1,
      choiceCount: 4,
      referenceFiles: [],
    }),
  });
}

describe("POST /api/generate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("keeps the { job } wrapper and schedules the new global PENDING id", async () => {
    const job = generationJob("PENDING");
    generationServiceMock.createJob.mockResolvedValue(job);

    const response = await POST(request());

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toEqual({ job });
    expect(afterMock).toHaveBeenCalledOnce();
    const scheduled = afterMock.mock.calls[0][0] as () => Promise<void>;
    await scheduled();
    expect(generationServiceMock.runGenerationJob).toHaveBeenCalledWith(77);
  });

  it("does not schedule a non-PENDING service result", async () => {
    const job = generationJob("SUCCEEDED");
    generationServiceMock.createJob.mockResolvedValue(job);

    const response = await POST(request());

    await expect(response.json()).resolves.toEqual({ job });
    expect(afterMock).not.toHaveBeenCalled();
  });
});
