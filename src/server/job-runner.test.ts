import { beforeEach, describe, expect, it, vi } from "vitest";

type StoredJob = {
  id: number;
  type: string;
  status: string;
  engine: string;
  topicId: number | null;
  questionId: number | null;
  parentJobId: number | null;
  retryOfJobId: number | null;
  runToken: string | null;
  errorMessage: string | null;
  createdAt: Date;
  startedAt: Date | null;
  heartbeatAt: Date | null;
  finishedAt: Date | null;
};

type StoredLog = {
  id: number;
  jobId: number;
  status: string;
  startedAt: Date;
  finishedAt: Date | null;
  errorMessage: string | null;
  stdoutTail?: string | null;
  stderrTail?: string | null;
};

const database = vi.hoisted(() => ({
  jobs: [] as StoredJob[],
  logs: [] as StoredLog[],
  detailPreview: null as string | null,
  generationStage: null as string | null,
  transactionOperations: [] as string[],
  failLogCreate: false,
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
  job: {
    updateMany: vi.fn(),
    findUnique: vi.fn(),
    findMany: vi.fn(),
  },
  jobRunLog: {
    create: vi.fn(),
  },
}));

vi.mock("./db", () => ({ prisma: prismaMock }));

import {
  JOB_HEARTBEAT_INTERVAL_MS,
  claimJob,
  completeJob,
  failJob,
  heartbeatJob,
  recoverStaleJobs,
  runClaimedJob,
  updateJobProgress,
  writeJobRunLog,
} from "./job-runner";

function makeJob(overrides: Partial<StoredJob> = {}): StoredJob {
  return {
    id: 1,
    type: "NOTE_TIDY",
    status: "PENDING",
    engine: "CLAUDE",
    topicId: 7,
    questionId: null,
    parentJobId: null,
    retryOfJobId: null,
    runToken: null,
    errorMessage: null,
    createdAt: new Date("2026-07-30T00:00:00.000Z"),
    startedAt: null,
    heartbeatAt: null,
    finishedAt: null,
    ...overrides,
  };
}

function matchesWhere(job: StoredJob, where: Record<string, unknown>): boolean {
  if (where.id !== undefined && job.id !== where.id) return false;
  if (where.status !== undefined && job.status !== where.status) return false;
  if (where.runToken !== undefined && job.runToken !== where.runToken) return false;
  return true;
}

function updateJobs(args: {
  where: Record<string, unknown>;
  data: Record<string, unknown>;
}) {
  let count = 0;
  for (const job of database.jobs) {
    if (!matchesWhere(job, args.where)) continue;
    Object.assign(job, args.data);
    count += 1;
  }
  return { count };
}

function transactionClient() {
  return {
    job: {
      findUnique: vi.fn(async ({ where }: { where: { id: number } }) =>
        database.jobs.find((job) => job.id === where.id) ?? null,
      ),
      updateMany: vi.fn(async (args: {
        where: Record<string, unknown>;
        data: Record<string, unknown>;
      }) => {
        database.transactionOperations.push("job");
        return updateJobs(args);
      }),
    },
    jobRunLog: {
      updateMany: vi.fn(async ({ where, data }: {
        where: { jobId: number; status: string };
        data: Record<string, unknown>;
      }) => {
        database.transactionOperations.push("logs");
        let count = 0;
        for (const log of database.logs) {
          if (log.jobId !== where.jobId || log.status !== where.status) continue;
          Object.assign(log, data);
          count += 1;
        }
        return { count };
      }),
    },
    noteTidyJobData: {
      update: vi.fn(async ({ data }: { data: { preview: string } }) => {
        database.detailPreview = data.preview;
      }),
    },
    questionGenerationJobData: {
      updateMany: vi.fn(async ({ data }: { data: { stage: string } }) => {
        database.transactionOperations.push("detail");
        database.generationStage = data.stage;
        return { count: 1 };
      }),
    },
  };
}

