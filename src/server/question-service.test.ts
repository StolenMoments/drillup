import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "./errors";

const prismaMock = vi.hoisted(() => ({
  question: {
    findMany: vi.fn(),
    findUnique: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  },
  answerExplanation: {
    deleteMany: vi.fn(),
  },
  $transaction: vi.fn(async (operations: Promise<unknown>[]) =>
    Promise.all(operations),
  ),
}));

vi.mock("./db", () => ({ prisma: prismaMock }));

import {
  deleteQuestion,
  getQuestion,
  listQuestions,
  updateQuestion,
} from "./question-service";

function makeQuestion(input: {
  id: number;
  type?: "MCQ" | "CLOZE";
  correct?: number;
  wrong?: number;
  createdAt?: string;
}) {
  const type = input.type ?? "MCQ";
  return {
    id: input.id,
    topicId: 1,
    type,
    payload:
      type === "MCQ"
        ? {
            question: `Question ${input.id}`,
            choices: ["A", "B", "C", "D"],
            answer_index: 0,
          }
        : {
            text: `Cloze {{blank_${input.id}:answer}}`,
            blanks: [{ id: `blank_${input.id}`, answer: "answer" }],
          },
    reviewLogs: [
      ...Array.from({ length: input.correct ?? 0 }, () => ({
        isCorrect: true,
      })),
      ...Array.from({ length: input.wrong ?? 0 }, () => ({
        isCorrect: false,
      })),
    ],
    createdAt: new Date(input.createdAt ?? `2026-07-07T00:00:${String(input.id).padStart(2, "0")}.000Z`),
  };
}

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

    const questions = await listQuestions({ topicId: 1 });

    expect(prismaMock.question.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { topicId: 1 } }),
    );
    expect(questions.items).toEqual([
      expect.objectContaining({
        id: 2,
        topicId: 1,
        type: "MCQ",
        preview:
          "This is a long question that should be trimmed to eighty characters for the list...",
        attempts: 2,
        correctCount: 1,
        createdAt: "2026-07-07T00:00:00.000Z",
      }),
    ]);
    expect(questions).toMatchObject({
      page: 1,
      pageSize: 15,
      totalItems: 1,
      totalPages: 1,
    });
  });

  it("paginates question lists in pages of 15", async () => {
    prismaMock.question.findMany.mockResolvedValue(
      Array.from({ length: 20 }, (_, index) =>
        makeQuestion({ id: index + 1 }),
      ),
    );

    const page = await listQuestions({ page: 2 });

    expect(page).toMatchObject({
      page: 2,
      pageSize: 15,
      totalItems: 20,
      totalPages: 2,
    });
    expect(page.items).toHaveLength(5);
    expect(page.items.map((question) => question.id)).toEqual([5, 4, 3, 2, 1]);
  });

  it("filters questions by type", async () => {
    prismaMock.question.findMany.mockResolvedValue([
      makeQuestion({ id: 3, type: "MCQ" }),
      makeQuestion({ id: 2, type: "CLOZE" }),
      makeQuestion({ id: 1, type: "CLOZE" }),
    ]);

    const mcqPage = await listQuestions({ type: "MCQ" });
    const clozePage = await listQuestions({ type: "CLOZE" });

    expect(mcqPage.items.map((question) => question.type)).toEqual(["MCQ"]);
    expect(mcqPage.totalItems).toBe(1);
    expect(clozePage.items.map((question) => question.type)).toEqual([
      "CLOZE",
      "CLOZE",
    ]);
    expect(clozePage.totalItems).toBe(2);
  });

  it("sorts questions by low and high accuracy", async () => {
    prismaMock.question.findMany.mockResolvedValue([
      makeQuestion({ id: 1, correct: 1, wrong: 3 }),
      makeQuestion({ id: 2, correct: 3, wrong: 1 }),
      makeQuestion({ id: 3, correct: 1, wrong: 1 }),
    ]);

    const asc = await listQuestions({ sort: "accuracyAsc" });
    const desc = await listQuestions({ sort: "accuracyDesc" });

    expect(asc.items.map((question) => question.id)).toEqual([1, 3, 2]);
    expect(desc.items.map((question) => question.id)).toEqual([2, 3, 1]);
  });

  it("places unattempted questions last when sorting by accuracy", async () => {
    prismaMock.question.findMany.mockResolvedValue([
      makeQuestion({ id: 1, correct: 0, wrong: 0 }),
      makeQuestion({ id: 2, correct: 1, wrong: 0 }),
      makeQuestion({ id: 3, correct: 0, wrong: 1 }),
    ]);

    const asc = await listQuestions({ sort: "accuracyAsc" });
    const desc = await listQuestions({ sort: "accuracyDesc" });

    expect(asc.items.map((question) => question.id)).toEqual([3, 2, 1]);
    expect(desc.items.map((question) => question.id)).toEqual([2, 3, 1]);
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

  it("payload 갱신 시 캐시된 AI 해설을 삭제한다", async () => {
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
    prismaMock.question.update.mockResolvedValue({
      id: 1,
      topicId: 1,
      type: "MCQ",
      payload: {
        question: "Question?",
        choices: ["A", "B2", "C", "D"],
        answer_index: 0,
      },
      explanation: null,
      keywords: [],
    });

    const result = await updateQuestion(1, {
      payload: {
        question: "Question?",
        choices: ["A", "B2", "C", "D"],
        answer_index: 0,
      },
      explanation: null,
    });

    expect(prismaMock.answerExplanation.deleteMany).toHaveBeenCalledWith({
      where: { questionId: 1 },
    });
    expect(result).toMatchObject({ id: 1 });
  });

  it("deletes existing questions", async () => {
    prismaMock.question.findUnique.mockResolvedValue({ id: 1 });

    await deleteQuestion(1);

    expect(prismaMock.question.delete).toHaveBeenCalledWith({ where: { id: 1 } });
  });
});
