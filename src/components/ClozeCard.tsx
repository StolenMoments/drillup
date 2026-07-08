"use client";

import { useMemo, useState } from "react";
import type { StudyQuestionDto } from "@/lib/api-types";

type ClozeQuestion = Extract<StudyQuestionDto, { type: "CLOZE" }>;

type Part = { kind: "text"; value: string } | { kind: "blank"; id: number };

interface ClozeCardProps {
  question: ClozeQuestion;
  disabled: boolean;
  onSubmit: (filled: Record<string, string>) => void;
}

function splitParts(text: string): Part[] {
  const parts: Part[] = [];
  const re = /\{\{(\d+)\}\}/g;
  let last = 0;
  for (const match of text.matchAll(re)) {
    const index = match.index ?? 0;
    if (index > last) {
      parts.push({ kind: "text", value: text.slice(last, index) });
    }
    parts.push({ kind: "blank", id: Number(match[1]) });
    last = index + match[0].length;
  }
  if (last < text.length) {
    parts.push({ kind: "text", value: text.slice(last) });
  }
  return parts;
}

export default function ClozeCard({
  question,
  disabled,
  onSubmit,
}: ClozeCardProps) {
  const [filled, setFilled] = useState<Record<string, string>>({});
  const parts = useMemo(() => splitParts(question.text), [question.text]);

  const usedWords = new Set(Object.values(filled));
  const allFilled = question.blankIds.every((id) => filled[String(id)]);

  function fillWord(word: string) {
    const empty = question.blankIds.find((id) => !filled[String(id)]);
    if (empty === undefined) return;
    setFilled((prev) => ({ ...prev, [String(empty)]: word }));
  }

  function clearBlank(id: number) {
    setFilled((prev) => {
      const next = { ...prev };
      delete next[String(id)];
      return next;
    });
  }

  return (
    <div className="surface surface-pad space-y-5">
      <p className="text-lg leading-10 text-[color:var(--text)]">
        {parts.map((part, index) =>
          part.kind === "text" ? (
            <span key={index}>{part.value}</span>
          ) : (
            <button
              key={index}
              disabled={disabled}
              onClick={() => clearBlank(part.id)}
              className={`mx-1 inline-block min-w-16 rounded-lg border px-2 py-0.5 align-baseline transition-colors ${
                filled[String(part.id)]
                  ? "border-[color:var(--brand)] bg-[color:var(--brand-soft)] text-white"
                  : "border-[color:var(--border)] bg-[oklch(0.21_0.026_252)] text-[color:var(--subtle)]"
              }`}
            >
              {filled[String(part.id)] ?? "__"}
            </button>
          ),
        )}
      </p>
      <div className="flex flex-wrap gap-2">
        {question.wordBank.map((word, index) => (
          <button
            key={index}
            disabled={disabled || usedWords.has(word)}
            onClick={() => fillWord(word)}
            className="btn btn-secondary min-h-9 px-3 py-2 disabled:opacity-30"
          >
            {word}
          </button>
        ))}
      </div>
      <button
        disabled={disabled || !allFilled}
        onClick={() => onSubmit(filled)}
        className="btn btn-primary w-full"
      >
        제출
      </button>
    </div>
  );
}
