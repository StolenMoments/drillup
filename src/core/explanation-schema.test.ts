import { describe, expect, it } from "vitest";
import { parseExplanationJson } from "./explanation-schema";

const mcqPayload = {
  question: "S3에 객체를 저장하는 방법은?",
  choices: ["S3 버킷 사용", "EC2 인스턴스 중지"],
  answer_index: 0,
};

describe("parseExplanationJson", () => {
  it("정상 JSON을 파싱한다", () => {
    const result = parseExplanationJson('{"explanation":"정답은 A입니다."}');
    expect(result).toEqual({
      ok: true,
      explanation: "정답은 A입니다.",
      choiceExplanations: null,
      factualConcern: null,
    });
  });

  it("JSON이 아니면 실패한다", () => {
    const result = parseExplanationJson("이건 JSON이 아님");
    expect(result.ok).toBe(false);
  });

  it("explanation이 빈 문자열이면 실패한다", () => {
    const result = parseExplanationJson('{"explanation":"   "}');
    expect(result.ok).toBe(false);
  });

  it("explanation 필드가 없으면 실패한다", () => {
    const result = parseExplanationJson('{"foo":"bar"}');
    expect(result.ok).toBe(false);
  });

  it("객관식의 선지별 해설과 AWS 공식 문서를 파싱한다", () => {
    const result = parseExplanationJson(JSON.stringify({
      explanation: "S3가 적합합니다.",
      choice_explanations: [
        {
          choice: "S3 버킷 사용",
          explanation: "객체 스토리지 서비스입니다.",
          aws_reference: {
            title: "Amazon S3 User Guide",
            url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html",
          },
        },
        {
          choice: "EC2 인스턴스 중지",
          explanation: "객체 저장 기능이 아닙니다.",
          aws_reference: {
            title: "Amazon EC2 User Guide",
            url: "https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/concepts.html",
          },
        },
      ],
    }), "MCQ", mcqPayload);

    expect(result).toMatchObject({
      ok: true,
      choiceExplanations: [
        { choice: "S3 버킷 사용", awsReference: { title: "Amazon S3 User Guide" } },
        { choice: "EC2 인스턴스 중지", awsReference: { title: "Amazon EC2 User Guide" } },
      ],
    });
  });

  it("객관식에서 AWS 공식 문서가 아닌 URL을 거부한다", () => {
    const result = parseExplanationJson(JSON.stringify({
      explanation: "해설",
      choice_explanations: mcqPayload.choices.map((choice) => ({
        choice,
        explanation: "해설",
        aws_reference: { title: "문서", url: "https://example.com/docs" },
      })),
    }), "MCQ", mcqPayload);

    expect(result.ok).toBe(false);
  });

  it("객관식에서 중복 또는 누락된 선택지 해설을 거부한다", () => {
    const result = parseExplanationJson(JSON.stringify({
      explanation: "해설",
      choice_explanations: [
        {
          choice: "S3 버킷 사용",
          explanation: "해설",
          aws_reference: {
            title: "문서",
            url: "https://docs.aws.amazon.com/AmazonS3/latest/userguide/Welcome.html",
          },
        },
      ],
    }), "MCQ", mcqPayload);

    expect(result.ok).toBe(false);
  });
});

describe("factual_concern", () => {
  it("factual_concern이 있으면 파싱 결과에 포함한다", () => {
    const result = parseExplanationJson(
      JSON.stringify({
        explanation: "해설",
        factual_concern: "정답 전제가 공식 문서와 다릅니다. https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-management.html",
      }),
    );
    expect(result).toMatchObject({
      ok: true,
      factualConcern: "정답 전제가 공식 문서와 다릅니다. https://docs.aws.amazon.com/bedrock/latest/userguide/prompt-management.html",
    });
  });

  it("factual_concern이 없으면 null이다", () => {
    const result = parseExplanationJson(JSON.stringify({ explanation: "해설" }));
    expect(result).toMatchObject({ ok: true, factualConcern: null });
  });
});
