"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import type {
  GenerationEngineDto,
  ReviewResultDto,
  StudyQuestionDto,
} from "@/lib/api-types";

interface ResultPanelProps {
  question: StudyQuestionDto;
  result: ReviewResultDto;
  onNext: () => void;
  isLast: boolean;
}

const ENGINES: { value: GenerationEngineDto; label: string }[] = [
  { value: "CLAUDE", label: "Claude로 해설받기" },
  { value: "CODEX", label: "Codex로 해설받기" },
  { value: "ANTIGRAVITY", label: "Antigravity로 해설받기" },
];

type EngineState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; content: string }
  | { status: "error"; message: string };

function engineLabel(engine: GenerationEngineDto): string {
  if (engine === "CLAUDE") return "Claude";
  if (engine === "CODEX") return "Codex";
  return "Antigravity";
}

function resultTitle(isCorrect: boolean): string {
  if (isCorrect) return "정답입니다 ✅";
  return "오답입니다 ❌";
}

function mcqAnswerText(
  question: Extract<StudyQuestionDto, { type: "MCQ" }>,
  answerIndex: number,
): string {
  const currentIndex = question.choices.findIndex(
    (choice) => choice.original_index === answerIndex,
  );
  if (currentIndex < 0) return `${answerIndex + 1}.`;

  const choice = question.choices[currentIndex];
  return `${currentIndex + 1}. ${choice.text}`;
}

export default function ResultPanel({
  question,
  result,
  onNext,
  isLast,
}: ResultPanelProps) {
  const [engineStates, setEngineStates] = useState<
    Record<GenerationEngineDto, EngineState>
  >({
    CLAUDE: { status: "idle" },
    CODEX: { status: "idle" },
    ANTIGRAVITY: { status: "idle" },
  });

  async function requestExplanation(engine: GenerationEngineDto) {
    setEngineStates((prev) => ({ ...prev, [engine]: { status: "loading" } }));
    try {
      const res = await api.questions.explain(question.id, engine);
      setEngineStates((prev) => ({
        ...prev,
        [engine]: { status: "done", content: res.content },
      }));
    } catch (err) {
      setEngineStates((prev) => ({
        ...prev,
        [engine]: {
          status: "error",
          message: err instanceof Error ? err.message : "요청 실패",
        },
      }));
    }
  }

  return (
    <div
      className={`space-y-3 rounded-[12px] border p-4 ${
        result.isCorrect
          ? "border-[color:var(--success)] bg-[color:var(--success-soft)]"
          : "border-[color:var(--danger)] bg-[color:var(--danger-soft)]"
      }`}
    >
      <p className="text-lg font-bold">{resultTitle(result.isCorrect)}</p>
      {!result.isCorrect &&
        result.correct.type === "MCQ" &&
        question.type === "MCQ" && (
          <p>
            정답: {mcqAnswerText(question, result.correct.answer_index)}
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
        <p className="text-[color:var(--muted)]">{result.explanation}</p>
      )}

      <div className="space-y-2 border-t border-[color:var(--border)] pt-3">
        <p className="section-title">🤖 AI 해설 받기</p>
        <div className="flex flex-wrap gap-2">
          {ENGINES.map(({ value, label }) => {
            const state = engineStates[value];
            return (
              <button
                key={value}
                onClick={() => requestExplanation(value)}
                disabled={state.status === "loading" || state.status === "done"}
                className="btn btn-secondary text-sm"
              >
                {state.status === "loading"
                  ? "불러오는 중..."
                  : state.status === "done"
                    ? `${label} ✓`
                    : label}
              </button>
            );
          })}
        </div>
        {ENGINES.map(({ value, label }) => {
          const state = engineStates[value];
          if (state.status === "done") {
            return (
              <div key={value} className="surface surface-pad space-y-1">
                <p className="chip">{engineLabel(value)}</p>
                <p className="whitespace-pre-wrap text-[color:var(--muted)]">
                  {state.content}
                </p>
              </div>
            );
          }
          if (state.status === "error") {
            return (
              <p key={value} className="text-[color:var(--danger)]">
                ❌ {label} 해설을 가져오지 못했습니다: {state.message}
              </p>
            );
          }
          return null;
        })}
      </div>

      <button
        onClick={onNext}
        className="btn btn-secondary w-full"
      >
        {isLast ? "완료" : "다음 문제"}
      </button>
    </div>
  );
}
