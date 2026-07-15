import { describe, expect, it, vi } from "vitest";

const listMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/choice-hardening-service", () => ({
  listChoiceHardeningJobs: listMock,
}));

import { GET } from "./route";

describe("GET /api/harden-jobs", () => {
  it("4개 분류 목록을 반환한다", async () => {
    const payload = { pending: [], running: [], failed: [], recentApplied: [] };
    listMock.mockResolvedValue(payload);

    const response = await GET();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);
  });
});
