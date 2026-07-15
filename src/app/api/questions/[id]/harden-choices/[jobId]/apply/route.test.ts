import { describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/server/errors";

const applyMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/choice-hardening-service", () => ({
  applyChoiceHardeningJob: applyMock,
}));

import { POST } from "./route";

describe("POST /api/questions/:id/harden-choices/:jobId/apply", () => {
  it("적용 성공은 ok를 반환한다", async () => {
    applyMock.mockResolvedValue(undefined);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "7", jobId: "11" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("원본 변경 충돌은 409로 반환한다", async () => {
    applyMock.mockRejectedValue(
      new ServiceError("CHOICE_HARDENING_SOURCE_CHANGED", "원본 변경", 409),
    );

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "7", jobId: "11" }),
    });

    expect(response.status).toBe(409);
  });
});
