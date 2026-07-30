// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const diagnosticsMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/api-client", () => ({
  api: {
    generate: {
      diagnostics: diagnosticsMock,
    },
  },
}));

import GenerationDiagnostics from "./GenerationDiagnostics";

describe("GenerationDiagnostics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    diagnosticsMock.mockResolvedValue({
      runs: [{
        id: 91,
        stage: "LEGACY_OUTPUT",
        itemIndex: null,
        attempt: 0,
        engine: "CLAUDE",
        model: null,
        status: "SUCCEEDED",
        prompt: "기존 출력 변환 입력",
        response: "기존 출력 변환 결과",
        stdoutTail: null,
        stderrTail: null,
        errorMessage: null,
        exitCode: 0,
        timedOut: false,
        startedAt: "2026-07-30T00:00:00.000Z",
        finishedAt: "2026-07-30T00:00:01.000Z",
        durationMs: 1000,
      }],
    });
  });

  it("loads lazily and renders a LEGACY_OUTPUT diagnostic with a Korean label", async () => {
    const { container } = render(<GenerationDiagnostics jobId={7} />);

    expect(diagnosticsMock).not.toHaveBeenCalled();
    const details = container.querySelector("details");
    if (!details) throw new Error("diagnostics details missing");
    details.open = true;
    fireEvent(details, new Event("toggle", { bubbles: true }));

    expect(await screen.findByText("기존 출력")).toBeInTheDocument();
    expect(screen.getByText("기존 출력 변환 입력")).toBeInTheDocument();
    await waitFor(() => expect(diagnosticsMock).toHaveBeenCalledWith(7));
  });
});
