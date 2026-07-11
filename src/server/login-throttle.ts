import { isIP } from "node:net";

export const BACKOFF_BASE_MS = 1_000;
export const BACKOFF_MAX_MS = 30_000;
export const ENTRY_TTL_MS = 30 * 60 * 1_000;
export const MAX_ENTRIES = 10_000;

type ThrottleEntry = {
  failureCount: number;
  blockedUntil: number;
  lastSeenAt: number;
};

const entries = new Map<string, ThrottleEntry>();
let lastCleanupAt = Number.NEGATIVE_INFINITY;

function cleanup(now: number): void {
  if (now - lastCleanupAt >= 60_000) {
    for (const [clientKey, entry] of entries) {
      if (now - entry.lastSeenAt > ENTRY_TTL_MS) entries.delete(clientKey);
    }
    lastCleanupAt = now;
  }

  if (entries.size <= MAX_ENTRIES) return;

  const oldest = [...entries.entries()].sort(
    ([, left], [, right]) => left.lastSeenAt - right.lastSeenAt,
  );
  for (let i = 0; i < entries.size - MAX_ENTRIES; i++) {
    entries.delete(oldest[i][0]);
  }
}

export function clientKeyFromRequest(req: Request): string {
  const realIp = req.headers.get("x-real-ip")?.trim();
  return realIp && isIP(realIp) !== 0 ? realIp : "unknown";
}

export function checkLockout(
  clientKey: string,
  now: number = Date.now(),
): { locked: boolean; retryAfterMs: number } {
  cleanup(now);
  const entry = entries.get(clientKey);
  if (!entry) return { locked: false, retryAfterMs: 0 };

  entry.lastSeenAt = now;
  if (entry.blockedUntil > now) {
    return { locked: true, retryAfterMs: entry.blockedUntil - now };
  }
  return { locked: false, retryAfterMs: 0 };
}

export function recordFailure(
  clientKey: string,
  now: number = Date.now(),
): { retryAfterMs: number } {
  cleanup(now);
  const failureCount = (entries.get(clientKey)?.failureCount ?? 0) + 1;
  const retryAfterMs = Math.min(
    BACKOFF_BASE_MS * 2 ** (failureCount - 1),
    BACKOFF_MAX_MS,
  );
  entries.set(clientKey, {
    failureCount,
    blockedUntil: now + retryAfterMs,
    lastSeenAt: now,
  });
  cleanup(now);
  return { retryAfterMs };
}

export function recordSuccess(clientKey: string): void {
  entries.delete(clientKey);
}

export function resetThrottleForTest(): void {
  entries.clear();
  lastCleanupAt = Number.NEGATIVE_INFINITY;
}

export function throttleEntryCountForTest(): number {
  return entries.size;
}
