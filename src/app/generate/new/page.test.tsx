// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const navigationMock = vi.hoisted(() => ({
  push: vi.fn(),
  searchParams: new URLSearchParams(),
}));
const topicsMock = vi.hoisted(() => ({
  list: vi.fn(),
  create: vi.fn(),
  referenceFiles: vi.fn(),
}));
const generateMock = vi.hoisted(() => ({
  get: vi.fn(),
  create: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigationMock.push }),
  useSearchParams: () => navigationMock.searchParams,
}));

vi.mock("@/lib/api-client", () => ({
  api: {
    topics: topicsMock,
    generate: generateMock,
  },
}));

import GenerationNewPage from "./page";

const referenceFiles = [
  "common/00-exam-guide.md",
  "common/01-style-examples.md",
  "d1/foundation.md",
  "d2/implementation.md",
  "d3/security.md",
  "d4/optimization.md",
  "d5/testing.md",
].map((path) => ({ path, size: 1024 }));

describe("AI 문제 생성 기본 설정", () => {
  beforeEach(() => {
    navigationMock.push.mockReset();
    navigationMock.searchParams = new URLSearchParams();
    for (const mock of Object.values(topicsMock)) mock.mockReset();
    for (const mock of Object.values(generateMock)) mock.mockReset();

    topicsMock.list.mockResolvedValue([
      {
        id: 1,
        name: "AIP-C01 D1 — FM 통합",
        description: null,
        referenceDir: "aip-c01",
        verificationSourcePolicy: "AWS_DOCS_ONLY",
        questionCount: 0,
      },
    ]);
    topicsMock.referenceFiles.mockResolvedValue({
      files: referenceFiles,
      dirExists: true,
    });
  });

  afterEach(() => cleanup());

  it("정답 2개와 선지 6개를 신규 생성 기본값으로 표시한다", async () => {
    await act(async () => {
      render(<GenerationNewPage />);
    });

    expect(screen.getByLabelText("정답 2개")).toBeChecked();
    expect(screen.getByLabelText("선지 6개")).toBeChecked();
  });

  it("AIP-C01 D1 선택 시 필수 자료와 D1 자료만 체크한다", async () => {
    await act(async () => {
      render(<GenerationNewPage />);
    });

    fireEvent.change(screen.getByRole("combobox"), {
      target: { value: "1" },
    });

    await waitFor(() => {
      expect(topicsMock.referenceFiles).toHaveBeenCalledWith(1);
      expect(screen.getByLabelText(/common\/00-exam-guide\.md/)).toBeChecked();
    });

    expect(screen.getByLabelText(/common\/00-exam-guide\.md/)).toBeDisabled();
    expect(screen.getByLabelText(/common\/01-style-examples\.md/)).toBeChecked();
    expect(screen.getByLabelText(/d1\/foundation\.md/)).toBeChecked();
    expect(screen.getByLabelText(/d2\/implementation\.md/)).not.toBeChecked();
    expect(screen.getByLabelText(/d3\/security\.md/)).not.toBeChecked();
    expect(screen.getByLabelText(/d4\/optimization\.md/)).not.toBeChecked();
    expect(screen.getByLabelText(/d5\/testing\.md/)).not.toBeChecked();
  });
});
