import { beforeEach, describe, expect, it, vi } from "vitest";

const serviceMock = vi.hoisted(() => ({ getFreshnessReviewJob: vi.fn() }));
vi.mock("@/server/factual-review-job-service", () => serviceMock);

import { GET } from "./route";

describe("GET /api/questions/:id/review-freshness/:jobId", () => {
  beforeEach(() => vi.clearAllMocks());

  it("job 상태와 결과를 반환한다", async () => {
    const job = { id: 11, questionId: 7, status: "SUCCEEDED", result: { verdict: "pass" } };
    serviceMock.getFreshnessReviewJob.mockResolvedValue(job);
    const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ id: "7", jobId: "11" }) });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ job });
    expect(serviceMock.getFreshnessReviewJob).toHaveBeenCalledWith(7, 11);
  });
});
