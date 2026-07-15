import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMocks = vi.hoisted(() => ({
  getChoiceHardeningJobPage: vi.fn(),
  getChoiceHardeningJobSummary: vi.fn(),
}));
vi.mock("@/server/choice-hardening-service", () => ({
  ...serviceMocks,
}));

import { GET } from "./route";

describe("GET /api/harden-jobs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("status가 없으면 4개 상태 요약을 반환한다", async () => {
    const group = { items: [], totalItems: 0 };
    const payload = { pending: group, running: group, failed: group, applied: group };
    serviceMocks.getChoiceHardeningJobSummary.mockResolvedValue(payload);

    const response = await GET(new Request("http://localhost/api/harden-jobs"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
    expect(serviceMocks.getChoiceHardeningJobPage).not.toHaveBeenCalled();
  });

  it("유효한 status와 page는 상태 상세 조회로 전달한다", async () => {
    const payload = { items: [], page: 2, pageSize: 10, totalItems: 12, totalPages: 2 };
    serviceMocks.getChoiceHardeningJobPage.mockResolvedValue(payload);

    const response = await GET(
      new Request("http://localhost/api/harden-jobs?status=pending&page=2"),
    );

    expect(response.status).toBe(200);
    expect(serviceMocks.getChoiceHardeningJobPage).toHaveBeenCalledWith("pending", 2);
    expect(await response.json()).toEqual(payload);
  });

  it.each(["", "0", "-2", "abc", "1.5"])(
    "유효하지 않거나 누락된 page %j는 1로 정규화한다",
    async (page) => {
      serviceMocks.getChoiceHardeningJobPage.mockResolvedValue({
        items: [], page: 1, pageSize: 10, totalItems: 0, totalPages: 1,
      });
      const suffix = page === "" ? "" : `&page=${page}`;

      await GET(new Request(`http://localhost/api/harden-jobs?status=running${suffix}`));

      expect(serviceMocks.getChoiceHardeningJobPage).toHaveBeenLastCalledWith("running", 1);
    },
  );

  it("유효하지 않은 status는 400 오류를 반환한다", async () => {
    const response = await GET(
      new Request("http://localhost/api/harden-jobs?status=unknown&page=1"),
    );

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: { code: "VALIDATION", message: "잘못된 선지 검토 상태입니다" },
    });
    expect(serviceMocks.getChoiceHardeningJobPage).not.toHaveBeenCalled();
  });
});
