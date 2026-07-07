import { describe, expect, it } from "vitest";
import {
  SESSION_TTL_MS,
  createSessionToken,
  verifySessionToken,
} from "./session";

const SECRET = "test-secret";

describe("session token", () => {
  it("생성한 토큰은 같은 시크릿으로 검증에 성공한다", async () => {
    const token = await createSessionToken(SECRET);
    expect(await verifySessionToken(SECRET, token)).toBe(true);
  });

  it("다른 시크릿으로 서명된 토큰은 실패한다", async () => {
    const token = await createSessionToken("other-secret");
    expect(await verifySessionToken(SECRET, token)).toBe(false);
  });

  it("만료된 토큰은 실패한다", async () => {
    const past = Date.now() - SESSION_TTL_MS - 1000;
    const token = await createSessionToken(SECRET, past);
    expect(await verifySessionToken(SECRET, token)).toBe(false);
  });

  it("형식이 깨진 토큰은 실패한다", async () => {
    expect(await verifySessionToken(SECRET, "garbage")).toBe(false);
    expect(await verifySessionToken(SECRET, "123.abc")).toBe(false);
    expect(await verifySessionToken(SECRET, "")).toBe(false);
  });
});
