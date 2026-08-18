import { describe, expect, it } from "vitest";
import {
  AIP_C01_REQUIRED_REFERENCES,
  getDefaultReferenceFiles,
  isRequiredReferenceFile,
} from "./reference-selection";

const REFERENCE_FILES = [
  ...AIP_C01_REQUIRED_REFERENCES,
  "d1/foundation.md",
  "d1/data.md",
  "d2/implementation.md",
  "d3/security.md",
  "d4/optimization.md",
  "d5/testing.md",
  "notes/weak-areas.md",
];

describe("getDefaultReferenceFiles", () => {
  it.each([1, 2, 3, 4, 5])(
    "AIP-C01 D%i은 필수 자료와 같은 도메인 자료만 선택한다",
    (domain) => {
      const selected = getDefaultReferenceFiles({
        referenceDir: "aip-c01",
        topicName: `AIP-C01 D${domain} — 도메인`,
        availableFiles: REFERENCE_FILES,
      });

      expect(selected).toEqual(
        new Set([
          ...AIP_C01_REQUIRED_REFERENCES,
          ...REFERENCE_FILES.filter((file) => file.startsWith(`d${domain}/`)),
        ]),
      );
    },
  );

  it("도메인을 판별할 수 없는 AIP-C01 주제는 전체 자료를 선택한다", () => {
    expect(
      getDefaultReferenceFiles({
        referenceDir: "aip-c01",
        topicName: "AIP-C01 종합",
        availableFiles: REFERENCE_FILES,
      }),
    ).toEqual(new Set(REFERENCE_FILES));
  });

  it("다른 참고자료 폴더는 기존처럼 전체 자료를 선택한다", () => {
    expect(
      getDefaultReferenceFiles({
        referenceDir: "another-exam",
        topicName: "다른 시험 D1",
        availableFiles: ["common.md", "domain.md"],
      }),
    ).toEqual(new Set(["common.md", "domain.md"]));
  });
});

describe("isRequiredReferenceFile", () => {
  it("AIP-C01 공통 필수 자료만 필수로 판정한다", () => {
    expect(
      isRequiredReferenceFile("aip-c01", "common/00-exam-guide.md"),
    ).toBe(true);
    expect(isRequiredReferenceFile("aip-c01", "d1/foundation.md")).toBe(
      false,
    );
    expect(
      isRequiredReferenceFile("another-exam", "common/00-exam-guide.md"),
    ).toBe(false);
  });
});
