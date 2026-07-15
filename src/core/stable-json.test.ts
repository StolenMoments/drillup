import { describe, expect, it } from "vitest";
import { sha256Fingerprint, stableStringify } from "./stable-json";

describe("stable JSON fingerprint", () => {
  it("객체 키 순서와 무관하게 같은 fingerprint를 만든다", async () => {
    const first = { question: "질문", metadata: { z: 1, a: true } };
    const second = { metadata: { a: true, z: 1 }, question: "질문" };

    expect(stableStringify(first)).toBe(stableStringify(second));
    await expect(sha256Fingerprint(first)).resolves.toBe(
      await sha256Fingerprint(second),
    );
  });

  it("배열 순서는 payload의 의미이므로 보존한다", () => {
    expect(stableStringify({ choices: ["A", "B"] })).not.toBe(
      stableStringify({ choices: ["B", "A"] }),
    );
  });
});
