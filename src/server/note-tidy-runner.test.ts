import { beforeEach, describe, expect, it, vi } from "vitest";
import { sha256Fingerprint } from "@/core/stable-json";

const prismaMock = vi.hoisted(() => ({
  noteTidyJob: {
    findUnique: vi.fn(),
    updateMany: vi.fn(),
  },
  topicNote: {
    findUnique: vi.fn(),
  },
}));
const runEngineMock = vi.hoisted(() => vi.fn());

vi.mock("./db", () => ({ prisma: prismaMock }));
vi.mock("./generation/run-engine", () => ({ runEngine: runEngineMock }));

import { runNoteTidyJob } from "./note-tidy-runner";

const sourceContent = "## 원본 노트\n- 항목";

function job(sourceHash: string) {
  return {
    id: 11,
    topicId: 7,
    sourceHash,
    engine: "CLAUDE" as const,
    status: "RUNNING" as const,
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

describe("note tidy runner", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    prismaMock.noteTidyJob.updateMany.mockResolvedValue({ count: 1 });
    prismaMock.noteTidyJob.findUnique.mockResolvedValue(
      job(await sha256Fingerprint(sourceContent)),
    );
    prismaMock.topicNote.findUnique.mockResolvedValue({ content: sourceContent });
    runEngineMock.mockResolvedValue(
      success(JSON.stringify({ note: "## 정리된 노트" })),
    );
  });

  it("시작 이후 노트가 변경되면 엔진을 실행하지 않고 FAILED로 마감한다", async () => {
    prismaMock.topicNote.findUnique.mockResolvedValue({ content: "변경된 노트" });

    await runNoteTidyJob(11);

    expect(runEngineMock).not.toHaveBeenCalled();
    expect(prismaMock.noteTidyJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: 11, status: "RUNNING" },
      data: {
        status: "FAILED",
        errorMessage: "정리 작업 시작 후 노트가 변경되어 작업을 중단했습니다",
        finishedAt: expect.any(Date),
      },
    });
  });

  it.each([
    [
      "job",
      () =>
        prismaMock.noteTidyJob.findUnique.mockRejectedValueOnce(
          new Error("job 조회 실패"),
        ),
    ],
    [
      "note",
      () =>
        prismaMock.topicNote.findUnique.mockRejectedValueOnce(
          new Error("note 조회 실패"),
        ),
    ],
  ])("claim 후 %s 조회 예외를 FAILED로 마감한다", async (_target, failLookup) => {
    failLookup();

    await expect(runNoteTidyJob(11)).resolves.toBeUndefined();

    expect(runEngineMock).not.toHaveBeenCalled();
    expect(prismaMock.noteTidyJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: 11, status: "RUNNING" },
      data: {
        status: "FAILED",
        errorMessage: expect.stringContaining("조회 실패"),
        finishedAt: expect.any(Date),
      },
    });
  });

  it("source hash가 일치하면 엔진 결과를 preview로 저장한다", async () => {
    await runNoteTidyJob(11);

    expect(runEngineMock).toHaveBeenCalledTimes(1);
    expect(prismaMock.noteTidyJob.updateMany).toHaveBeenLastCalledWith({
      where: { id: 11, status: "RUNNING" },
      data: {
        status: "SUCCEEDED",
        preview: "## 정리된 노트",
        errorMessage: null,
        finishedAt: expect.any(Date),
      },
    });
  });
});
