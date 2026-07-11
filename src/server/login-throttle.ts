export const MAX_FAILURES = 5;
export const LOCKOUT_MS = 15 * 60 * 1000;

let failureCount = 0;
let lockedUntil = 0;

export function checkLockout(now: number = Date.now()): {
  locked: boolean;
  retryAfterMs: number;
} {
  if (lockedUntil > now) {
    return { locked: true, retryAfterMs: lockedUntil - now };
  }
  return { locked: false, retryAfterMs: 0 };
}

export function recordFailure(now: number = Date.now()): void {
  failureCount += 1;
  if (failureCount >= MAX_FAILURES) {
    lockedUntil = now + LOCKOUT_MS;
  }
}

export function recordSuccess(): void {
  failureCount = 0;
  lockedUntil = 0;
}

export function resetThrottleForTest(): void {
  failureCount = 0;
  lockedUntil = 0;
}
