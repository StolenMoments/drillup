// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  hardenChoices: vi.fn(),
  getHardenChoices: vi.fn(),
  applyHardenChoices: vi.fn(),
  explain: vi.fn(),
  reviewFact: vi.fn(),
  update: vi.fn(),
}));

vi.mock("@/lib/api-client", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public code: string,
      message: string,
      public status: number,
    ) {
      super(message);
    }
  },
  api: { questions: apiMock },
}));

import ResultPanel from "./ResultPanel";

const question = {
  id: 7,
  type: "MCQ" as const,
  question: "원본 질문",
  choices: [
    { text: "정답", original_index: 0 },
    { text: "오답 1", original_index: 1 },
    { text: "오답 2", original_index: 2 },
    { text: "오답 3", original_index: 3 },
  ],
  selectionCount: 1 as const,
};

const result = {
  isCorrect: true,
  explanation: null,
  correct: {
    type: "MCQ" as const,
    answer_indices: [0],
    choice_explanations: null,
  },
};

function job(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    questionId: 7,
    sourceHash: "a".repeat(64),
    engine: "CLAUDE" as const,
    verifyEngine: "CODEX" as const,
    attempt: 1,
    status: "RUNNING" as const,
    stage: "GENERATING" as const,
    preview: null,
    errorMessage: null,
    createdAt: "2026-07-15T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    appliedAt: null,
    ...overrides,
  };
}

async function startTracking() {
  apiMock.hardenChoices.mockResolvedValue({ job: job() });
  render(
    <ResultPanel
      question={question}
      result={result}
      onNext={vi.fn()}
      isLast={false}
    />,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Claude로 올리기" }));
  });
}

describe("ResultPanel choice hardening polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const mock of Object.values(apiMock)) mock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("원격 단일 엔진 UX를 유지한다", () => {
    render(<ResultPanel question={question} result={result} onNext={vi.fn()} isLast={false} />);

    expect(screen.getByRole("button", { name: "Claude로 올리기" })).toBeVisible();
    expect(screen.getByRole("button", { name: "Codex로 올리기" })).toBeVisible();
    expect(screen.queryByText(/의미 검증 엔진|의미 보존 변형/)).not.toBeInTheDocument();
  });

  it("5초마다 최신 stage를 조회한다", async () => {
    apiMock.getHardenChoices.mockResolvedValue({
      job: job({ stage: "GENERATING" }),
    });
    await startTracking();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(apiMock.getHardenChoices).toHaveBeenCalledWith(7, 11);
    expect(screen.getAllByText("생성 중...")).toHaveLength(2);
  });

  it("visibilitychange와 pageshow에서 즉시 조회한다", async () => {
    apiMock.getHardenChoices.mockResolvedValue({ job: job() });
    await startTracking();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });

    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pageshow"));
    });

    expect(apiMock.getHardenChoices).toHaveBeenCalledTimes(2);
  });

  it("네트워크 오류 후에도 폴링하고 다음 성공에서 경고를 지운다", async () => {
    const { ApiError } = await import("@/lib/api-client");
    apiMock.getHardenChoices
      .mockRejectedValueOnce(new ApiError("NETWORK_ERROR", "offline", 0))
      .mockResolvedValueOnce({ job: job() });
    await startTracking();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByText(/연결이 끊겼습니다/)).toBeInTheDocument();
    expect(screen.getAllByText("생성 중...")).toHaveLength(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.queryByText(/연결이 끊겼습니다/)).not.toBeInTheDocument();
    expect(screen.getAllByText("생성 중...")).toHaveLength(2);
    expect(apiMock.getHardenChoices).toHaveBeenCalledTimes(2);
  });

  it("복구 불가능한 API 오류는 terminal error로 전환한다", async () => {
    const { ApiError } = await import("@/lib/api-client");
    apiMock.getHardenChoices.mockRejectedValue(
      new ApiError("NOT_FOUND", "작업 없음", 404),
    );
    await startTracking();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getByText(/작업 없음/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "새로 생성" })).toBeInTheDocument();
  });

  it("완료·실패 job의 새로 생성만 force=true를 보낸다", async () => {
    apiMock.hardenChoices
      .mockResolvedValueOnce({
        job: job({ status: "FAILED", errorMessage: "검증 실패" }),
      })
      .mockResolvedValueOnce({ job: job({ attempt: 2 }) });
    render(
      <ResultPanel
        question={question}
        result={result}
        onNext={vi.fn()}
        isLast={false}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Claude로 올리기" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "새로 생성" }));
    });

    expect(apiMock.hardenChoices).toHaveBeenNthCalledWith(
      1,
      7,
      "CLAUDE",
      false,
    );
    expect(apiMock.hardenChoices).toHaveBeenNthCalledWith(
      2,
      7,
      "CLAUDE",
      true,
    );
  });

  it("사실 검증 교정안을 적용하고 성공 안내를 유지한다", async () => {
    const corrected = {
      question: "교정된 질문",
      choices: ["새 정답", "오답 1", "오답 2", "오답 3"],
      answer_indices: [0],
      choice_explanations: ["근거 1", "근거 2", "근거 3", "근거 4"],
    };
    apiMock.explain.mockResolvedValue({
      content: "해설",
      choiceExplanations: null,
      factualConcern: "정답이 최신 문서와 다릅니다",
    });
    apiMock.reviewFact.mockResolvedValue({
      engine: "CLAUDE",
      verdict: "confirmed",
      comment: "교정이 필요합니다",
      evidenceUrl: "https://example.com/evidence",
      payload: corrected,
    });
    apiMock.update.mockResolvedValue({});
    render(<ResultPanel question={question} result={result} onNext={vi.fn()} isLast={false} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Claude로 해설받기" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "🔍 사실 확인 요청" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "✅ 적용하기" }));
    });

    expect(apiMock.reviewFact).toHaveBeenCalledWith(7, "CLAUDE", "정답이 최신 문서와 다릅니다");
    expect(apiMock.update).toHaveBeenCalledWith(7, { payload: corrected, explanation: null });
    expect(screen.getByText(/사실 교정이 적용되었습니다/)).toBeInTheDocument();
  });
});
