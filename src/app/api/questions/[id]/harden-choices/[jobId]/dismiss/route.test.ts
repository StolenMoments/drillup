import { describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/server/errors";

const dismissMock = vi.hoisted(() => vi.fn());
vi.mock("@/server/choice-hardening-service", () => ({
  dismissChoiceHardeningJob: dismissMock,
}));

import { POST } from "./route";

describe("POST /api/questions/:id/harden-choices/:jobId/dismiss", () => {
  it("거절 성공은 ok를 반환한다", async () => {
    dismissMock.mockResolvedValue(undefined);

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "7", jobId: "11" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(dismissMock).toHaveBeenCalledWith(7, 11);
  });

  it("이미 반영된 job 거절은 409로 반환한다", async () => {
    dismissMock.mockRejectedValue(
      new ServiceError("CHOICE_HARDENING_ALREADY_APPLIED", "이미 반영됨", 409),
    );

    const response = await POST(new Request("http://localhost"), {
      params: Promise.resolve({ id: "7", jobId: "11" }),
    });

    expect(response.status).toBe(409);
  });
});
