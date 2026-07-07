import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "./errors";

const prismaMock = vi.hoisted(() => ({
  question: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("./db", () => ({ prisma: prismaMock }));

import {
  deleteQuestion,
  getQuestion,
  listQuestions,
  updateQuestion,
} from "./question-service";

describe("question-service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("maps question list rows to management DTOs", async () => {
    prismaMock.question.findMany.mockResolvedValue([
      {
        id: 2,
        topicId: 1,
        type: "MCQ",
        payload: {
          question:
            "This is a long question that should be trimmed to eighty characters for the list preview row.",
          choices: ["A", "B", "C", "D"],
          answer_index: 0,
        },
        reviewLogs: [{ isCorrect: true }, { isCorrect: false }],
        createdAt: new Date("2026-07-07T00:00:00.000Z"),
      },
    ]);

    const questions = await listQuestions(1);

    expect(prismaMock.question.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { topicId: 1 } }),
    );
    expect(questions).toEqual([
      {
        id: 2,
        topicId: 1,
        type: "MCQ",
        preview:
          "This is a long question that should be trimmed to eighty characters for the list...",
        attempts: 2,
        correctCount: 1,
        createdAt: "2026-07-07T00:00:00.000Z",
      },
    ]);
  });

  it("returns NOT_FOUND when a question does not exist", async () => {
    prismaMock.question.findUnique.mockResolvedValue(null);

    await expect(getQuestion(999)).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
  });

  it("validates edited payload against the existing question type", async () => {
    prismaMock.question.findUnique.mockResolvedValue({
      id: 1,
      topicId: 1,
      type: "MCQ",
      payload: {
        question: "Question?",
        choices: ["A", "B", "C", "D"],
        answer_index: 0,
      },
      explanation: null,
    });

    await expect(
      updateQuestion(1, {
        payload: {
          question: "Question?",
          choices: ["A", "B", "C", "D"],
          answer_index: 9,
        },
        explanation: null,
      }),
    ).rejects.toBeInstanceOf(ServiceError);
    expect(prismaMock.question.update).not.toHaveBeenCalled();
  });

  it("deletes existing questions", async () => {
    prismaMock.question.findUnique.mockResolvedValue({ id: 1 });

    await deleteQuestion(1);

    expect(prismaMock.question.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });
});
