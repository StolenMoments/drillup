import { afterEach, describe, expect, it } from "vitest";
import { generationTimeoutMs } from "./run-engine";

const originalTimeout = process.env.GENERATION_TIMEOUT_MS;

afterEach(() => {
  if (originalTimeout === undefined) delete process.env.GENERATION_TIMEOUT_MS;
  else process.env.GENERATION_TIMEOUT_MS = originalTimeout;
});

describe("generationTimeoutMs", () => {
  it("기본값은 20분이다", () => {
    delete process.env.GENERATION_TIMEOUT_MS;
    expect(generationTimeoutMs()).toBe(1_200_000);
  });

  it("GENERATION_TIMEOUT_MS를 반영한다", () => {
    process.env.GENERATION_TIMEOUT_MS = "30000";
    expect(generationTimeoutMs()).toBe(30_000);
  });

  it("잘못된 값이면 기본값을 쓴다", () => {
    process.env.GENERATION_TIMEOUT_MS = "abc";
    expect(generationTimeoutMs()).toBe(1_200_000);

    process.env.GENERATION_TIMEOUT_MS = "-5";
    expect(generationTimeoutMs()).toBe(1_200_000);
  });
});
