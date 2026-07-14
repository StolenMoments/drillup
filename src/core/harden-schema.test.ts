import { describe, expect, it } from "vitest";
import type { McqPayload } from "./types";
import { parseHardenJson } from "./harden-schema";

const original: McqPayload = {
  question: "S3 버킷을 퍼블릭 접근으로부터 보호하는 가장 좋은 방법은?",
  choices: ["퍼블릭 액세스 차단 활성화", "오답 A", "오답 B", "오답 C"],
  answer_indices: [0],
  choice_explanations: ["근거 1", "근거 2", "근거 3", "근거 4"],
};

const changedRevision = {
  question: "S3 버킷의 공개 노출을 막는 가장 효과적인 방법은 무엇인가요?",
  choices: [
    "퍼블릭 접근 차단 기능을 활성화하는 것",
    "버킷 정책으로 s3:GetObject를 모든 주체에 허용",
    "오답 B",
    "오답 C",
  ],
  answer_indices: [0],
  choice_explanations: ["새 근거 1", "새 근거 2", "근거 3", "근거 4"],
};

function revisedJson(
  revised: Record<string, unknown> = changedRevision,
  comment = "문제와 정답을 보수적으로 패러프레이즈했습니다",
): string {
  return JSON.stringify({ comment, revised });
}

describe("parseHardenJson", () => {
  it("문제와 모든 정답을 바꾸고 구조를 유지한 수정본을 통과시킨다", () => {
    const result = parseHardenJson(revisedJson(), original);
    expect(result).toMatchObject({
      ok: true,
      comment: "문제와 정답을 보수적으로 패러프레이즈했습니다",
    });
    if (result.ok) {
      expect(result.payload.question).not.toBe(original.question);
      expect(result.payload.choices[0]).not.toBe(original.choices[0]);
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
      parseHardenJson(
        JSON.stringify({ comment: "c", revised: { question: "q" } }),
        original,
      ),
    ).toEqual({ ok: false, fatal: "revised가 MCQ payload 형식에 맞지 않습니다" });
  });

  it("answer_indices나 choice_explanations가 없으면 실패한다", () => {
    const raw = JSON.parse(revisedJson()) as { revised: Record<string, unknown> };
    delete raw.revised.answer_indices;
    raw.revised.answer_index = 0;
    expect(parseHardenJson(JSON.stringify(raw), original)).toEqual({
      ok: false,
      fatal: "revised에는 answer_indices와 choice_explanations가 필요합니다",
    });
  });

  it("질문 텍스트가 바뀌지 않으면 실패한다", () => {
    expect(
      parseHardenJson(
        revisedJson({
          ...changedRevision,
          question: original.question,
        }),
        original,
      ),
    ).toEqual({ ok: false, fatal: "질문 텍스트가 변경되지 않았습니다" });
  });

  it("정답 선지 일부가 바뀌지 않으면 실패한다", () => {
    const multipleOriginal: McqPayload = {
      ...original,
      answer_indices: [0, 2],
    };
    expect(
      parseHardenJson(
        revisedJson({
          ...changedRevision,
          answer_indices: [0, 2],
          choices: [
            changedRevision.choices[0],
            changedRevision.choices[1],
            original.choices[2],
            changedRevision.choices[3],
          ],
        }),
        multipleOriginal,
      ),
    ).toEqual({ ok: false, fatal: "모든 정답 선지가 변경되어야 합니다" });
  });

  it("다중 정답 선지를 모두 바꾸면 통과시킨다", () => {
    const multipleOriginal: McqPayload = {
      ...original,
      answer_indices: [0, 2],
    };
    const result = parseHardenJson(
      revisedJson({
        ...changedRevision,
        answer_indices: [2, 0],
        choices: [
          changedRevision.choices[0],
          changedRevision.choices[1],
          "오답 B를 바꾼 정답 표현",
          changedRevision.choices[3],
        ],
        choice_explanations: ["새 근거 1", "새 근거 2", "새 근거 3", "근거 4"],
      }),
      multipleOriginal,
    );
    expect(result).toMatchObject({ ok: true });
  });

  it("선지 개수가 바뀌면 실패한다", () => {
    expect(
      parseHardenJson(
        revisedJson({
          ...changedRevision,
          choices: [...changedRevision.choices, "오답 D"],
          choice_explanations: ["1", "2", "3", "4", "5"],
        }),
        original,
      ),
    ).toEqual({ ok: false, fatal: "선지 개수가 변경되었습니다" });
  });

  it("answer_indices 집합이 바뀌면 실패한다", () => {
    expect(
      parseHardenJson(revisedJson({ ...changedRevision, answer_indices: [1] }), original),
    ).toEqual({ ok: false, fatal: "answer_indices가 변경되었습니다" });
  });

  it("선지 중복이 생기면 실패한다", () => {
    expect(
      parseHardenJson(
        revisedJson({ ...changedRevision, choices: ["같은 선지", "같은 선지", "오답 B", "오답 C"] }),
        original,
      ),
    ).toEqual({ ok: false, fatal: "revised가 MCQ payload 형식에 맞지 않습니다" });
  });

  it("보기별 해설 수가 선지 수와 다르면 실패한다", () => {
    expect(
      parseHardenJson(
        revisedJson({ ...changedRevision, choice_explanations: ["1", "2"] }),
        original,
      ),
    ).toEqual({ ok: false, fatal: "revised가 MCQ payload 형식에 맞지 않습니다" });
  });

  it("오답 선지가 하나도 바뀌지 않으면 실패한다", () => {
    expect(
      parseHardenJson(
        revisedJson({
          ...changedRevision,
          choices: [changedRevision.choices[0], ...original.choices.slice(1)],
        }),
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

describe("factual_concern", () => {
  const factualOriginal = {
    question: "Q",
    choices: ["a", "b", "c", "d"],
    answer_indices: [0],
    choice_explanations: ["e1", "e2", "e3", "e4"],
  };
  const revised = {
    ...changedRevision,
    question: "Q 변경",
    choices: ["a 변경", "x", "c", "d"],
    choice_explanations: ["e1 새", "e2 새", "e3", "e4"],
  };

  it("factual_concern이 있으면 결과에 포함한다", () => {
    const result = parseHardenJson(
      JSON.stringify({ comment: "교체", factual_concern: "정답 선지가 공식 문서와 다릅니다", revised }),
      factualOriginal,
    );
    expect(result).toMatchObject({ ok: true, factualConcern: "정답 선지가 공식 문서와 다릅니다" });
  });

  it("없으면 null이다", () => {
    const result = parseHardenJson(JSON.stringify({ comment: "교체", revised }), factualOriginal);
    expect(result).toMatchObject({ ok: true, factualConcern: null });
  });

  it("빈 문자열이면 null로 정규화한다", () => {
    const result = parseHardenJson(JSON.stringify({ comment: "교체", factual_concern: "", revised }), factualOriginal);
    expect(result).toMatchObject({ ok: true, factualConcern: null });
  });

  it("null이면 null로 정규화한다", () => {
    const result = parseHardenJson(JSON.stringify({ comment: "교체", factual_concern: null, revised }), factualOriginal);
    expect(result).toMatchObject({ ok: true, factualConcern: null });
  });
});
