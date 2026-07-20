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

import {
  getStudyQuestion,
  getStudyQueue,
  submitReview,
} from "./study-service";

describe("study-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shuffles MCQ choices while preserving original indexes", async () => {
    mocks.prisma.srsState.findMany.mockResolvedValue([
      {
        question: {
          id: 1,
          topicId: 101,
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
        topicId: 101,
        type: "MCQ",
        question: "Which one is correct?",
        selectionCount: 1,
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

  it("returns one shuffled practice question without the answer", async () => {
    mocks.prisma.question.findUnique.mockResolvedValue({
      id: 7,
      topicId: 707,
      type: "MCQ",
      payload: {
        question: "Which option is correct?",
        choices: ["A", "B", "C", "D"],
        answer_index: 2,
      },
    });

    await expect(getStudyQuestion(7)).resolves.toEqual({
      id: 7,
      topicId: 707,
      type: "MCQ",
      question: "Which option is correct?",
      selectionCount: 1,
      choices: [
        { text: "D", original_index: 3 },
        { text: "C", original_index: 2 },
        { text: "B", original_index: 1 },
        { text: "A", original_index: 0 },
      ],
    });
  });

  it("returns NOT_FOUND when the requested practice question is missing", async () => {
    mocks.prisma.question.findUnique.mockResolvedValue(null);

    await expect(getStudyQuestion(404)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("returns a shuffled cloze word bank without blank answers", async () => {
    mocks.prisma.question.findUnique.mockResolvedValue({
      id: 8,
      topicId: 808,
      type: "CLOZE",
      payload: {
        text: "{{1}} is stored in {{2}}.",
        blanks: [
          { id: 1, answer: "Data" },
          { id: 2, answer: "S3" },
        ],
        distractors: ["Lambda", "DynamoDB"],
      },
    });

    await expect(getStudyQuestion(8)).resolves.toEqual({
      id: 8,
      topicId: 808,
      type: "CLOZE",
      text: "{{1}} is stored in {{2}}.",
      blankIds: [1, 2],
      wordBank: ["DynamoDB", "Lambda", "S3", "Data"],
    });
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
        answer: { type: "MCQ", selected_indices: [5] },
      }),
    ).resolves.toEqual({
      isCorrect: true,
      explanation: "F is correct.",
      correct: { type: "MCQ", answer_indices: [5], choice_explanations: null },
    });
    expect(mocks.prisma.reviewLog.create).toHaveBeenCalledOnce();
  });

  it("does not update SRS state for a single-question practice answer", async () => {
    mocks.prisma.question.findUnique.mockResolvedValue({
      id: 1,
      type: "MCQ",
      payload: {
        question: "Which one is correct?",
        choices: ["A", "B", "C", "D"],
        answer_index: 0,
      },
      explanation: null,
      srsState: {
        questionId: 1,
        easeFactor: 2.5,
        intervalDays: 6,
        repetitions: 2,
        lapses: 0,
      },
    });

    await submitReview({
      questionId: 1,
      mode: "PRACTICE",
      answer: { type: "MCQ", selected_indices: [0] },
    });

    expect(mocks.prisma.srsState.update).not.toHaveBeenCalled();
    expect(mocks.prisma.reviewLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ questionId: 1, mode: "PRACTICE" }),
    });
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
        answer: { type: "MCQ", selected_indices: [4] },
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION",
      status: 400,
    });
    expect(mocks.prisma.srsState.update).not.toHaveBeenCalled();
    expect(mocks.prisma.reviewLog.create).not.toHaveBeenCalled();
  });
});
