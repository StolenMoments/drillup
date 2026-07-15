// @vitest-environment jsdom

import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pendingCountMock = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));
vi.mock("@/lib/api-client", () => ({ api: { hardenJobs: { pendingCount: pendingCountMock } } }));

import AppNav from "./AppNav";

describe("AppNav", () => {
  beforeEach(() => pendingCountMock.mockReset());
  afterEach(() => cleanup());

  it("선지 검토 메뉴를 렌더한다", async () => {
    pendingCountMock.mockResolvedValue({ count: 0 });
    await act(async () => { render(<AppNav />); await Promise.resolve(); });
    expect(screen.getByRole("link", { name: "선지 검토" })).toHaveAttribute("href", "/hardening");
  });

  it("승인 대기가 있으면 배지를 보여준다", async () => {
    pendingCountMock.mockResolvedValue({ count: 3 });
    await act(async () => { render(<AppNav />); });
    expect(screen.getByText("3")).toBeVisible();
  });

  it("배지 조회 실패는 조용히 무시한다", async () => {
    pendingCountMock.mockResolvedValue({ count: 0 });
    await act(async () => { render(<AppNav />); await Promise.resolve(); });
    expect(screen.getByRole("link", { name: /drillup/ })).toBeVisible();
  });
});
