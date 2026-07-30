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

const database = vi.hoisted(() => ({
  nextId: 1,
  jobs: [] as StoredJob[],
  details: new Map<number, { relation: string; data: Record<string, unknown> }>(),
  failDetailCreate: false,
}));

const prismaMock = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));

vi.mock("./db", () => ({ prisma: prismaMock }));

import {
  assertJobTarget,
  createPendingJob,
  retryJob,
  type CreatePendingJobInput,
} from "./job-service";

const detailRelations = [
  "questionGenerationData",
  "keywordTaggingData",
  "generationItemRevisionData",
  "choiceHardeningData",
  "noteTidyData",
  "answerExplanationData",
] as const;

function cloneJobs(): StoredJob[] {
  return database.jobs.map((job) => ({ ...job }));
}

function transactionClient() {
  return {
    $queryRaw: vi.fn().mockResolvedValue([{ id: 1 }]),
    job: {
      findUnique: vi.fn(async ({ where }: { where: { id: number } }) =>
        database.jobs.find((job) => job.id === where.id) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const relation = detailRelations.find((key) => key in data);
        if (!relation) throw new Error("detail relation missing");

        const nested = data[relation] as { create: Record<string, unknown> };
        const job: StoredJob = {
          id: database.nextId++,
          type: String(data.type),
          status: String(data.status ?? "PENDING"),
          engine: String(data.engine),
          topicId: (data.topicId as number | null | undefined) ?? null,
          questionId: (data.questionId as number | null | undefined) ?? null,
          parentJobId: (data.parentJobId as number | null | undefined) ?? null,
          retryOfJobId: (data.retryOfJobId as number | null | undefined) ?? null,
          runToken: null,
          errorMessage: null,
          createdAt: new Date("2026-07-30T00:00:00.000Z"),
          startedAt: null,
          heartbeatAt: null,
          finishedAt: null,
        };
        database.jobs.push(job);
        if (database.failDetailCreate) throw new Error("detail insert failed");
        database.details.set(job.id, { relation, data: structuredClone(nested.create) });
        return job;
      }),
    },
  };
}

function pendingNoteInput(overrides: Partial<CreatePendingJobInput> = {}) {
  return {
    type: "NOTE_TIDY" as const,
    engine: "CLAUDE" as const,
    target: { topicId: 7 },
    detail: {
      type: "NOTE_TIDY" as const,
      data: { sourceHash: "a".repeat(64) },
    },
    ...overrides,
  } as CreatePendingJobInput;
}

describe("common job service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    database.nextId = 1;
    database.jobs = [];
    database.details = new Map();
    database.failDetailCreate = false;
    prismaMock.$transaction.mockImplementation(
      async (callback: (tx: ReturnType<typeof transactionClient>) => Promise<unknown>) => {
        const jobsBefore = cloneJobs();
        const detailsBefore = new Map(database.details);
        const nextIdBefore = database.nextId;
        try {
          return await callback(transactionClient());
        } catch (error) {
          database.jobs = jobsBefore;
          database.details = detailsBefore;
          database.nextId = nextIdBefore;
          throw error;
        }
      },
    );
  });

  it.each([
    ["QUESTION_GENERATION", { questionId: 1 }],
    ["KEYWORD_TAGGING", { parentJobId: 1 }],
    ["NOTE_TIDY", { topicId: 0 }],
    ["CHOICE_HARDENING", { topicId: 1 }],
    ["ANSWER_EXPLANATION", { questionId: 1, topicId: 2 }],
    ["GENERATION_ITEM_REVISION", { questionId: 1 }],
  ])("rejects an invalid %s target", (type, target) => {
    expect(() => assertJobTarget(type, target)).toThrow(/target/i);
  });

  it("rejects a detail discriminator that does not match the job type", async () => {
    const input = pendingNoteInput({
      detail: {
        type: "ANSWER_EXPLANATION",
        data: { sourceHash: "a".repeat(64) },
      },
    } as Partial<CreatePendingJobInput>);

    await expect(createPendingJob(input)).rejects.toThrow(/detail/i);
    expect(database.jobs).toHaveLength(0);
  });

  it("atomically creates one PENDING job and exactly one matching detail", async () => {
    const created = await createPendingJob(pendingNoteInput());

    expect(created).toEqual({
      id: 1,
      type: "NOTE_TIDY",
      status: "PENDING",
      engine: "CLAUDE",
      topicId: 7,
      questionId: null,
      parentJobId: null,
      retryOfJobId: null,
      errorMessage: null,
      createdAt: "2026-07-30T00:00:00.000Z",
      startedAt: null,
      heartbeatAt: null,
      finishedAt: null,
    });
    expect(created).not.toHaveProperty("runToken");
    expect(database.jobs).toHaveLength(1);
    expect(database.details.get(1)).toEqual({
      relation: "noteTidyData",
      data: { sourceHash: "a".repeat(64) },
    });
  });

  it("rolls the job back when its detail cannot be created", async () => {
    database.failDetailCreate = true;

    await expect(createPendingJob(pendingNoteInput())).rejects.toThrow(
      "detail insert failed",
    );

    expect(database.jobs).toHaveLength(0);
    expect(database.details.size).toBe(0);
  });

  it("retries a terminal job as a new PENDING job with lineage", async () => {
    const original = await createPendingJob(pendingNoteInput());
    database.jobs[0].status = "FAILED";
    database.jobs[0].finishedAt = new Date("2026-07-30T00:01:00.000Z");

    const retried = await retryJob(original.id, pendingNoteInput({ engine: "CODEX" }));

    expect(retried).toMatchObject({
      id: 2,
      type: "NOTE_TIDY",
      status: "PENDING",
      engine: "CODEX",
      topicId: 7,
      retryOfJobId: 1,
    });
    expect(database.jobs[0]).toMatchObject({ id: 1, status: "FAILED" });
    expect(database.jobs[1]).toMatchObject({ id: 2, retryOfJobId: 1 });
  });

  it("rejects retry of a non-terminal job or a different type/target", async () => {
    const original = await createPendingJob(pendingNoteInput());

    await expect(retryJob(original.id, pendingNoteInput())).rejects.toThrow(/terminal/i);
    database.jobs[0].status = "SUCCEEDED";

    await expect(
      retryJob(original.id, pendingNoteInput({ target: { topicId: 8 } })),
    ).rejects.toThrow(/target/i);
    await expect(
      retryJob(
        original.id,
        {
          type: "ANSWER_EXPLANATION",
          engine: "CLAUDE",
          target: { questionId: 7 },
          detail: {
            type: "ANSWER_EXPLANATION",
            data: { sourceHash: "b".repeat(64) },
          },
        },
      ),
    ).rejects.toThrow(/type/i);
    expect(database.jobs).toHaveLength(1);
  });
});
