import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/server/errors";

const serviceMock = vi.hoisted(() => ({ startFreshnessReviewJob: vi.fn() }));
const runnerMock = vi.hoisted(() => ({ runFactualReviewJob: vi.fn() }));
const afterMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/factual-review-job-service", () => serviceMock);
vi.mock("@/server/factual-review-job-runner", () => runnerMock);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: afterMock,
}));

import { POST } from "./route";

function request(body: unknown): Request {
  return new Request("http://localhost/api/questions/7/review-freshness", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/questions/:id/review-freshness", () => {
  beforeEach(() => vi.clearAllMocks());

  it("새 job을 202로 반환하고 응답 뒤 러너를 예약한다", async () => {
    serviceMock.startFreshnessReviewJob.mockResolvedValue({ id: 11, status: "RUNNING" });
    const response = await POST(request({ engine: "CLAUDE" }), { params: Promise.resolve({ id: "7" }) });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ job: { id: 11, status: "RUNNING" } });
    expect(serviceMock.startFreshnessReviewJob).toHaveBeenCalledWith(7, "CLAUDE");
    expect(afterMock).toHaveBeenCalledOnce();
    await afterMock.mock.calls[0][0]();
    expect(runnerMock.runFactualReviewJob).toHaveBeenCalledWith(11);
  });

  it("잘못된 엔진과 CLOZE 오류를 API 오류로 반환한다", async () => {
    expect((await POST(request({ engine: "UNKNOWN" }), { params: Promise.resolve({ id: "7" }) })).status).toBe(400);
    serviceMock.startFreshnessReviewJob.mockRejectedValue(new ServiceError("VALIDATION", "MCQ 문제만 최신 정보 검증을 요청할 수 있습니다", 400));
    expect((await POST(request({ engine: "CLAUDE" }), { params: Promise.resolve({ id: "7" }) })).status).toBe(400);
  });
});
