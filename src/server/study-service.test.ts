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

import { ServiceError } from "./errors";
import { getStudyQueue, submitReview } from "./study-service";

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

  it("grades a valid selection from a six-choice MCQ", async () => {
    mocks.prisma.question.findUnique.mockResolvedValue({
      id: 1,
      type: "MCQ",
      payload: {
        question: "Which one is correct?",
        choices: ["A", "B", "C", "D", "E", "F"],
        answer_index: 5,
      },
      explanation: "F is correct.",
      srsState: null,
    });

    await expect(
      submitReview({
        questionId: 1,
        mode: "PRACTICE",
        answer: { type: "MCQ", selected_index: 5 },
      }),
    ).resolves.toEqual({
      isCorrect: true,
      explanation: "F is correct.",
      correct: { type: "MCQ", answer_index: 5 },
    });
    expect(mocks.prisma.reviewLog.create).toHaveBeenCalledOnce();
  });

  it("rejects an MCQ selection outside the question's choices", async () => {
    mocks.prisma.question.findUnique.mockResolvedValue({
      id: 1,
      type: "MCQ",
      payload: {
        question: "Which one is correct?",
        choices: ["A", "B", "C", "D"],
        answer_index: 1,
      },
      explanation: null,
      srsState: null,
    });

    await expect(
      submitReview({
        questionId: 1,
        mode: "PRACTICE",
        answer: { type: "MCQ", selected_index: 4 },
      }),
    ).rejects.toMatchObject<ServiceError>({
      code: "VALIDATION",
      status: 400,
    });
    expect(mocks.prisma.srsState.update).not.toHaveBeenCalled();
    expect(mocks.prisma.reviewLog.create).not.toHaveBeenCalled();
  });
});
