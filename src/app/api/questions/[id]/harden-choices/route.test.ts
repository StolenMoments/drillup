import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/server/errors";

const serviceMock = vi.hoisted(() => ({
  startChoiceHardeningJob: vi.fn(),
  getChoiceHardeningJob: vi.fn(),
  applyChoiceHardeningJob: vi.fn(),
}));
const runnerMock = vi.hoisted(() => ({ runChoiceHardeningJob: vi.fn() }));
const afterMock = vi.hoisted(() => vi.fn());

vi.mock("@/server/choice-hardening-service", () => serviceMock);
vi.mock("@/server/choice-hardening-runner", () => runnerMock);
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: afterMock,
}));

import { POST } from "./route";

const job = { id: 11, status: "RUNNING" as const };

function request(body: unknown): Request {
  return new Request("http://localhost/api/questions/7/harden-choices", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/questions/:id/harden-choices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runnerMock.runChoiceHardeningJob.mockResolvedValue(undefined);
  });

  it("새 작업과 진행 중 작업은 202로 반환한다", async () => {
    serviceMock.startChoiceHardeningJob.mockResolvedValue(job);

    const response = await POST(
      request({ engine: "CLAUDE" }),
      { params: Promise.resolve({ id: "7" }) },
    );

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ job });
    expect(afterMock).toHaveBeenCalledOnce();
    expect(runnerMock.runChoiceHardeningJob).not.toHaveBeenCalled();

    await afterMock.mock.calls[0][0]();
    expect(runnerMock.runChoiceHardeningJob).toHaveBeenCalledWith(11);
  });

  it("runner 완료를 기다리지 않고 응답한다", async () => {
    serviceMock.startChoiceHardeningJob.mockResolvedValue(job);
    runnerMock.runChoiceHardeningJob.mockReturnValue(new Promise(() => {}));

    const response = await POST(
      request({ engine: "CLAUDE" }),
      { params: Promise.resolve({ id: "7" }) },
    );

    expect(response.status).toBe(202);
    expect(runnerMock.runChoiceHardeningJob).not.toHaveBeenCalled();
  });

  it("완료 job 재사용은 200으로 반환한다", async () => {
    serviceMock.startChoiceHardeningJob.mockResolvedValue({
      ...job,
      status: "SUCCEEDED",
    });

    const response = await POST(
      request({ engine: "CLAUDE" }),
      { params: Promise.resolve({ id: "7" }) },
    );

    expect(response.status).toBe(200);
    expect(afterMock).not.toHaveBeenCalled();
  });

  it("잘못된 엔진 입력은 400으로 반환한다", async () => {
    const response = await POST(
      request({ engine: "UNKNOWN" }),
      { params: Promise.resolve({ id: "7" }) },
    );

    expect(response.status).toBe(400);
  });

  it("존재하지 않는 문제는 404로 반환한다", async () => {
    serviceMock.startChoiceHardeningJob.mockRejectedValue(
      new ServiceError("NOT_FOUND", "문제를 찾을 수 없습니다", 404),
    );

    const response = await POST(
      request({ engine: "CLAUDE" }),
      { params: Promise.resolve({ id: "7" }) },
    );

    expect(response.status).toBe(404);
  });
});
