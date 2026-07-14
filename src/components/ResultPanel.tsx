"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import type {
  ChoiceExplanationDto,
  FactualReviewDto,
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
  nextLabel?: string;
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
  | { status: "loading" }
  | { status: "preview"; preview: HardenPreviewDto; applying: boolean }
  | { status: "applied" }
  | { status: "error"; message: string };

function engineLabel(engine: GenerationEngineDto): string {
  if (engine === "CLAUDE") return "Claude";
  if (engine === "CODEX") return "Codex";
  return "Antigravity";
}

function idleEngineStates(): Record<GenerationEngineDto, EngineState> {
  return {
    CLAUDE: { status: "idle" },
    CODEX: { status: "idle" },
    ANTIGRAVITY: { status: "idle" },
  };
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

type FactualReviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "result"; result: FactualReviewDto; applying: boolean }
  | { status: "error"; message: string };

interface FactualConcernBannerProps {
  questionId: number;
  question: StudyQuestionDto;
  concern: string;
  onApplied: () => void;
}

function FactualConcernBanner({
  questionId,
  question,
  concern,
  onApplied,
}: FactualConcernBannerProps) {
  const [engine, setEngine] = useState<GenerationEngineDto>("CLAUDE");
  const [state, setState] = useState<FactualReviewState>({ status: "idle" });

  async function requestReview() {
    setState({ status: "loading" });
    try {
      const result = await api.questions.reviewFact(questionId, engine, concern);
      setState({ status: "result", result, applying: false });
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "요청 실패",
      });
    }
  }

  async function applyReview() {
    if (state.status !== "result" || state.applying || !state.result.payload) return;
    const payload = state.result.payload;
    setState({ ...state, applying: true });
    try {
      await api.questions.update(questionId, { payload, explanation: null });
      // 부모가 해설/하드닝 상태를 리셋하면서 이 배너는 언마운트되고,
      // 성공 메시지는 부모(ResultPanel)의 안정적인 위치에서 렌더된다.
      onApplied();
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "적용 실패",
      });
    }
  }

  const busy = state.status === "loading" || (state.status === "result" && state.applying);

  return (
    <div className="space-y-2">
      <p className="rounded-[12px] border border-[color:var(--warning)] bg-[color:var(--warning-soft)] px-3 py-2 text-sm">
        ⚠️ 사실 확인 필요: {concern}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={engine}
          onChange={(event) => setEngine(event.target.value as GenerationEngineDto)}
          disabled={busy}
          className="field"
        >
          {ENGINES.map(({ value }) => (
            <option key={value} value={value}>
              {engineLabel(value)}
            </option>
          ))}
        </select>
        <button
          onClick={requestReview}
          disabled={busy}
          className="btn btn-secondary text-sm"
        >
          {state.status === "loading" ? "확인 중..." : "🔍 사실 확인 요청"}
        </button>
      </div>
      {state.status === "error" && (
        <p className="text-[color:var(--danger)]">❌ {state.message}</p>
      )}
      {state.status === "result" && state.result.verdict === "rejected" && (
        <div className="surface surface-pad space-y-1">
          <p className="text-[color:var(--success)]">✅ 문제에 이상이 없습니다</p>
          <p className="text-[color:var(--muted)]">{state.result.comment}</p>
          {state.result.evidenceUrl && (
            <a
              href={state.result.evidenceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex text-[color:var(--brand-strong)] underline underline-offset-2 hover:text-[color:var(--brand)]"
            >
              근거 문서 보기
            </a>
          )}
        </div>
      )}
      {state.status === "result" && state.result.verdict === "unverifiable" && (
        <div className="surface surface-pad space-y-1">
          <p>판단 불가</p>
          <p className="text-[color:var(--muted)]">{state.result.comment}</p>
        </div>
      )}
      {state.status === "result" &&
        state.result.verdict === "confirmed" &&
        state.result.payload &&
        question.type === "MCQ" &&
        (() => {
          const payload = state.result.payload;
          const applying = state.applying;
          return (
            <div className="surface surface-pad space-y-2">
              <p className="text-[color:var(--muted)]">{state.result.comment}</p>
              {state.result.evidenceUrl && (
                <a
                  href={state.result.evidenceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex text-[color:var(--brand-strong)] underline underline-offset-2 hover:text-[color:var(--brand)]"
                >
                  근거 문서 보기
                </a>
              )}
              <div className="diff-comparison" aria-label="문제와 선지 원본 및 교정 비교">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="section-title">원본 ↔ 교정 비교</h3>
                    <p className="muted mt-1 text-xs">사실 오류를 바로잡은 내용을 확인하세요.</p>
                  </div>
                  <div className="diff-legend" aria-label="변경 범례">
                    <span className="diff-legend-item"><del className="diff-deleted">원본</del></span>
                    <span className="diff-legend-item"><ins className="diff-added">교정</ins></span>
                  </div>
                </div>
                <div className="diff-comparison-grid">
                  <section className="diff-panel">
                    <h4 className="diff-panel-title">문제 본문</h4>
                    <del className="diff-deleted">{question.question}</del>
                    <ins className="diff-added ml-1">{payload.question}</ins>
                  </section>
                </div>
                <ul className="space-y-2 text-sm">
                  {payload.choices.map((newText, i) => {
                    const oldText =
                      question.choices.find((choice) => choice.original_index === i)?.text ??
                      "(원본 없음)";
                    const isAnswer = payload.answer_indices.includes(i);
                    if (oldText === newText) {
                      return (
                        <li key={i} className="diff-panel">
                          <p className="font-medium">
                            선지 {i + 1} {isAnswer && <span className="chip ml-1">정답 ✅</span>}
                          </p>
                          <p className="text-[color:var(--muted)]">변경 없음: {newText}</p>
                        </li>
                      );
                    }
                    return (
                      <li key={i} className="diff-panel space-y-1">
                        <p className="font-medium">
                          선지 {i + 1} {isAnswer && <span className="chip ml-1">정답 ✅</span>}
                        </p>
                        <p><del className="diff-deleted">{oldText}</del></p>
                        <p><ins className="diff-added">{newText}</ins></p>
                      </li>
                    );
                  })}
                </ul>
              </div>
              <button
                onClick={applyReview}
                disabled={applying}
                className="btn btn-primary text-sm"
              >
                {applying ? "적용 중..." : "✅ 적용하기"}
              </button>
            </div>
          );
        })()}
    </div>
  );
}

export default function ResultPanel({
  question,
  result,
  onNext,
  isLast,
  nextLabel,
}: ResultPanelProps) {
  const [engineStates, setEngineStates] = useState<
    Record<GenerationEngineDto, EngineState>
  >(idleEngineStates);

  const [harden, setHarden] = useState<HardenState>({ status: "idle" });
  const [hardenEngine, setHardenEngine] = useState<GenerationEngineDto>("CLAUDE");
  const [verifyEngine, setVerifyEngine] = useState<GenerationEngineDto>("CODEX");
  const [factualApplied, setFactualApplied] = useState(false);

  // 사실 확인 이의가 적용되어 문제 payload가 바뀌었으므로, 이전 문제를 기준으로 한
  // 해설/난이도 강화 상태는 모두 무효화한다. 배너가 함께 언마운트되므로
  // 성공 메시지는 언마운트되지 않는 위치에서 factualApplied로 렌더한다.
  function resetAfterFactualApply() {
    setEngineStates(idleEngineStates());
    setHarden({ status: "idle" });
    setFactualApplied(true);
  }

  async function requestHarden() {
    setHarden({ status: "loading" });
    try {
      const preview = await api.questions.hardenChoices(
        question.id,
        hardenEngine,
        verifyEngine,
      );
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
      await api.questions.update(question.id, {
        payload: harden.preview.payload,
        explanation: null,
      });
      setEngineStates(idleEngineStates());
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
      {factualApplied && (
        <p className="text-[color:var(--success)]">
          ✅ 사실 교정이 적용되었습니다 — 다음 학습부터 교정된 문제가 나옵니다 🎉
        </p>
      )}
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
                  <FactualConcernBanner
                    questionId={question.id}
                    question={question}
                    concern={state.factualConcern}
                    onApplied={resetAfterFactualApply}
                  />
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
            <div className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
              <label className="space-y-1 text-sm">
                <span className="font-medium">변형 생성 엔진</span>
                <select
                  value={hardenEngine}
                  onChange={(event) => setHardenEngine(event.target.value as GenerationEngineDto)}
                  disabled={harden.status === "loading" || (harden.status === "preview" && harden.applying)}
                  className="field"
                >
                  {ENGINES.map(({ value }) => (
                    <option key={value} value={value}>{engineLabel(value)}</option>
                  ))}
                </select>
              </label>
              <label className="space-y-1 text-sm">
                <span className="font-medium">의미 검증 엔진</span>
                <select
                  value={verifyEngine}
                  onChange={(event) => setVerifyEngine(event.target.value as GenerationEngineDto)}
                  disabled={harden.status === "loading" || (harden.status === "preview" && harden.applying)}
                  className="field"
                >
                  {ENGINES.map(({ value }) => (
                    <option key={value} value={value}>{engineLabel(value)}</option>
                  ))}
                </select>
              </label>
              <button
                onClick={requestHarden}
                disabled={
                  harden.status === "loading" ||
                  (harden.status === "preview" && harden.applying)
                }
                className="btn btn-secondary text-sm"
              >
                {harden.status === "loading" ? "검증 중..." : "의미 보존 변형 만들기"}
              </button>
            </div>
          )}
          {harden.status === "error" && (
            <p className="text-[color:var(--danger)]">
              ❌ 수정본을 가져오지 못했습니다: {harden.message}
            </p>
          )}
          {harden.status === "preview" && (
            <div className="surface surface-pad space-y-2">
              <div className="flex flex-wrap gap-2">
                <p className="chip">생성: {engineLabel(harden.preview.engine)}</p>
                <p className="chip">검증: {engineLabel(harden.preview.verifyEngine)}</p>
              </div>
              {harden.preview.factualConcern && (
                <FactualConcernBanner
                  questionId={question.id}
                  question={question}
                  concern={harden.preview.factualConcern}
                  onApplied={resetAfterFactualApply}
                />
              )}
              <p className="text-[color:var(--muted)]">
                {harden.preview.comment}
              </p>
              <p className="rounded-[10px] border border-[color:var(--success)] bg-[color:var(--success-soft)] px-3 py-2 text-sm">
                ✅ 의미 보존 검증 통과: {harden.preview.verificationComment}
              </p>
              <div className="diff-comparison" aria-label="문제와 선지 원본 및 변형 비교">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <h3 className="section-title">원본 ↔ 변형 비교</h3>
                    <p className="muted mt-1 text-xs">문제 본문과 정답·오답의 변경 내용을 확인하세요.</p>
                  </div>
                  <div className="diff-legend" aria-label="변경 범례">
                    <span className="diff-legend-item"><del className="diff-deleted">원본</del></span>
                    <span className="diff-legend-item"><ins className="diff-added">변형</ins></span>
                  </div>
                </div>
                <div className="diff-comparison-grid">
                  <section className="diff-panel">
                    <h4 className="diff-panel-title">문제 본문</h4>
                    <del className="diff-deleted">{question.question}</del>
                    <ins className="diff-added ml-1">{harden.preview.payload.question}</ins>
                  </section>
                  <section className="diff-panel">
                    <h4 className="diff-panel-title">변경 요약</h4>
                    <p className="text-sm text-[color:var(--muted)]">정답 인덱스와 선지 순서는 유지됩니다.</p>
                    <p className="mt-1 text-sm text-[color:var(--muted)]">검증 의견: {harden.preview.verificationComment}</p>
                  </section>
                </div>
                <ul className="space-y-2 text-sm">
                {harden.preview.payload.choices.map((newText, i) => {
                  const oldText = question.choices.find(
                    (choice) => choice.original_index === i,
                  )?.text ?? "(원본 없음)";
                  const isAnswer =
                    harden.preview.payload.answer_indices.includes(i);
                  if (oldText === newText) {
                    return (
                      <li key={i} className="diff-panel">
                        <p className="font-medium">선지 {i + 1} {isAnswer && <span className="chip ml-1">정답 ✅</span>}</p>
                        <p className="text-[color:var(--muted)]">변경 없음: {newText}</p>
                      </li>
                    );
                  }
                  return (
                    <li key={i} className="diff-panel space-y-1">
                      <p className="font-medium">선지 {i + 1} {isAnswer && <span className="chip ml-1">정답 ✅</span>}</p>
                      <p><del className="diff-deleted">{oldText}</del></p>
                      <p><ins className="diff-added">{newText}</ins></p>
                    </li>
                  );
                })}
                </ul>
              </div>
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
        {nextLabel ?? (isLast ? "완료" : "다음 문제")}
      </button>
    </div>
  );
}
