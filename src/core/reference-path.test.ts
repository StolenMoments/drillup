import { describe, expect, it } from "vitest";
import { isSafeReferencePath } from "./reference-path";

describe("isSafeReferencePath", () => {
  it("정상 상대 경로를 허용한다 (슬래시·백슬래시 모두)", () => {
    expect(isSafeReferencePath("aip-c01")).toBe(true);
    expect(isSafeReferencePath("aip-c01/d1/bedrock.md")).toBe(true);
    expect(isSafeReferencePath("common\\00-exam-guide.md")).toBe(true);
  });

  it("빈 값·공백만 있는 값을 거부한다", () => {
    expect(isSafeReferencePath("")).toBe(false);
    expect(isSafeReferencePath("   ")).toBe(false);
  });

  it("상위 디렉터리 탈출을 거부한다", () => {
    expect(isSafeReferencePath("..")).toBe(false);
    expect(isSafeReferencePath("aip-c01/../../etc")).toBe(false);
    expect(isSafeReferencePath("..\\secrets")).toBe(false);
  });

  it("절대 경로·드라이브·UNC 경로를 거부한다", () => {
    expect(isSafeReferencePath("/etc/passwd")).toBe(false);
    expect(isSafeReferencePath("C:\\work\\drillup")).toBe(false);
    expect(isSafeReferencePath("c:/work")).toBe(false);
    expect(isSafeReferencePath("\\\\server\\share")).toBe(false);
  });

  it("빈 세그먼트·현재 디렉터리 세그먼트를 거부한다", () => {
    expect(isSafeReferencePath("a//b")).toBe(false);
    expect(isSafeReferencePath("./a")).toBe(false);
  });
});
