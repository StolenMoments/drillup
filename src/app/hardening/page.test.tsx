// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const questionsMock = vi.hoisted(() => ({
  applyHardenChoices: vi.fn(),
  dismissHardenChoices: vi.fn(),
  hardenChoices: vi.fn(),
  reviewFact: vi.fn(),
  update: vi.fn(),
}));
const hardenJobsMock = vi.hoisted(() => ({
  summary: vi.fn(),
  page: vi.fn(),
  pendingCount: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  ApiError: class ApiError extends Error {
    constructor(public code: string, message: string, public status: number) {
      super(message);
    }
  },
  api: { questions: questionsMock, hardenJobs: hardenJobsMock },
}));

import HardeningReviewPage from "./page";

function listItem(overrides: Record<string, unknown> = {}) {
  return {
    id: 11, questionId: 7, sourceHash: "a".repeat(64), engine: "CLAUDE" as const,
    verifyEngine: "CLAUDE" as const, attempt: 1, status: "SUCCEEDED" as const,
    stage: "GENERATING" as const,
    preview: { engine: "CLAUDE" as const, comment: "오답을 더 어렵게 바꿨습니다", factualConcern: null,
      payload: { question: "원본 질문", choices: ["정답", "강화 오답 1", "강화 오답 2", "강화 오답 3"], answer_indices: [0], choice_explanations: ["근거", "근거", "근거", "근거"] } },
    errorMessage: null, createdAt: "2026-07-15T00:00:00.000Z", startedAt: "2026-07-15T00:00:01.000Z", finishedAt: "2026-07-15T00:01:00.000Z", appliedAt: null, autoApplied: false, dismissedAt: null,
    questionPreview: "원본 질문", topicName: "AWS", source: { question: "원본 질문", choices: ["정답", "오답 1", "오답 2", "오답 3"] }, ...overrides,
  };
}

function group(items: ReturnType<typeof listItem>[] = [], totalItems = items.length) {
  return { items, totalItems };
}

function emptySummary() {
  return { pending: group(), running: group(), failed: group(), applied: group() };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

describe("선지 검토 요약 페이지", () => {
  beforeEach(() => {
    vi.useRealTimers();
    for (const mock of Object.values(questionsMock)) mock.mockReset();
    for (const mock of Object.values(hardenJobsMock)) mock.mockReset();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
  });
  afterEach(() => cleanup());

  it("4개 섹션에 전체 건수를 표시한다", async () => {
    hardenJobsMock.summary.mockResolvedValue(emptySummary());
    await act(async () => { render(<HardeningReviewPage />); });
    expect(screen.getByText("⏳ 승인 대기 · 0건")).toBeVisible();
    expect(screen.getByText("🔄 진행 중 · 0건")).toBeVisible();
    expect(screen.getByText("❌ 실패 · 0건")).toBeVisible();
    expect(screen.getByText("📜 반영 이력 · 0건")).toBeVisible();
  });

  it("5건을 초과하는 상태에 전체 N건 보기 링크를 표시한다", async () => {
    hardenJobsMock.summary.mockResolvedValue({
      ...emptySummary(),
      pending: group([listItem()], 6),
    });
    await act(async () => { render(<HardeningReviewPage />); });
    expect(screen.getByRole("link", { name: "전체 6건 보기" })).toHaveAttribute(
      "href",
      "/hardening/pending",
    );
    expect(screen.queryByRole("link", { name: "전체 0건 보기" })).not.toBeInTheDocument();
  });

  it("승인 대기 카드에서 승인하면 현재 요약을 다시 조회한다", async () => {
    hardenJobsMock.summary.mockResolvedValue({
      ...emptySummary(), pending: group([listItem()]),
    });
    questionsMock.applyHardenChoices.mockResolvedValue({ ok: true });
    await act(async () => { render(<HardeningReviewPage />); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "✅ 승인" })); });
    expect(questionsMock.applyHardenChoices).toHaveBeenCalledWith(7, 11);
    expect(hardenJobsMock.summary).toHaveBeenCalledTimes(2);
  });

  it("숨겨진 탭에서는 폴링하지 않고 복귀할 때 즉시 갱신한다", async () => {
    vi.useFakeTimers();
    hardenJobsMock.summary.mockResolvedValue(emptySummary());
    await act(async () => { render(<HardeningReviewPage />); });
    expect(hardenJobsMock.summary).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(hardenJobsMock.summary).toHaveBeenCalledTimes(1);

    Object.defineProperty(document, "visibilityState", { configurable: true, value: "visible" });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(hardenJobsMock.summary).toHaveBeenCalledTimes(2);
  });

  it("늦게 도착한 이전 응답이 최신 목록을 덮지 않는다", async () => {
    const first = deferred<ReturnType<typeof emptySummary>>();
    const latest = {
      ...emptySummary(),
      running: group([listItem({ id: 12, questionPreview: "최신 작업", status: "RUNNING" })]),
    };
    hardenJobsMock.summary
      .mockReturnValueOnce(first.promise)
      .mockResolvedValueOnce(latest);

    render(<HardeningReviewPage />);
    await act(async () => { await Promise.resolve(); });
    await act(async () => { document.dispatchEvent(new Event("visibilitychange")); });
    expect(await screen.findByText("최신 작업")).toBeVisible();

    await act(async () => {
      first.resolve({
        ...emptySummary(),
        running: group([listItem({ questionPreview: "오래된 작업", status: "RUNNING" })]),
      });
      await first.promise;
    });
    expect(screen.getByText("최신 작업")).toBeVisible();
    expect(screen.queryByText("오래된 작업")).not.toBeInTheDocument();
  });
});