function installDatabaseDouble() {
  prismaMock.job.updateMany.mockImplementation(async (args) => updateJobs(args));
  prismaMock.job.findUnique.mockImplementation(async ({ where }: { where: { id: number } }) =>
    database.jobs.find((job) => job.id === where.id) ?? null,
  );
  prismaMock.job.findMany.mockImplementation(async () =>
    database.jobs.filter((job) => job.status === "RUNNING"),
  );
  prismaMock.jobRunLog.create.mockImplementation(async ({ data }) => {
    if (database.failLogCreate) throw new Error("log unavailable");
    const created = {
      id: database.logs.length + 1,
      status: "RUNNING",
      startedAt: new Date(),
      finishedAt: null,
      errorMessage: null,
      ...data,
    } as StoredLog;
    database.logs.push(created);
    return created;
  });
  prismaMock.$transaction.mockImplementation(
    async (callback: (tx: ReturnType<typeof transactionClient>) => Promise<unknown>) => {
      const jobsBefore = database.jobs.map((job) => ({ ...job }));
      const logsBefore = database.logs.map((log) => ({ ...log }));
      const detailBefore = database.detailPreview;
      const generationStageBefore = database.generationStage;
      try {
        return await callback(transactionClient());
      } catch (error) {
        database.jobs = jobsBefore;
        database.logs = logsBefore;
        database.detailPreview = detailBefore;
        database.generationStage = generationStageBefore;
        throw error;
      }
    },
  );
}

