// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const routerMock = vi.hoisted(() => ({ replace: vi.fn() }));
const questionsMock = vi.hoisted(() => ({
  applyHardenChoices: vi.fn(), dismissHardenChoices: vi.fn(), hardenChoices: vi.fn(),
  reviewFact: vi.fn(), update: vi.fn(),
}));
const hardenJobsMock = vi.hoisted(() => ({ summary: vi.fn(), page: vi.fn(), pendingCount: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => routerMock }));
vi.mock("@/lib/api-client", () => ({
  ApiError: class ApiError extends Error {},
  api: { questions: questionsMock, hardenJobs: hardenJobsMock },
}));

import HardeningStatusPage from "./HardeningStatusPage";

function item() {
  return {
    id: 11, questionId: 7, sourceHash: "a".repeat(64), engine: "CLAUDE" as const,
    verifyEngine: "CLAUDE" as const, attempt: 1, status: "SUCCEEDED" as const,
    stage: "GENERATING" as const,
    preview: { engine: "CLAUDE" as const, comment: "강화 완료", factualConcern: null,
      payload: { question: "질문", choices: ["정답", "새 오답1", "새 오답2", "새 오답3"], answer_indices: [0], choice_explanations: ["", "", "", ""] } },
    errorMessage: null, createdAt: "2026-07-15T00:00:00.000Z", startedAt: null,
    finishedAt: "2026-07-15T00:01:00.000Z", appliedAt: null, autoApplied: false,
    dismissedAt: null, questionPreview: "질문", topicName: "AWS",
    source: { question: "질문", choices: ["정답", "오답1", "오답2", "오답3"] },
  };
}

function page(items = [item()], currentPage = 2, totalItems = 25, totalPages = 3) {
  return { items, page: currentPage, pageSize: 10 as const, totalItems, totalPages };
}

describe("선지 검토 상태 상세 페이지", () => {
  beforeEach(() => {
    routerMock.replace.mockReset();
    for (const mock of Object.values(questionsMock)) mock.mockReset();
    for (const mock of Object.values(hardenJobsMock)) mock.mockReset();
    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
  });
  afterEach(() => cleanup());

  it("현재 페이지의 10건과 표시 범위 및 이전/다음 링크를 렌더한다", async () => {
    hardenJobsMock.page.mockResolvedValue(page());
    await act(async () => { render(<HardeningStatusPage status="pending" initialPage={2} />); });
    expect(screen.getByText("승인 대기 · 25건")).toBeVisible();
    expect(screen.getByText("2 / 3 페이지")).toBeVisible();
    expect(screen.getByText("11-20 / 25건")).toBeVisible();
    expect(screen.getByRole("link", { name: "이전" })).toHaveAttribute("href", "/hardening/pending?page=1");
    expect(screen.getByRole("link", { name: "다음" })).toHaveAttribute("href", "/hardening/pending?page=3");
  });

  it("마지막 항목 처리 후 서버가 보정한 페이지로 URL을 교체한다", async () => {
    hardenJobsMock.page
      .mockResolvedValueOnce(page([item()], 2, 11, 2))
      .mockResolvedValueOnce(page([], 1, 10, 1));
    questionsMock.dismissHardenChoices.mockResolvedValue({ ok: true });
    await act(async () => { render(<HardeningStatusPage status="pending" initialPage={2} />); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "🗑 거절" })); });
    expect(hardenJobsMock.page).toHaveBeenLastCalledWith("pending", 2);
    expect(routerMock.replace).toHaveBeenCalledWith("/hardening/pending?page=1", { scroll: false });
  });
});
