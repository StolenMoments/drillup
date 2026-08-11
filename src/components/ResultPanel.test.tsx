// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMock = vi.hoisted(() => ({
  hardenChoices: vi.fn(),
  getHardenChoices: vi.fn(),
  applyHardenChoices: vi.fn(),
  explain: vi.fn(),
  getExplanationJob: vi.fn(),
  reviewFact: vi.fn(),
  getFactualReviewJob: vi.fn(),
  reviewFreshness: vi.fn(),
  getFreshnessReviewJob: vi.fn(),
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
  topicId: 1,
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
    autoApplied: false,
    dismissedAt: null,
    ...overrides,
  };
}

const preview = {
  engine: "CLAUDE" as const,
  comment: "오답을 더 어렵게 바꿨습니다",
  factualConcern: null,
  payload: {
    question: "원본 질문",
    choices: ["정답", "강화 오답 1", "강화 오답 2", "강화 오답 3"],
    answer_indices: [0],
    choice_explanations: ["근거", "근거", "근거", "근거"],
  },
};

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
    expect(screen.getByText(/생성 중 — 완료되면 자동 반영됩니다/)).toBeVisible();
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
    expect(screen.getByText(/생성 중 — 완료되면 자동 반영됩니다/)).toBeVisible();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.queryByText(/연결이 끊겼습니다/)).not.toBeInTheDocument();
    expect(screen.getByText(/생성 중 — 완료되면 자동 반영됩니다/)).toBeVisible();
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
      job: {
        id: 21,
        questionId: 7,
        engine: "CLAUDE",
        status: "SUCCEEDED",
        result: {
          content: "해설",
          choiceExplanations: null,
          factualConcern: "정답이 최신 문서와 다릅니다",
        },
        errorMessage: null,
        createdAt: "2026-07-15T00:00:00.000Z",
        startedAt: null,
        finishedAt: "2026-07-15T00:01:00.000Z",
      },
    });
    apiMock.reviewFact.mockResolvedValue({
      job: {
        id: 31,
        questionId: 7,
        engine: "CLAUDE",
        concern: "정답이 최신 문서와 다릅니다",
        status: "RUNNING",
        result: null,
        errorMessage: null,
        createdAt: "2026-07-15T00:00:00.000Z",
        startedAt: null,
        finishedAt: null,
      },
    });
    apiMock.getFactualReviewJob.mockResolvedValue({
      job: {
        id: 31,
        questionId: 7,
        engine: "CLAUDE",
        concern: "정답이 최신 문서와 다릅니다",
        status: "SUCCEEDED",
        result: {
          verdict: "confirmed",
          comment: "교정이 필요합니다",
          evidenceUrl: "https://example.com/evidence",
          payload: corrected,
        },
        errorMessage: null,
        createdAt: "2026-07-15T00:00:00.000Z",
        startedAt: "2026-07-15T00:00:00.000Z",
        finishedAt: "2026-07-15T00:01:00.000Z",
      },
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
      await vi.advanceTimersByTimeAsync(5_000);
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "✅ 적용하기" }));
    });

    expect(apiMock.reviewFact).toHaveBeenCalledWith(7, "CLAUDE", "정답이 최신 문서와 다릅니다");
    expect(apiMock.update).toHaveBeenCalledWith(7, { payload: corrected, explanation: null });
    expect(screen.getByText(/사실 교정이 적용되었습니다/)).toBeInTheDocument();
  });

  it("자동 반영이 확인되면 자동 반영 문구를 보여준다", async () => {
    apiMock.getHardenChoices.mockResolvedValue({
      job: job({
        status: "SUCCEEDED",
        preview,
        appliedAt: "2026-07-15T00:05:00.000Z",
        autoApplied: true,
      }),
    });
    await startTracking();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(
      screen.getByText("✅ 자동 반영됨 — 다음 학습부터 새 선지가 나옵니다 🎉"),
    ).toBeVisible();
  });

  it("검증 의견이 있으면 선지 검토 링크를 보여준다", async () => {
    apiMock.getHardenChoices.mockResolvedValue({
      job: job({
        status: "SUCCEEDED",
        preview: { ...preview, factualConcern: "정답이 최신 문서와 다릅니다" },
      }),
    });
    await startTracking();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getByText(/검증 의견이 있어요/)).toBeVisible();
    expect(screen.getByRole("link", { name: "선지 검토" })).toHaveAttribute(
      "href",
      "/hardening",
    );
  });

  it("concern 없이 미반영이 지속되면 3회 폴링 후 수동 승인 안내로 전환한다", async () => {
    apiMock.getHardenChoices.mockResolvedValue({
      job: job({ status: "SUCCEEDED", preview }),
    });
    await startTracking();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.queryByText(/수동으로 승인할 수 있어요/)).not.toBeInTheDocument();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(screen.getByText(/수동으로 승인할 수 있어요/)).toBeVisible();
  });

  it("적용하기 버튼을 렌더하지 않는다", async () => {
    apiMock.getHardenChoices.mockResolvedValue({
      job: job({ status: "SUCCEEDED", preview }),
    });
    await startTracking();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(
      screen.queryByRole("button", { name: "✅ 적용하기" }),
    ).not.toBeInTheDocument();
  });

  it("거절된 job을 받으면 새로 생성 안내로 전환한다", async () => {
    apiMock.hardenChoices.mockResolvedValue({
      job: job({
        status: "SUCCEEDED",
        preview,
        dismissedAt: "2026-07-15T00:06:00.000Z",
      }),
    });
    render(
      <ResultPanel question={question} result={result} onNext={vi.fn()} isLast={false} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Claude로 올리기" }));
    });

    expect(screen.getByText(/이전 결과를 거절했습니다/)).toBeVisible();
    expect(screen.getByRole("button", { name: "새로 생성" })).toBeVisible();
  });
});

