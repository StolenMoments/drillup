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
  const [activeBlankId, setActiveBlankId] = useState<number | null>(
    question.blankIds[0] ?? null,
  );
  const [assignedWordIndexes, setAssignedWordIndexes] = useState<
    Record<string, number>
  >({});
  const parts = useMemo(() => splitParts(question.text), [question.text]);

  const usedWordIndexes = new Set(Object.values(assignedWordIndexes));
  const allFilled = question.blankIds.every(
    (id) => assignedWordIndexes[String(id)] !== undefined,
  );
  const activeBlankKey =
    activeBlankId === null ? undefined : String(activeBlankId);
  const activeBlankHasWord =
    activeBlankKey !== undefined &&
    assignedWordIndexes[activeBlankKey] !== undefined;
  const filled = Object.fromEntries(
    Object.entries(assignedWordIndexes).map(([blankId, wordIndex]) => [
      blankId,
      question.wordBank[wordIndex],
    ]),
  );

  function fillWord(wordIndex: number) {
    if (activeBlankId === null) return;

    const nextAssigned = {
      ...assignedWordIndexes,
      [String(activeBlankId)]: wordIndex,
    };
    setAssignedWordIndexes(nextAssigned);

    const nextEmpty = question.blankIds.find(
      (id) => nextAssigned[String(id)] === undefined,
    );
    if (nextEmpty !== undefined) {
      setActiveBlankId(nextEmpty);
    }
  }

  function clearBlank(id: number) {
    setAssignedWordIndexes((prev) => {
      const next = { ...prev };
      delete next[String(id)];
      return next;
    });
    setActiveBlankId(id);
  }

  function submit() {
    onSubmit(filled);
  }

  function blankClassName(id: number) {
    const hasWord = assignedWordIndexes[String(id)] !== undefined;
    const isSelected = activeBlankId === id;
    const base =
      "mx-1 inline-block min-w-16 rounded-lg border px-2 py-0.5 align-baseline transition-colors";

    if (disabled) {
      return `${base} ${
        hasWord
          ? "border-[color:var(--brand)] bg-[color:var(--brand-strong)] text-white"
          : "border-[color:var(--border)] bg-[color:var(--bg-soft)] text-[color:var(--subtle)]"
      }`;
    }

    if (isSelected) {
      return `${base} border-[color:var(--brand)] bg-[color:var(--brand-strong)] text-white ring-2 ring-[color:var(--brand)] ring-offset-2 ring-offset-[color:var(--surface)]`;
    }

    if (hasWord) {
      return `${base} border-[color:var(--brand)] bg-[color:var(--brand-strong)] text-white hover:border-[color:var(--brand)]`;
    }

    return `${base} border-[color:var(--border)] bg-[color:var(--bg-soft)] text-[color:var(--subtle)] hover:border-[color:var(--border-strong)] hover:text-[color:var(--text)]`;
  }

  function blankLabel(id: number) {
    const assignedIndex = assignedWordIndexes[String(id)];
    if (assignedIndex === undefined) return `${id}번 빈칸 선택`;
    return `${id}번 빈칸 선택, 현재 답 ${question.wordBank[assignedIndex]}`;
  }

  function blankText(id: number) {
    const assignedIndex = assignedWordIndexes[String(id)];
    if (assignedIndex === undefined) return "__";
    return question.wordBank[assignedIndex];
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
              onClick={() => setActiveBlankId(part.id)}
              aria-label={blankLabel(part.id)}
              aria-pressed={activeBlankId === part.id}
              className={blankClassName(part.id)}
            >
              {blankText(part.id)}
            </button>
          ),
        )}
      </p>
      <div className="flex justify-end">
        <button
          disabled={disabled || activeBlankId === null || !activeBlankHasWord}
          onClick={() => activeBlankId !== null && clearBlank(activeBlankId)}
          className="btn btn-secondary min-h-9 px-3 py-2 text-sm disabled:opacity-30"
        >
          비우기
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {question.wordBank.map((word, index) => (
          <button
            key={index}
            disabled={disabled || usedWordIndexes.has(index)}
            onClick={() => fillWord(index)}
            className="btn btn-secondary min-h-9 px-3 py-2 disabled:opacity-30"
          >
            {word}
          </button>
        ))}
      </div>
      <button
        disabled={disabled || !allFilled}
        onClick={submit}
        className="btn btn-primary w-full"
      >
        제출
      </button>
    </div>
  );
}
