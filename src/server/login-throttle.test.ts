import { beforeEach, describe, expect, it } from "vitest";
import {
  BACKOFF_MAX_MS,
  ENTRY_TTL_MS,
  MAX_ENTRIES,
  checkLockout,
  clientKeyFromRequest,
  recordFailure,
  recordSuccess,
  resetThrottleForTest,
  throttleEntryCountForTest,
} from "./login-throttle";

describe("login-throttle", () => {
  beforeEach(() => {
    resetThrottleForTest();
  });

  it("IP별로 실패 상태를 격리함", () => {
    expect(recordFailure("203.0.113.1", 0).retryAfterMs).toBe(1_000);

    expect(checkLockout("203.0.113.1", 500)).toEqual({
      locked: true,
      retryAfterMs: 500,
    });
    expect(checkLockout("203.0.113.2", 500)).toEqual({
      locked: false,
      retryAfterMs: 0,
    });
  });

  it("실패할 때마다 backoff를 지수형으로 늘리고 30초로 제한함", () => {
    const delays: number[] = [];
    let now = 0;

    for (let i = 0; i < 7; i++) {
      const state = recordFailure("203.0.113.1", now);
      delays.push(state.retryAfterMs);
      now += state.retryAfterMs;
    }

    expect(delays).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000]);
    expect(delays.at(-1)).toBe(BACKOFF_MAX_MS);
  });

  it("성공한 IP의 상태만 초기화함", () => {
    recordFailure("203.0.113.1", 0);
    recordFailure("203.0.113.2", 0);

    recordSuccess("203.0.113.1");

    expect(checkLockout("203.0.113.1", 500).locked).toBe(false);
    expect(checkLockout("203.0.113.2", 500).locked).toBe(true);
  });

  it("30분 동안 사용하지 않은 상태를 정리함", () => {
    recordFailure("203.0.113.1", 0);

    expect(checkLockout("203.0.113.2", ENTRY_TTL_MS + 1).locked).toBe(false);
    expect(throttleEntryCountForTest()).toBe(0);
  });

  it("저장하는 IP 상태 수를 제한함", () => {
    for (let i = 0; i < MAX_ENTRIES + 25; i++) {
      recordFailure(`client-${i}`, 0);
    }

    expect(throttleEntryCountForTest()).toBe(MAX_ENTRIES);
  });

  it("유효한 X-Real-IP를 client key로 사용함", () => {
    const request = new Request("http://localhost/api/auth/login", {
      headers: { "X-Real-IP": "203.0.113.10" },
    });

    expect(clientKeyFromRequest(request)).toBe("203.0.113.10");
  });

  it("신뢰할 수 없는 IP 헤더는 unknown으로 격리함", () => {
    const missing = new Request("http://localhost/api/auth/login");
    const invalid = new Request("http://localhost/api/auth/login", {
      headers: { "X-Real-IP": "203.0.113.10, 198.51.100.2" },
    });

    expect(clientKeyFromRequest(missing)).toBe("unknown");
    expect(clientKeyFromRequest(invalid)).toBe("unknown");
  });
});