function explanationJob(overrides: Record<string, unknown> = {}) {
  return {
    id: 21,
    questionId: 7,
    engine: "CLAUDE" as const,
    status: "RUNNING" as const,
    result: null,
    errorMessage: null,
    createdAt: "2026-07-15T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    ...overrides,
  };
}

async function startExplanationTracking(
  engine: Record<string, unknown> = {},
  buttonLabel = "Claude로 해설받기",
) {
  apiMock.explain.mockResolvedValue({ job: explanationJob(engine) });
  render(
    <ResultPanel question={question} result={result} onNext={vi.fn()} isLast={false} />,
  );
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: buttonLabel }));
  });
}

describe("ResultPanel explanation polling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const mock of Object.values(apiMock)) mock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("RUNNING job을 받으면 생성 중 상태를 표시하고 버튼을 비활성화한다", async () => {
    await startExplanationTracking();

    expect(
      screen.getByText(/생성 중 — 완료되면 여기에 표시됩니다/),
    ).toBeVisible();
    const button = screen.getByRole("button", { name: "생성 중..." });
    expect(button).toBeDisabled();
  });

  it("폴링이 RUNNING에서 SUCCEEDED로 전환되면 완료 화면을 렌더한다", async () => {
    apiMock.getExplanationJob.mockResolvedValue({
      job: explanationJob({
        status: "SUCCEEDED",
        result: {
          content: "해설 내용",
          choiceExplanations: null,
          factualConcern: null,
        },
        finishedAt: "2026-07-15T00:01:00.000Z",
      }),
    });
    await startExplanationTracking();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(apiMock.getExplanationJob).toHaveBeenCalledWith(7, 21);
    expect(screen.getByText("해설 내용")).toBeVisible();
    expect(screen.getByText("Claude")).toBeVisible();
    expect(
      screen.queryByText(/생성 중 — 완료되면 여기에 표시됩니다/),
    ).not.toBeInTheDocument();
  });

  it("폴링이 FAILED로 전환되면 에러 상태를 렌더한다", async () => {
    apiMock.getExplanationJob.mockResolvedValue({
      job: explanationJob({ status: "FAILED", errorMessage: "생성 실패" }),
    });
    await startExplanationTracking();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(
      screen.getByText(/Claude로 해설받기 해설을 가져오지 못했습니다: 생성 실패/),
    ).toBeInTheDocument();
  });

  it("폴링 중 네트워크 오류가 나면 경고 배너를 보여주되 생성 중 상태를 유지한다", async () => {
    const { ApiError } = await import("@/lib/api-client");
    apiMock.getExplanationJob.mockRejectedValueOnce(
      new ApiError("NETWORK_ERROR", "offline", 0),
    );
    await startExplanationTracking();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getByText(/연결이 끊겼습니다/)).toBeInTheDocument();
    expect(
      screen.getByText(/생성 중 — 완료되면 여기에 표시됩니다/),
    ).toBeVisible();
  });

  it("두 엔진을 동시에 추적해도 서로 상태에 영향을 주지 않는다", async () => {
    apiMock.explain
      .mockResolvedValueOnce({ job: explanationJob({ id: 21, engine: "CLAUDE" }) })
      .mockResolvedValueOnce({ job: explanationJob({ id: 22, engine: "CODEX" }) });
    apiMock.getExplanationJob.mockImplementation((_questionId: number, jobId: number) => {
      if (jobId === 21) {
        return Promise.resolve({
          job: explanationJob({
            id: 21,
            engine: "CLAUDE",
            status: "SUCCEEDED",
            result: { content: "Claude 해설", choiceExplanations: null, factualConcern: null },
          }),
        });
      }
      return Promise.resolve({ job: explanationJob({ id: 22, engine: "CODEX" }) });
    });
    render(
      <ResultPanel question={question} result={result} onNext={vi.fn()} isLast={false} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Claude로 해설받기" }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Codex로 해설받기" }));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(screen.getByText("Claude 해설")).toBeVisible();
    expect(
      screen.getByRole("button", { name: "생성 중..." }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Codex로 해설받기" }),
    ).not.toBeInTheDocument();
  });

  it("SUCCEEDED인데 result가 없으면 에러 상태로 처리한다", async () => {
    apiMock.getExplanationJob.mockResolvedValue({
      job: explanationJob({ status: "SUCCEEDED", result: null }),
    });
    await startExplanationTracking();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(
      screen.getByText(/Claude로 해설받기 해설을 가져오지 못했습니다: 결과를 불러오지 못했습니다/),
    ).toBeInTheDocument();
  });
});

