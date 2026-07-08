"use client";

import { useState } from "react";
import type { StudyQuestionDto } from "@/lib/api-types";

type McqQuestion = Extract<StudyQuestionDto, { type: "MCQ" }>;

interface McqCardProps {
  question: McqQuestion;
  disabled: boolean;
  onSubmit: (selectedOriginalIndex: number) => void;
}

export default function McqCard({
  question,
  disabled,
  onSubmit,
}: McqCardProps) {
  const [selected, setSelected] = useState<number | null>(null);

  return (
    <div className="surface surface-pad space-y-5">
      <p className="text-lg leading-8 text-[color:var(--text)]">
        {question.question}
      </p>
      <div className="space-y-2">
        {question.choices.map((choice, index) => (
          <button
            key={choice.original_index}
            disabled={disabled}
            onClick={() => setSelected(index)}
            className={`w-full rounded-[10px] border px-4 py-3 text-left transition-colors ${
              selected === index
                ? "border-[color:var(--brand)] bg-[color:var(--brand-soft)] text-white"
                : "border-[color:var(--border)] bg-[oklch(0.22_0.026_252)] text-[color:var(--text)] hover:border-[color:var(--border-strong)]"
            }`}
          >
            <span className="mr-2 text-[color:var(--subtle)]">{index + 1}</span>
            {choice.text}
          </button>
        ))}
      </div>
      <button
        disabled={disabled || selected === null}
        onClick={() =>
          selected !== null &&
          onSubmit(question.choices[selected].original_index)
        }
        className="btn btn-primary w-full"
      >
        제출
      </button>
    </div>
  );
}
