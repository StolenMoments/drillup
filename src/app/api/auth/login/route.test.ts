import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetThrottleForTest } from "@/server/login-throttle";
import { POST } from "./route";

function loginRequest(password: string, ip: string): Request {
  return new Request("http://localhost/api/auth/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Real-IP": ip,
    },
    body: JSON.stringify({ password }),
  });
}

describe("POST /api/auth/login", () => {
  beforeEach(() => {
    resetThrottleForTest();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(0));
    vi.stubEnv("APP_PASSWORD", "correct-password");
    vi.stubEnv("SESSION_SECRET", "test-secret");
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("IP별로 오답을 제한하되 제한 중인 IP의 정답은 허용함", async () => {
    const firstFailure = await POST(loginRequest("wrong", "203.0.113.1"));
    expect(firstFailure.status).toBe(401);

    const limitedFailure = await POST(loginRequest("wrong", "203.0.113.1"));
    expect(limitedFailure.status).toBe(429);
    expect(limitedFailure.headers.get("Retry-After")).toBe("1");

    const otherIpFailure = await POST(loginRequest("wrong", "203.0.113.2"));
    expect(otherIpFailure.status).toBe(401);

    const correctPassword = await POST(
      loginRequest("correct-password", "203.0.113.1"),
    );
    expect(correctPassword.status).toBe(200);
    await expect(correctPassword.json()).resolves.toEqual({ ok: true });
  });
});
