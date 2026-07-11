import { describe, expect, it } from "vitest";
import type { McqPayload } from "./types";
import { parseHardenJson } from "./harden-schema";

const original: McqPayload = {
  question: "S3 버킷을 퍼블릭 접근으로부터 보호하는 가장 좋은 방법은?",
  choices: ["퍼블릭 액세스 차단 활성화", "오답 A", "오답 B", "오답 C"],
  answer_indices: [0],
  choice_explanations: ["근거 1", "근거 2", "근거 3", "근거 4"],
};

function revisedJson(overrides: Record<string, unknown> = {}, comment = "오답을 교체했습니다"): string {
  return JSON.stringify({
    comment,
    revised: {
      question: original.question,
      choices: ["퍼블릭 액세스 차단 활성화", "버킷 정책으로 s3:GetObject를 모든 주체에 허용", "오답 B", "오답 C"],
      answer_indices: [0],
      choice_explanations: ["근거 1", "새 근거 2", "근거 3", "근거 4"],
      ...overrides,
    },
  });
}

describe("parseHardenJson", () => {
  it("정답과 구조가 유지된 수정본을 통과시킨다", () => {
    const result = parseHardenJson(revisedJson(), original);
    expect(result).toMatchObject({ ok: true, comment: "오답을 교체했습니다" });
    if (result.ok) {
      expect(result.payload.choices[1]).toBe("버킷 정책으로 s3:GetObject를 모든 주체에 허용");
    }
  });

  it("JSON이 아니면 실패한다", () => {
    expect(parseHardenJson("not json", original)).toEqual({
      ok: false,
      fatal: "올바른 JSON이 아닙니다",
    });
  });

  it("comment가 없으면 실패한다", () => {
    const raw = JSON.parse(revisedJson()) as Record<string, unknown>;
    delete raw.comment;
    expect(parseHardenJson(JSON.stringify(raw), original)).toEqual({
      ok: false,
      fatal: "comment와 revised가 필요합니다",
    });
  });

  it("revised가 MCQ payload 형식이 아니면 실패한다", () => {
    expect(
      parseHardenJson(JSON.stringify({ comment: "c", revised: { question: "q" } }), original),
    ).toEqual({ ok: false, fatal: "revised가 MCQ payload 형식에 맞지 않습니다" });
  });

  it("answer_indices나 choice_explanations가 없으면 실패한다", () => {
    // answer_index(레거시)만 있으면 mcqPayloadSchema는 통과하지만 이 기능에서는 거부한다
    const raw = JSON.parse(revisedJson()) as { revised: Record<string, unknown> };
    delete raw.revised.answer_indices;
    raw.revised.answer_index = 0;
    expect(parseHardenJson(JSON.stringify(raw), original)).toEqual({
      ok: false,
      fatal: "revised에는 answer_indices와 choice_explanations가 필요합니다",
    });
  });

  it("질문 텍스트가 바뀌면 실패한다", () => {
    expect(
      parseHardenJson(revisedJson({ question: "다른 질문?" }), original),
    ).toEqual({ ok: false, fatal: "질문 텍스트가 변경되었습니다" });
  });

  it("선지 개수가 바뀌면 실패한다", () => {
    expect(
      parseHardenJson(
        revisedJson({
          choices: ["퍼블릭 액세스 차단 활성화", "새 오답 1", "새 오답 2", "오답 C", "오답 D"],
          choice_explanations: ["1", "2", "3", "4", "5"],
        }),
        original,
      ),
    ).toEqual({ ok: false, fatal: "선지 개수가 변경되었습니다" });
  });

  it("answer_indices가 바뀌면 실패한다", () => {
    expect(
      parseHardenJson(revisedJson({ answer_indices: [1] }), original),
    ).toEqual({ ok: false, fatal: "answer_indices가 변경되었습니다" });
  });

  it("정답 선지 텍스트가 바뀌면 실패한다", () => {
    expect(
      parseHardenJson(
        revisedJson({
          choices: ["퍼블릭 액세스 차단을 켠다", "새 오답 1", "오답 B", "오답 C"],
        }),
        original,
      ),
    ).toEqual({ ok: false, fatal: "정답 선지가 변경되었습니다" });
  });

  it("오답 선지가 하나도 바뀌지 않으면 실패한다", () => {
    expect(
      parseHardenJson(
        revisedJson({ choices: [...original.choices] }),
        original,
      ),
    ).toEqual({ ok: false, fatal: "오답 선지가 하나도 변경되지 않았습니다" });
  });

  it("레거시 answer_index 원본도 처리한다", () => {
    const legacy: McqPayload = {
      question: original.question,
      choices: [...original.choices],
      answer_index: 0,
    };
    expect(parseHardenJson(revisedJson(), legacy)).toMatchObject({ ok: true });
  });
});
