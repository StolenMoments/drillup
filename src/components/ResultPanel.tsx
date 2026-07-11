"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import type {
  ChoiceExplanationDto,
  GenerationEngineDto,
  HardenPreviewDto,
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
  | {
      status: "done";
      content: string;
      choiceExplanations: ChoiceExplanationDto[] | null;
      factualConcern: string | null;
    }
  | { status: "error"; message: string };

type HardenState =
  | { status: "idle" }
  | { status: "loading"; engine: GenerationEngineDto }
  | { status: "preview"; preview: HardenPreviewDto; applying: boolean }
  | { status: "applied" }
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
  answerIndices: number[],
): string {
  return answerIndices.map((answerIndex) => {
    const currentIndex = question.choices.findIndex((choice) => choice.original_index === answerIndex);
    return currentIndex < 0 ? `${answerIndex + 1}.` : `${currentIndex + 1}. ${question.choices[currentIndex].text}`;
  }).join(", ");
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

  const [harden, setHarden] = useState<HardenState>({ status: "idle" });

  async function requestHarden(engine: GenerationEngineDto) {
    setHarden({ status: "loading", engine });
    try {
      const preview = await api.questions.hardenChoices(question.id, engine);
      setHarden({ status: "preview", preview, applying: false });
    } catch (err) {
      setHarden({
        status: "error",
        message: err instanceof Error ? err.message : "요청 실패",
      });
    }
  }

  async function applyHarden() {
    if (harden.status !== "preview" || harden.applying) return;
    setHarden({ ...harden, applying: true });
    try {
      const detail = await api.questions.get(question.id);
      await api.questions.update(question.id, {
        payload: harden.preview.payload,
        explanation: detail.explanation,
      });
      setHarden({ status: "applied" });
    } catch (err) {
      setHarden({
        status: "error",
        message: err instanceof Error ? err.message : "적용 실패",
      });
    }
  }

  async function requestExplanation(engine: GenerationEngineDto) {
    setEngineStates((prev) => ({ ...prev, [engine]: { status: "loading" } }));
    try {
      const res = await api.questions.explain(question.id, engine);
      setEngineStates((prev) => ({
        ...prev,
        [engine]: {
          status: "done",
          content: res.content,
          choiceExplanations: res.choiceExplanations,
          factualConcern: res.factualConcern,
        },
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
            정답: {mcqAnswerText(question, result.correct.answer_indices)}
          </p>
        )}
      {result.correct.type === "MCQ" && result.correct.choice_explanations && question.type === "MCQ" && (() => {
        const choiceExplanations = result.correct.choice_explanations;
        return (
        <ul className="space-y-1 text-sm text-[color:var(--muted)]">
          {question.choices.map((choice) => <li key={choice.original_index}><span className="font-medium text-[color:var(--text)]">{choice.text}</span>: {choiceExplanations[choice.original_index]}</li>)}
        </ul>
        );
      })()}
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
            const choiceExplanations = state.choiceExplanations;
            return (
              <div key={value} className="surface surface-pad space-y-1">
                <p className="chip">{engineLabel(value)}</p>
                {state.factualConcern && (
                  <p className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    ⚠️ 사실 확인 필요: {state.factualConcern}
                  </p>
                )}
                <p className="whitespace-pre-wrap text-[color:var(--muted)]">
                  {state.content}
                </p>
                {question.type === "MCQ" && choiceExplanations && (
                  <ul className="space-y-3 pt-2 text-sm">
                    {question.choices.map((choice) => {
                      const choiceExplanation = choiceExplanations.find(
                        (item) => item.choice === choice.text,
                      );
                      if (!choiceExplanation) return null;
                      return (
                        <li key={choice.original_index} className="space-y-1">
                          <p className="font-medium text-[color:var(--text)]">{choice.text}</p>
                          <p className="text-[color:var(--muted)]">{choiceExplanation.explanation}</p>
                          <a
                            href={choiceExplanation.awsReference.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex text-[color:var(--brand-strong)] underline underline-offset-2 hover:text-[color:var(--brand)]"
                          >
                            AWS 공식 문서: {choiceExplanation.awsReference.title}
                          </a>
                        </li>
                      );
                    })}
                  </ul>
                )}
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

      {question.type === "MCQ" && (
        <div className="space-y-2 border-t border-[color:var(--border)] pt-3">
          <p className="section-title">🎯 선지 난이도 올리기</p>
          {harden.status !== "applied" && (
            <div className="flex flex-wrap gap-2">
              {ENGINES.map(({ value }) => (
                <button
                  key={value}
                  onClick={() => requestHarden(value)}
                  disabled={
                    harden.status === "loading" ||
                    (harden.status === "preview" && harden.applying)
                  }
                  className="btn btn-secondary text-sm"
                >
                  {harden.status === "loading" && harden.engine === value
                    ? "수정본 받는 중..."
                    : `${engineLabel(value)}로 올리기`}
                </button>
              ))}
            </div>
          )}
          {harden.status === "error" && (
            <p className="text-[color:var(--danger)]">
              ❌ 수정본을 가져오지 못했습니다: {harden.message}
            </p>
          )}
          {harden.status === "preview" && (
            <div className="surface surface-pad space-y-2">
              <p className="chip">{engineLabel(harden.preview.engine)}</p>
              {harden.preview.factualConcern && (
                <p className="rounded-md border border-amber-400 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                  ⚠️ 사실 확인 필요: {harden.preview.factualConcern}
                </p>
              )}
              <p className="text-[color:var(--muted)]">
                {harden.preview.comment}
              </p>
              <ul className="space-y-2 text-sm">
                {harden.preview.payload.choices.map((newText, i) => {
                  const oldText = question.choices.find(
                    (choice) => choice.original_index === i,
                  )?.text;
                  const isAnswer =
                    harden.preview.payload.answer_indices.includes(i);
                  if (isAnswer) {
                    return (
                      <li key={i}>
                        <span className="font-medium text-[color:var(--text)]">
                          {newText}
                        </span>{" "}
                        <span className="chip">정답 유지 ✅</span>
                      </li>
                    );
                  }
                  if (oldText === newText) {
                    return (
                      <li key={i} className="text-[color:var(--muted)]">
                        {newText}
                      </li>
                    );
                  }
                  return (
                    <li key={i} className="space-y-1">
                      <p className="text-[color:var(--muted)] line-through">
                        {oldText}
                      </p>
                      <p className="font-medium text-[color:var(--text)]">
                        → {newText}
                      </p>
                    </li>
                  );
                })}
              </ul>
              <button
                onClick={applyHarden}
                disabled={harden.applying}
                className="btn btn-primary text-sm"
              >
                {harden.applying ? "적용 중..." : "✅ 적용하기"}
              </button>
            </div>
          )}
          {harden.status === "applied" && (
            <p className="text-[color:var(--success)]">
              적용됨 — 다음 학습부터 새 선지가 나옵니다 🎉
            </p>
          )}
        </div>
      )}

      <button
        onClick={onNext}
        className="btn btn-secondary w-full"
      >
        {isLast ? "완료" : "다음 문제"}
      </button>
    </div>
  );
}
