import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ jobRunLog: { create: vi.fn(), update: vi.fn() } }));
const runEngineMock = vi.hoisted(() => vi.fn());
vi.mock("../db", () => ({ prisma: prismaMock }));
vi.mock("./run-engine", () => ({ runEngine: runEngineMock }));

import { completeTrackedRun, failTrackedRun, runTrackedEngine } from "./tracked-run";

describe("runTrackedEngine", () => {
  beforeEach(() => { vi.clearAllMocks(); prismaMock.jobRunLog.create.mockResolvedValue({ id: 7 }); prismaMock.jobRunLog.update.mockResolvedValue({}); });

  it("creates a RUNNING row before running and saves a successful response", async () => {
    runEngineMock.mockResolvedValue({ ok: true, resultText: "{\"ok\":true}", stdoutTail: "out", stderrTail: "", exitCode: 0, timedOut: false, durationMs: 12 });
    await expect(runTrackedEngine({ jobId: 3, stage: "GENERATION", engine: "CODEX", prompt: "prompt", dir: "dir" })).resolves.toMatchObject({ ok: true, runLogId: 7 });
    expect(prismaMock.jobRunLog.create).toHaveBeenCalledWith({ data: expect.objectContaining({ jobId: 3, status: "RUNNING", prompt: "prompt" }), select: { id: true } });
    expect(prismaMock.jobRunLog.update).toHaveBeenCalledWith({ where: { id: 7 }, data: expect.objectContaining({ response: "{\"ok\":true}", stdoutTail: "out" }) });
  });

  it("closes timeout failures as FAILED", async () => {
    runEngineMock.mockResolvedValue({ ok: false, failureReason: "timeout", stdoutTail: "", stderrTail: "", exitCode: null, timedOut: true, durationMs: 10 });
    await runTrackedEngine({ jobId: 3, stage: "GENERATION", engine: "CODEX", prompt: "prompt", dir: "dir" });
    expect(prismaMock.jobRunLog.update).toHaveBeenCalledWith({ where: { id: 7 }, data: expect.objectContaining({ status: "FAILED", timedOut: true, errorMessage: "timeout" }) });
  });

  it("preserves an engine success when record creation fails", async () => {
    prismaMock.jobRunLog.create.mockRejectedValue(new Error("db down"));
    runEngineMock.mockResolvedValue({ ok: true, resultText: "ok", stdoutTail: "", stderrTail: "", exitCode: 0, timedOut: false, durationMs: 1 });
    await expect(runTrackedEngine({ jobId: 3, stage: "GENERATION", engine: "CODEX", prompt: "prompt", dir: "dir" })).resolves.toMatchObject({ ok: true, resultText: "ok", runLogId: null });
  });

  it("closes helper records", async () => {
    await completeTrackedRun(7);
    await failTrackedRun(8, "bad parse");
    expect(prismaMock.jobRunLog.update).toHaveBeenCalledWith({ where: { id: 7 }, data: expect.objectContaining({ status: "SUCCEEDED" }) });
    expect(prismaMock.jobRunLog.update).toHaveBeenCalledWith({ where: { id: 8 }, data: expect.objectContaining({ status: "FAILED", errorMessage: "bad parse" }) });
  });
});
