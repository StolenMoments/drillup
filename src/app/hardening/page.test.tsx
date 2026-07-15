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
const hardenJobsMock = vi.hoisted(() => ({ list: vi.fn(), pendingCount: vi.fn() }));

vi.mock("@/lib/api-client", () => ({
  ApiError: class ApiError extends Error {
    constructor(public code: string, message: string, public status: number) { super(message); }
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

function emptyList() { return { pending: [], running: [], failed: [], recentApplied: [] }; }

describe("선지 검토 페이지", () => {
  beforeEach(() => { for (const mock of Object.values(questionsMock)) mock.mockReset(); for (const mock of Object.values(hardenJobsMock)) mock.mockReset(); });
  afterEach(() => cleanup());

  it("4개 섹션을 렌더한다", async () => {
    hardenJobsMock.list.mockResolvedValue(emptyList());
    await act(async () => { render(<HardeningReviewPage />); });
    expect(screen.getByText("⏳ 승인 대기")).toBeVisible();
    expect(screen.getByText("🔄 진행 중")).toBeVisible();
    expect(screen.getByText("❌ 실패")).toBeVisible();
    expect(screen.getByText("📜 최근 반영 이력")).toBeVisible();
  });

  it("승인 대기 카드에서 승인하면 apply를 호출하고 목록을 갱신한다", async () => {
    hardenJobsMock.list.mockResolvedValue({ ...emptyList(), pending: [listItem()] });
    questionsMock.applyHardenChoices.mockResolvedValue({ ok: true });
    await act(async () => { render(<HardeningReviewPage />); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "✅ 승인" })); });
    expect(questionsMock.applyHardenChoices).toHaveBeenCalledWith(7, 11);
    expect(hardenJobsMock.list).toHaveBeenCalledTimes(2);
  });

  it("거절 버튼은 dismiss를 호출한다", async () => {
    hardenJobsMock.list.mockResolvedValue({ ...emptyList(), pending: [listItem()] });
    questionsMock.dismissHardenChoices.mockResolvedValue({ ok: true });
    await act(async () => { render(<HardeningReviewPage />); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "🗑 거절" })); });
    expect(questionsMock.dismissHardenChoices).toHaveBeenCalledWith(7, 11);
  });

  it("검증 의견이 있으면 사실 확인 배너를 보여준다", async () => {
    const item = listItem();
    (item.preview as { factualConcern: string | null }).factualConcern = "정답이 최신 문서와 다릅니다";
    hardenJobsMock.list.mockResolvedValue({ ...emptyList(), pending: [item] });
    await act(async () => { render(<HardeningReviewPage />); });
    expect(screen.getByText(/사실 확인 필요/)).toBeVisible();
    expect(screen.getByRole("button", { name: "🔍 사실 확인 요청" })).toBeVisible();
  });

  it("승인 409 충돌은 안내 메시지를 보여준다", async () => {
    const { ApiError } = await import("@/lib/api-client");
    hardenJobsMock.list.mockResolvedValue({ ...emptyList(), pending: [listItem()] });
    questionsMock.applyHardenChoices.mockRejectedValue(new ApiError("CHOICE_HARDENING_SOURCE_CHANGED", "원본 변경", 409));
    await act(async () => { render(<HardeningReviewPage />); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "✅ 승인" })); });
    expect(screen.getByText(/원본이 변경되어 적용할 수 없습니다/)).toBeVisible();
  });

  it("실패 항목은 재시도와 거절 버튼을 보여준다", async () => {
    hardenJobsMock.list.mockResolvedValue({ ...emptyList(), failed: [listItem({ status: "FAILED", preview: null, errorMessage: "CLI 실행 실패" })] });
    await act(async () => { render(<HardeningReviewPage />); });
    expect(screen.getByText(/CLI 실행 실패/)).toBeVisible();
    expect(screen.getByRole("button", { name: "🔁 재시도" })).toBeVisible();
  });

  it("반영 이력은 자동/수동 배지를 구분한다", async () => {
    hardenJobsMock.list.mockResolvedValue({ ...emptyList(), recentApplied: [listItem({ appliedAt: "2026-07-15T00:05:00.000Z", autoApplied: true }), listItem({ id: 12, appliedAt: "2026-07-15T00:06:00.000Z", autoApplied: false })] });
    await act(async () => { render(<HardeningReviewPage />); });
    expect(screen.getByText("자동 반영")).toBeVisible();
    expect(screen.getByText("수동 반영")).toBeVisible();
  });
});
