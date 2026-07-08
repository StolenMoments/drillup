import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    srsState: {
      findMany: vi.fn(),
      update: vi.fn(),
    },
    question: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    reviewLog: {
      create: vi.fn(),
    },
  },
  shuffle: vi.fn(<T>(items: readonly T[]) => [...items].reverse()),
}));

vi.mock("./db", () => ({ prisma: mocks.prisma }));
vi.mock("@/core/random", () => ({ shuffle: mocks.shuffle }));

import { getStudyQueue } from "./study-service";

describe("study-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shuffles MCQ choices while preserving original indexes", async () => {
    mocks.prisma.srsState.findMany.mockResolvedValue([
      {
        question: {
          id: 1,
          type: "MCQ",
          payload: {
            question: "Which one is correct?",
            choices: ["A", "B", "C", "D"],
            answer_index: 1,
          },
        },
      },
    ]);

    const queue = await getStudyQueue("srs");

    expect(queue).toEqual([
      {
        id: 1,
        type: "MCQ",
        question: "Which one is correct?",
        choices: [
          { text: "D", original_index: 3 },
          { text: "C", original_index: 2 },
          { text: "B", original_index: 1 },
          { text: "A", original_index: 0 },
        ],
      },
    ]);
    expect(queue[0]).not.toHaveProperty("answer_index");
  });
});
