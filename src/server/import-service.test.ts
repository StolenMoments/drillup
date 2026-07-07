import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ImportQuestion } from "@/core/import-schema";

const prismaMock = vi.hoisted(() => ({
  topic: {
    findUnique: vi.fn(),
  },
  question: {
    create: vi.fn(),
  },
  srsState: {
    create: vi.fn(),
  },
  $transaction: vi.fn(),
}));

vi.mock("./db", () => ({ prisma: prismaMock }));

import { importQuestions } from "./import-service";

const validMcq: ImportQuestion = {
  type: "mcq",
  question: "1+1은?",
  choices: ["1", "2", "3", "4"],
  answer_index: 1,
  explanation: "기본 덧셈입니다.",
};

describe("importQuestions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.topic.findUnique.mockResolvedValue({ id: 1 });
    prismaMock.$transaction.mockImplementation(async (fn) => fn(prismaMock));
    prismaMock.question.create.mockResolvedValue({ id: 10 });
  });

  it("creates questions and default SRS state in one transaction", async () => {
    const count = await importQuestions(1, [validMcq]);

    expect(count).toBe(1);
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    expect(prismaMock.question.create).toHaveBeenCalledWith({
      data: {
        topicId: 1,
        type: "MCQ",
        payload: {
          question: "1+1은?",
          choices: ["1", "2", "3", "4"],
          answer_index: 1,
        },
        explanation: "기본 덧셈입니다.",
      },
      select: { id: true },
    });
    expect(prismaMock.srsState.create).toHaveBeenCalledWith({
      data: { questionId: 10 },
    });
  });

  it("returns NOT_FOUND when the topic does not exist", async () => {
    prismaMock.topic.findUnique.mockResolvedValue(null);

    await expect(importQuestions(999, [validMcq])).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });
});
