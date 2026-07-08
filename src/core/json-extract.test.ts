import { describe, expect, it } from "vitest";
import { extractJsonObject } from "./json-extract";

describe("extractJsonObject", () => {
  it("순수 JSON은 그대로 반환한다", () => {
    expect(extractJsonObject('{"questions": []}')).toBe('{"questions": []}');
  });

  it("코드 펜스로 감싼 JSON에서 객체만 추출한다", () => {
    expect(extractJsonObject('```json\n{"questions": []}\n```')).toBe(
      '{"questions": []}',
    );
  });

  it("앞뒤 설명 문장을 제거한다", () => {
    expect(
      extractJsonObject('생성 결과입니다.\n{"questions": [{"a": 1}]}\n확인해 주세요.'),
    ).toBe('{"questions": [{"a": 1}]}');
  });

  it("중괄호가 없으면 원문을 그대로 반환한다", () => {
    expect(extractJsonObject("JSON이 아닌 응답")).toBe("JSON이 아닌 응답");
  });

  it("닫는 중괄호가 여는 것보다 앞에만 있으면 원문을 그대로 반환한다", () => {
    expect(extractJsonObject("} 잘못된 {")).toBe("} 잘못된 {");
  });
});
