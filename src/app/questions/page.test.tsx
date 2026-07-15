// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const questionsMock = vi.hoisted(() => ({
  list: vi.fn(),
  remove: vi.fn(),
}));
const topicsMock = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
}));
const keywordsMock = vi.hoisted(() => ({ list: vi.fn() }));
const generateMock = vi.hoisted(() => ({ keywordTag: vi.fn() }));

vi.mock("@/lib/api-client", () => ({
  ApiError: class ApiError extends Error {
    constructor(public code: string, message: string, public status: number) {
      super(message);
    }
  },
  api: {
    questions: questionsMock,
    topics: topicsMock,
    keywords: keywordsMock,
    generate: generateMock,
  },
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import QuestionsPage from "./page";

function emptyPage() {
  return { items: [], page: 1, pageSize: 15, totalItems: 0, totalPages: 1 };
}

describe("문제 목록 검색", () => {
  beforeEach(() => {
    for (const mock of Object.values(questionsMock)) mock.mockReset();
    for (const mock of Object.values(topicsMock)) mock.mockReset();
    for (const mock of Object.values(keywordsMock)) mock.mockReset();
    topicsMock.list.mockResolvedValue([]);
    keywordsMock.list.mockResolvedValue({ keywords: [] });
    questionsMock.list.mockResolvedValue(emptyPage());
  });

  afterEach(() => cleanup());

  it("검색어 입력만으로는 재조회하지 않는다", async () => {
    await act(async () => {
      render(<QuestionsPage />);
    });
    const callCountBeforeTyping = questionsMock.list.mock.calls.length;

    fireEvent.change(screen.getByPlaceholderText("검색어"), {
      target: { value: "특별한 문제" },
    });

    expect(questionsMock.list.mock.calls.length).toBe(callCountBeforeTyping);
  });

  it("검색 제출 시 검색어와 선택된 필드로 재조회하고 페이지를 1로 리셋한다", async () => {
    await act(async () => {
      render(<QuestionsPage />);
    });

    fireEvent.change(screen.getByPlaceholderText("검색어"), {
      target: { value: "특별한 문제" },
    });
    fireEvent.click(screen.getByLabelText("키워드"));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "검색" }));
    });

    const lastCall = questionsMock.list.mock.calls.at(-1)?.[0];
    expect(lastCall).toMatchObject({
      search: "특별한 문제",
      searchIn: ["body", "keyword"],
      page: 1,
    });
  });
});
