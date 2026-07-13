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
    const count = await importQuestions(1, [{ question: validMcq }]);

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
        testedDistinction: null,
      },
      select: { id: true },
    });
    expect(prismaMock.srsState.create).toHaveBeenCalledWith({
      data: { questionId: 10 },
    });
  });

  it("returns NOT_FOUND when the topic does not exist", async () => {
    prismaMock.topic.findUnique.mockResolvedValue(null);

    await expect(importQuestions(999, [{ question: validMcq }])).rejects.toMatchObject({
      code: "NOT_FOUND",
      status: 404,
    });
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("공백뿐인 explanation은 null로 저장한다", async () => {
    await importQuestions(1, [{ question: { ...validMcq, explanation: "   " } }]);

    expect(prismaMock.question.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ explanation: null }),
      }),
    );
  });

  it("explanation의 양끝 공백을 제거해 저장한다", async () => {
    await importQuestions(1, [{ question: { ...validMcq, explanation: "  해설  " } }]);

    expect(prismaMock.question.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ explanation: "해설" }),
      }),
    );
  });

  it("정답 2개(answer_indices)와 choice_explanations를 저장한다", async () => {
    const multiAnswerMcq: ImportQuestion = {
      type: "mcq",
      question: "다음 중 옳은 것을 2개 선택하세요.",
      choices: ["1", "2", "3", "4"],
      answer_indices: [0, 2],
      choice_explanations: ["첫 번째 설명", "두 번째 설명", "세 번째 설명", "네 번째 설명"],
      explanation: "정답 해설입니다.",
    };

    await importQuestions(1, [{ question: multiAnswerMcq }]);

    expect(prismaMock.question.create).toHaveBeenCalledWith({
      data: {
        topicId: 1,
        type: "MCQ",
        payload: {
          question: "다음 중 옳은 것을 2개 선택하세요.",
          choices: ["1", "2", "3", "4"],
          answer_indices: [0, 2],
          choice_explanations: ["첫 번째 설명", "두 번째 설명", "세 번째 설명", "네 번째 설명"],
        },
        explanation: "정답 해설입니다.",
        testedDistinction: null,
      },
      select: { id: true },
    });
  });

  it("testedDistinction을 함께 저장한다", async () => {
    await importQuestions(1, [
      { question: validMcq, testedDistinction: "  관리형 대 자체 운영 구분  " },
    ]);
    expect(prismaMock.question.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ testedDistinction: "관리형 대 자체 운영 구분" }),
      }),
    );
  });

  it("testedDistinction이 없으면 null로 저장한다", async () => {
    await importQuestions(1, [{ question: validMcq }]);
    expect(prismaMock.question.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ testedDistinction: null }),
      }),
    );
  });
});
