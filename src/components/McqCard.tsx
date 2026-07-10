"use client";

import { useState } from "react";
import type { StudyQuestionDto } from "@/lib/api-types";

type McqQuestion = Extract<StudyQuestionDto, { type: "MCQ" }>;

interface McqCardProps {
  question: McqQuestion;
  disabled: boolean;
  onSubmit: (selectedOriginalIndices: number[]) => void;
}

export default function McqCard({
  question,
  disabled,
  onSubmit,
}: McqCardProps) {
  const [selected, setSelected] = useState<number[]>([]);
  const isMultiple = question.selectionCount === 2;

  function toggle(index: number) {
    if (!isMultiple) return setSelected([index]);
    setSelected((current) => current.includes(index)
      ? current.filter((value) => value !== index)
      : current.length === 2 ? current : [...current, index]);
  }

  return (
    <div className="surface surface-pad space-y-5">
      <p className="text-lg leading-8 text-[color:var(--text)]">
        {question.question}
      </p>
      {isMultiple && <p className="chip">정답 2개를 선택하세요 ({selected.length}/2)</p>}
      <div className="space-y-2">
        {question.choices.map((choice, index) => (
          <button
            key={choice.original_index}
            disabled={disabled}
            onClick={() => toggle(index)}
            className={`w-full rounded-[10px] border px-4 py-3 text-left transition-colors ${
              selected.includes(index)
                ? "border-[color:var(--brand)] bg-[color:var(--brand-strong)] text-white"
                : "border-[color:var(--border)] bg-[color:var(--bg-soft)] text-[color:var(--text)] hover:border-[color:var(--border-strong)]"
            }`}
          >
            <span
              className={`mr-2 ${selected.includes(index) ? "text-white/80" : "text-[color:var(--subtle)]"}`}
            >
              {index + 1}
            </span>
            {choice.text}
          </button>
        ))}
      </div>
      <button
        disabled={disabled || selected.length !== question.selectionCount}
        onClick={() =>
          selected.length === question.selectionCount &&
          onSubmit(selected.map((index) => question.choices[index].original_index))
        }
        className="btn btn-primary w-full"
      >
        제출
      </button>
    </div>
  );
}
