import { beforeEach, describe, expect, it } from "vitest";
import {
  LOCKOUT_MS,
  MAX_FAILURES,
  checkLockout,
  recordFailure,
  recordSuccess,
  resetThrottleForTest,
} from "./login-throttle";

describe("login-throttle", () => {
  beforeEach(() => {
    resetThrottleForTest();
  });

  it("초기 상태는 잠기지 않음", () => {
    expect(checkLockout(0).locked).toBe(false);
  });

  it("MAX_FAILURES 미만 실패는 잠그지 않음", () => {
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure(0);
    expect(checkLockout(0).locked).toBe(false);
  });

  it("MAX_FAILURES 연속 실패 시 잠김", () => {
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure(0);
    const state = checkLockout(0);
    expect(state.locked).toBe(true);
    expect(state.retryAfterMs).toBe(LOCKOUT_MS);
  });

  it("잠금 시간이 지나면 자동 해제", () => {
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure(0);
    expect(checkLockout(LOCKOUT_MS).locked).toBe(false);
  });

  it("성공 시 실패 카운터가 초기화됨", () => {
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure(0);
    recordSuccess();
    for (let i = 0; i < MAX_FAILURES - 1; i++) recordFailure(0);
    expect(checkLockout(0).locked).toBe(false);
  });

  it("잠금 중 남은 시간을 정확히 반환", () => {
    for (let i = 0; i < MAX_FAILURES; i++) recordFailure(1000);
    expect(checkLockout(1000 + 60_000).retryAfterMs).toBe(LOCKOUT_MS - 60_000);
  });
});