describe("ResultPanel 최신 정보 검증", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    for (const mock of Object.values(apiMock)) mock.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const freshnessJob = (overrides: Record<string, unknown> = {}) => ({
    id: 31,
    questionId: 7,
    engine: "CLAUDE" as const,
    sourcePolicy: "AWS_DOCS_ONLY" as const,
    status: "RUNNING" as const,
    result: null,
    errorMessage: null,
    createdAt: "2026-08-11T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    ...overrides,
  });

  it("MCQ에만 검증 패널을 표시하고 완료 결과를 폴링한다", async () => {
    apiMock.reviewFreshness.mockResolvedValue({ job: freshnessJob() });
    apiMock.getFreshnessReviewJob.mockResolvedValue({
      job: freshnessJob({
        status: "SUCCEEDED",
        result: { verdict: "pass", comment: "최신입니다", evidenceUrl: "https://docs.aws.amazon.com/x", payload: null },
      }),
    });
    render(<ResultPanel question={question} result={result} onNext={vi.fn()} isLast={false} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "🔍 최신 정보 검증" }));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });

    expect(apiMock.reviewFreshness).toHaveBeenCalledWith(7, "CLAUDE");
    expect(apiMock.getFreshnessReviewJob).toHaveBeenCalledWith(7, 31);
    expect(screen.getByText(/최신 공식 문서 기준으로 이상이 없습니다/)).toBeVisible();
  });

  it("교정안 없는 fail에는 문제 편집 링크를 보여준다", async () => {
    apiMock.reviewFreshness.mockResolvedValue({
      job: freshnessJob({
        status: "SUCCEEDED",
        result: { verdict: "fail", comment: "문서가 변경됨", evidenceUrl: "https://docs.aws.amazon.com/x", payload: null },
      }),
    });
    render(<ResultPanel question={question} result={result} onNext={vi.fn()} isLast={false} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "🔍 최신 정보 검증" }));
    });

    expect(screen.getByRole("link", { name: "문제 편집으로 교정하기" })).toHaveAttribute("href", "/questions/7/edit");
  });
});
