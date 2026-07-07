import { describe, expect, it } from "vitest";
import { ServiceError } from "./errors";
import { parseIdParam } from "./http";

describe("parseIdParam", () => {
  it("returns positive integer ids", () => {
    expect(parseIdParam("12")).toBe(12);
  });

  it("rejects non-positive or non-integer ids", () => {
    expect(() => parseIdParam("0")).toThrow(ServiceError);
    expect(() => parseIdParam("-1")).toThrow(ServiceError);
    expect(() => parseIdParam("1.5")).toThrow(ServiceError);
    expect(() => parseIdParam("abc")).toThrow(ServiceError);
  });
});
