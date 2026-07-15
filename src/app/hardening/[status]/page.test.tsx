import { describe, expect, it, vi } from "vitest";

const notFoundMock = vi.hoisted(() => vi.fn(() => {
  throw new Error("NOT_FOUND");
}));

vi.mock("next/navigation", () => ({ notFound: notFoundMock }));
vi.mock("./HardeningStatusPage", () => ({
  default: (props: unknown) => props,
}));

import Page, { generateStaticParams } from "./page";

describe("선지 검토 상태 경로", () => {
  it("4개 허용 상태만 정적 경로로 선언한다", () => {
    expect(generateStaticParams()).toEqual([
      { status: "pending" },
      { status: "running" },
      { status: "failed" },
      { status: "applied" },
    ]);
  });

  it("허용되지 않은 상태는 404 처리한다", async () => {
    await expect(Page({
      params: Promise.resolve({ status: "unknown" }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("유효하지 않은 페이지 번호는 1로 정규화한다", async () => {
    const result = await Page({
      params: Promise.resolve({ status: "failed" }),
      searchParams: Promise.resolve({ page: "abc" }),
    });

    expect(result.props).toMatchObject({ status: "failed", initialPage: 1 });
  });
});
