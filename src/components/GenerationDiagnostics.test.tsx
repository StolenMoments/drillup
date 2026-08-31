// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const diagnosticsMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/api-client", () => ({
  api: { generate: { diagnostics: diagnosticsMock } },
}));

import GenerationDiagnostics from "./GenerationDiagnostics";

afterEach(() => {
  cleanup();
  diagnosticsMock.mockReset();
});

describe("GenerationDiagnostics", () => {
  it("정규화와 대체 파일 경고를 오류와 구분해 표시한다", async () => {
    diagnosticsMock.mockResolvedValue({
      runs: [
        {
          id: 1,
          stage: "VERIFY",
          itemIndex: null,
          attempt: 1,
          engine: "CODEX",
          model: null,
          status: "SUCCEEDED",
          prompt: "prompt",
          response: '{"verdict":"fail"}',
          stdoutTail: null,
          stderrTail: null,
          errorMessage: null,
          warningMessage:
            'verdict: normalized "revise" to "fail"; expected result.json, recovered answer.json',
          exitCode: 0,
          timedOut: false,
          startedAt: "2026-09-01T00:00:00.000Z",
          finishedAt: "2026-09-01T00:00:01.000Z",
          durationMs: 1000,
        },
      ],
    });
    render(<GenerationDiagnostics jobId={9} />);
    const details = screen.getByText("AI 진단 기록").closest("details");
    expect(details).not.toBeNull();
    if (!details) return;
    details.open = true;
    await act(async () => {
      fireEvent(details, new Event("toggle"));
    });
    expect(screen.getByRole("status")).toHaveTextContent("출력 보정");
    expect(screen.getByRole("status")).toHaveTextContent("recovered answer.json");
  });
});