describe("common job runner", () => {
  beforeEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
    database.jobs = [makeJob()];
    database.logs = [];
    database.detailPreview = null;
    database.generationStage = null;
    database.transactionOperations = [];
    database.failLogCreate = false;
    installDatabaseDouble();
  });

  it("allows exactly one concurrent claimant and gives it a UUID token", async () => {
    const [first, second] = await Promise.all([claimJob(1), claimJob(1)]);
    const claims = [first, second].filter((claim) => claim !== null);

    expect(claims).toHaveLength(1);
    expect(claims[0]?.runToken).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(claims[0]?.job).not.toHaveProperty("runToken");
    expect(database.jobs[0]).toMatchObject({ status: "RUNNING" });
  });

  it("heartbeats only the RUNNING job owned by the token", async () => {
    const claim = await claimJob(1);
    if (!claim) throw new Error("claim missing");
    const before = database.jobs[0].heartbeatAt;

    await expect(heartbeatJob(1, "foreign-token")).resolves.toBe(false);
    expect(database.jobs[0].heartbeatAt).toEqual(before);
    await new Promise((resolve) => setTimeout(resolve, 2));
    await expect(heartbeatJob(1, claim.runToken)).resolves.toBe(true);
    expect(database.jobs[0].heartbeatAt?.getTime()).toBeGreaterThanOrEqual(
      before?.getTime() ?? 0,
    );
  });

  it("does not persist a result or finish for a foreign token", async () => {
    const claim = await claimJob(1);
    if (!claim) throw new Error("claim missing");

    await expect(
      completeJob(1, "foreign-token", async (tx) => {
        await tx.noteTidyJobData.update({
          where: { jobId: 1 },
          data: { preview: "should not save" },
        });
      }),
    ).resolves.toBe(false);

    expect(database.detailPreview).toBeNull();
    expect(database.jobs[0]).toMatchObject({ status: "RUNNING", runToken: claim.runToken });
  });

  it("persists detail result and SUCCEEDED atomically for the owner", async () => {
    const claim = await claimJob(1);
    if (!claim) throw new Error("claim missing");

    await expect(
      completeJob(1, claim.runToken, async (tx, identity) => {
        expect(identity).toEqual({
          id: 1,
          type: "NOTE_TIDY",
          topicId: 7,
          questionId: null,
          parentJobId: null,
        });
        await tx.noteTidyJobData.update({
          where: { jobId: identity.id },
          data: { preview: "saved result" },
        });
      }),
    ).resolves.toBe(true);

    expect(database.detailPreview).toBe("saved result");
    expect(database.jobs[0]).toMatchObject({
      status: "SUCCEEDED",
      runToken: null,
      errorMessage: null,
      finishedAt: expect.any(Date),
    });
  });

  it("rolls back a failed detail save, fenced-fails the job, and rethrows the original error", async () => {
    const claim = await claimJob(1);
    if (!claim) throw new Error("claim missing");
    const saveError = new Error("result persistence failed");

    await expect(
      completeJob(1, claim.runToken, async (tx) => {
        await tx.noteTidyJobData.update({
          where: { jobId: 1 },
          data: { preview: "rolled back" },
        });
        throw saveError;
      }),
    ).rejects.toBe(saveError);

    expect(database.detailPreview).toBeNull();
    expect(database.jobs[0]).toMatchObject({
      status: "FAILED",
      runToken: null,
      errorMessage: "result persistence failed",
      finishedAt: expect.any(Date),
    });
  });

  it("fails only the RUNNING job owned by the token", async () => {
    const claim = await claimJob(1);
    if (!claim) throw new Error("claim missing");

    await expect(failJob(1, "foreign-token", "wrong worker")).resolves.toBe(false);
    await expect(failJob(1, claim.runToken, "engine failed")).resolves.toBe(true);
    expect(database.jobs[0]).toMatchObject({
      status: "FAILED",
      runToken: null,
      errorMessage: "engine failed",
    });
  });

  it("stops as FENCED without persisting progress after the run token is lost", async () => {
    const outcome = await runClaimedJob(1, {
      execute: async (claim) => {
        await failJob(1, claim.runToken, "stale recovery won");
        await updateJobProgress(1, claim.runToken, async (tx) => {
          await tx.noteTidyJobData.update({
            where: { jobId: 1 },
            data: { preview: "must not save" },
          });
        });
        return "unreachable";
      },
      persistResult: async () => undefined,
    });

    expect(outcome).toBe("FENCED");
    expect(database.detailPreview).toBeNull();
    expect(database.jobs[0]).toMatchObject({
      status: "FAILED",
      runToken: null,
      errorMessage: "stale recovery won",
    });
  });

  it("recovers stale jobs, closes RUNNING child logs, and fences the late runner", async () => {
    const staleToken = "11111111-1111-4111-8111-111111111111";
    database.jobs = [
      makeJob({
        status: "RUNNING",
        runToken: staleToken,
        startedAt: new Date("2026-07-30T00:00:00.000Z"),
        heartbeatAt: new Date("2026-07-30T00:01:00.000Z"),
      }),
    ];
    database.logs = [{
      id: 1,
      jobId: 1,
      status: "RUNNING",
      startedAt: new Date("2026-07-30T00:00:30.000Z"),
      finishedAt: null,
      errorMessage: null,
    }];
    const previousTimeout = process.env.GENERATION_TIMEOUT_MS;
    process.env.GENERATION_TIMEOUT_MS = "1000";
    try {
      await expect(
        recoverStaleJobs(new Date("2026-07-30T00:03:01.001Z")),
      ).resolves.toBe(1);
    } finally {
      if (previousTimeout === undefined) delete process.env.GENERATION_TIMEOUT_MS;
      else process.env.GENERATION_TIMEOUT_MS = previousTimeout;
    }

    expect(database.jobs[0]).toMatchObject({
      status: "FAILED",
      runToken: null,
      finishedAt: new Date("2026-07-30T00:03:01.001Z"),
    });
    expect(database.logs[0]).toMatchObject({
      status: "FAILED",
      finishedAt: new Date("2026-07-30T00:03:01.001Z"),
      errorMessage: expect.stringMatching(/stale/i),
    });
    await expect(heartbeatJob(1, staleToken)).resolves.toBe(false);
    await expect(completeJob(1, staleToken, async () => undefined)).resolves.toBe(false);
  });

  it("recovers a stale question generation job and closes its detail stage atomically", async () => {
    database.jobs = [makeJob({
      type: "QUESTION_GENERATION",
      status: "RUNNING",
      runToken: "11111111-1111-4111-8111-111111111111",
      startedAt: new Date("2026-07-30T00:00:00.000Z"),
      heartbeatAt: new Date("2026-07-30T00:01:00.000Z"),
    })];
    database.generationStage = "VERIFYING";
    const previousTimeout = process.env.GENERATION_TIMEOUT_MS;
    process.env.GENERATION_TIMEOUT_MS = "1000";
    try {
      await recoverStaleJobs(new Date("2026-07-30T00:03:01.001Z"));
    } finally {
      if (previousTimeout === undefined) delete process.env.GENERATION_TIMEOUT_MS;
      else process.env.GENERATION_TIMEOUT_MS = previousTimeout;
    }

    expect(database.jobs[0].status).toBe("FAILED");
    expect(database.generationStage).toBe("FAILED");
  });

  it("locks the Job before closing logs and generation detail during stale recovery", async () => {
    database.jobs = [makeJob({
      type: "QUESTION_GENERATION",
      status: "RUNNING",
      runToken: "11111111-1111-4111-8111-111111111111",
      startedAt: new Date("2026-07-30T00:00:00.000Z"),
      heartbeatAt: new Date("2026-07-30T00:01:00.000Z"),
    })];
    database.logs = [{
      id: 1,
      jobId: 1,
      status: "RUNNING",
      startedAt: new Date("2026-07-30T00:00:30.000Z"),
      finishedAt: null,
      errorMessage: null,
    }];
    const previousTimeout = process.env.GENERATION_TIMEOUT_MS;
    process.env.GENERATION_TIMEOUT_MS = "1000";
    try {
      await recoverStaleJobs(new Date("2026-07-30T00:03:01.001Z"));
    } finally {
      if (previousTimeout === undefined) delete process.env.GENERATION_TIMEOUT_MS;
      else process.env.GENERATION_TIMEOUT_MS = previousTimeout;
    }

    expect(database.transactionOperations).toEqual(["job", "logs", "detail"]);
  });

  it("treats run log persistence as best effort and tails diagnostics", async () => {
    const input = {
      jobId: 1,
      stage: "NOTE_TIDY" as const,
      engine: "CLAUDE" as const,
      prompt: "prompt",
      stdoutTail: `prefix-${"o".repeat(8_010)}`,
      stderrTail: `prefix-${"e".repeat(8_010)}`,
    };
    database.failLogCreate = true;
    await expect(writeJobRunLog(input)).resolves.toBeNull();
    expect(database.jobs[0].status).toBe("PENDING");

    database.failLogCreate = false;
    const log = await writeJobRunLog(input);
    expect(log?.stdoutTail).toBe("o".repeat(8_000));
    expect(log?.stderrTail).toBe("e".repeat(8_000));
  });

  it("heartbeats a claimed job every 30 seconds while common work runs", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-30T00:00:00.000Z"));
    let releaseWork: (() => void) | undefined;
    const work = new Promise<string>((resolve) => {
      releaseWork = () => resolve("preview");
    });
    const runPromise = runClaimedJob(1, {
      execute: async () => work,
      persistResult: async (tx, result) => {
        await tx.noteTidyJobData.update({
          where: { jobId: 1 },
          data: { preview: result },
        });
      },
    });
    await vi.advanceTimersByTimeAsync(0);
    const initialHeartbeat = database.jobs[0].heartbeatAt;

    expect(JOB_HEARTBEAT_INTERVAL_MS).toBe(30_000);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(database.jobs[0].heartbeatAt?.getTime()).toBe(
      (initialHeartbeat?.getTime() ?? 0) + 30_000,
    );
    releaseWork?.();
    await expect(runPromise).resolves.toBe("SUCCEEDED");
    expect(database.detailPreview).toBe("preview");
    vi.useRealTimers();
  });
});
