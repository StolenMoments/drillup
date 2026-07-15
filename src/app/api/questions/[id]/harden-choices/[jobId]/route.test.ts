import { describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/server/errors";

const serviceMock = vi.hoisted(() => ({
  getChoiceHardeningJob: vi.fn(),
  applyChoiceHardeningJob: vi.fn(),
}));

vi.mock("@/server/choice-hardening-service", () => serviceMock);

import { GET } from "./route";

describe("GET /api/questions/:id/harden-choices/:jobId", () => {
  it("job DTO를 반환한다", async () => {
    const job = { id: 11, status: "SUCCEEDED" as const };
    serviceMock.getChoiceHardeningJob.mockResolvedValue(job);

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "7", jobId: "11" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ job });
  });

  it("없는 job은 404로 반환한다", async () => {
    serviceMock.getChoiceHardeningJob.mockRejectedValue(
      new ServiceError("NOT_FOUND", "선지 강화 작업을 찾을 수 없습니다", 404),
    );

    const response = await GET(new Request("http://localhost"), {
      params: Promise.resolve({ id: "7", jobId: "11" }),
    });

    expect(response.status).toBe(404);
  });
});
