import type { NoteTidyJob } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  topic: { findUnique: vi.fn() },
  topicNote: { findUnique: vi.fn() },
  noteTidyJob: {
    findFirst: vi.fn(),
    findUnique: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("./db", () => ({ prisma: prismaMock }));

import { dismissNoteTidyJob, startNoteTidyJob } from "./note-service";

function job(overrides: Partial<NoteTidyJob> = {}): NoteTidyJob {
  return {
    id: 11,
    topicId: 7,
    sourceHash: "a".repeat(64),
    engine: "CLAUDE",
    status: "RUNNING",
    preview: null,
    errorMessage: null,
    createdAt: new Date("2026-07-20T00:00:00.000Z"),
    startedAt: null,
    finishedAt: null,
    appliedAt: null,
    dismissedAt: null,
    ...overrides,
  };
}

function transactionClient(jobValue: NoteTidyJob | null = null) {
  return {
    $queryRaw: vi.fn().mockResolvedValue([]),
    topic: { findUnique: vi.fn().mockResolvedValue({ id: 7 }) },
    topicNote: {
      findUnique: vi.fn().mockResolvedValue({
        id: 3,
        topicId: 7,
        content: "정리할 노트",
        createdAt: new Date("2026-07-20T00:00:00.000Z"),
        updatedAt: new Date("2026-07-20T00:00:00.000Z"),
      }),
    },
    noteTidyJob: {
      findFirst: vi.fn().mockResolvedValue(null),
      findUnique: vi.fn().mockResolvedValue(jobValue),
      create: vi.fn().mockResolvedValue(job()),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
}

describe("note service concurrency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.noteTidyJob.updateMany.mockResolvedValue({ count: 0 });
    prismaMock.topic.findUnique.mockResolvedValue({ id: 7 });
    prismaMock.topicNote.findUnique.mockResolvedValue({
      id: 3,
      topicId: 7,
      content: "정리할 노트",
      createdAt: new Date("2026-07-20T00:00:00.000Z"),
      updatedAt: new Date("2026-07-20T00:00:00.000Z"),
    });
    prismaMock.noteTidyJob.findFirst.mockResolvedValue(null);
    prismaMock.noteTidyJob.create.mockResolvedValue(job());
  });

  it("주제 행 잠금 뒤 같은 transaction에서 활성 job을 확인하고 생성한다", async () => {
    const tx = transactionClient();
    prismaMock.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(startNoteTidyJob(7, "CLAUDE")).resolves.toMatchObject({
      id: 11,
      topicId: 7,
      status: "RUNNING",
    });

    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const lockSql = Array.from(
      tx.$queryRaw.mock.calls[0][0] as TemplateStringsArray,
    ).join(" ");
    expect(lockSql).toContain("FROM topic");
    expect(lockSql).toContain("FOR UPDATE");
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.topic.findUnique.mock.invocationCallOrder[0],
    );
    expect(tx.noteTidyJob.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      }),
    );
    expect(tx.noteTidyJob.create).toHaveBeenCalledTimes(1);
    expect(prismaMock.topic.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.topicNote.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.noteTidyJob.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.noteTidyJob.create).not.toHaveBeenCalled();
  });

  it("주제 행 잠금 뒤 발견한 활성 job은 기존 409 계약으로 거부한다", async () => {
    const tx = transactionClient();
    tx.noteTidyJob.findFirst.mockResolvedValue(job());
    prismaMock.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(startNoteTidyJob(7, "CLAUDE")).rejects.toMatchObject({
      code: "NOTE_TIDY_ACTIVE_EXISTS",
      status: 409,
      message: "이미 진행 중인 정리 작업이 있습니다",
    });

    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.noteTidyJob.findFirst.mock.invocationCallOrder[0],
    );
    expect(tx.noteTidyJob.create).not.toHaveBeenCalled();
    expect(prismaMock.noteTidyJob.findFirst).not.toHaveBeenCalled();
    expect(prismaMock.noteTidyJob.create).not.toHaveBeenCalled();
  });

  it("dismiss는 job 잠금 후 확인된 applied 상태를 409로 반환한다", async () => {
    const tx = transactionClient(
      job({
        status: "SUCCEEDED",
        preview: "정리된 노트",
        appliedAt: new Date("2026-07-20T00:02:00.000Z"),
      }),
    );
    prismaMock.noteTidyJob.findUnique.mockResolvedValue(
      job({ status: "SUCCEEDED", preview: "정리된 노트" }),
    );
    prismaMock.$transaction.mockImplementation(
      async (callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
    );

    await expect(dismissNoteTidyJob(11)).rejects.toMatchObject({
      code: "NOTE_TIDY_ALREADY_APPLIED",
      status: 409,
      message: "이미 반영된 작업은 폐기할 수 없습니다",
    });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    const lockSql = Array.from(
      tx.$queryRaw.mock.calls[0][0] as TemplateStringsArray,
    ).join(" ");
    expect(lockSql).toContain("FROM note_tidy_job");
    expect(lockSql).toContain("FOR UPDATE");
    expect(tx.$queryRaw.mock.invocationCallOrder[0]).toBeLessThan(
      tx.noteTidyJob.findUnique.mock.invocationCallOrder[0],
    );
    expect(tx.noteTidyJob.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.noteTidyJob.findUnique).not.toHaveBeenCalled();
    expect(prismaMock.noteTidyJob.updateMany).not.toHaveBeenCalled();
  });
});
