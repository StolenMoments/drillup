"use client";

import type { ReviewResultDto, StudyQuestionDto } from "@/lib/api-types";

interface ResultPanelProps {
  question: StudyQuestionDto;
  result: ReviewResultDto;
  onNext: () => void;
  isLast: boolean;
}

function resultTitle(isCorrect: boolean): string {
  if (isCorrect) return "정답입니다 ✅";
  return "오답입니다 ❌";
}

export default function ResultPanel({
  question,
  result,
  onNext,
  isLast,
}: ResultPanelProps) {
  return (
    <div
      className={`space-y-3 rounded border p-4 ${
        result.isCorrect
          ? "border-emerald-700 bg-emerald-950/40"
          : "border-red-700 bg-red-950/40"
      }`}
    >
      <p className="text-lg font-bold">{resultTitle(result.isCorrect)}</p>
      {!result.isCorrect &&
        result.correct.type === "MCQ" &&
        question.type === "MCQ" && (
          <p>
            정답: {result.correct.answer_index + 1}.{" "}
            {question.choices[result.correct.answer_index]}
          </p>
        )}
      {!result.isCorrect && result.correct.type === "CLOZE" && (
        <p>
          정답:{" "}
          {Object.entries(result.correct.answers)
            .map(([id, word]) => `${id}번 = ${word}`)
            .join(", ")}
        </p>
      )}
      {result.explanation && (
        <p className="text-slate-300">{result.explanation}</p>
      )}
      <button
        onClick={onNext}
        className="w-full rounded bg-slate-700 py-3 font-semibold"
      >
        {isLast ? "완료" : "다음 문제"}
      </button>
    </div>
  );
}
