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
    <div className="space-y-4">
      <p className="text-lg">{question.question}</p>
      <div className="space-y-2">
        {question.choices.map((choice, index) => (
          <button
            key={choice.original_index}
            disabled={disabled}
            onClick={() => setSelected(index)}
            className={`w-full rounded border px-3 py-3 text-left ${
              selected === index
                ? "border-sky-500 bg-sky-950"
                : "border-slate-700 bg-slate-900"
            }`}
          >
            {index + 1}. {choice.text}
          </button>
        ))}
      </div>
      <button
        disabled={disabled || selected === null}
        onClick={() =>
          selected !== null &&
          onSubmit(question.choices[selected].original_index)
        }
        className="w-full rounded bg-sky-600 py-3 font-semibold disabled:opacity-50"
      >
        제출
      </button>
    </div>
  );
}
