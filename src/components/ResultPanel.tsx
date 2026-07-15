"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import type {
  ChoiceHardeningJobDto,
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
  | { status: "loading"; engine: GenerationEngineDto }
  | { status: "tracking"; job: ChoiceHardeningJobDto; pollError: string | null }
  | { status: "preview"; job: ChoiceHardeningJobDto; preview: HardenPreviewDto; applying: boolean }
  | { status: "applied" }
  | { status: "error"; message: string; job?: ChoiceHardeningJobDto };

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

function hardenStateForJob(job: ChoiceHardeningJobDto): HardenState {
  if (job.status === "SUCCEEDED" && job.preview) {
    return { status: "preview", job, preview: job.preview, applying: false };
  }
  if (job.status === "FAILED") {
    return { status: "error", message: job.errorMessage ?? "작업이 실패했습니다", job };
  }
  return { status: "tracking", job, pollError: null };
}

function userFacingError(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.code === "NETWORK_ERROR") {
    return "연결이 끊겼습니다. 앱으로 돌아오면 진행 상태를 다시 확인할 수 있습니다.";
  }
  return error instanceof Error ? error.message : fallback;
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
  >({
    CLAUDE: { status: "idle" },
    CODEX: { status: "idle" },
    ANTIGRAVITY: { status: "idle" },
  });

  const [harden, setHarden] = useState<HardenState>({ status: "idle" });
  const [factualApplied, setFactualApplied] = useState(false);

  // 사실 확인 이의가 적용되어 문제 payload가 바뀌었으므로, 이전 문제를 기준으로 한
  // 해설/난이도 강화 상태는 모두 무효화한다. 배너가 함께 언마운트되므로
  // 성공 메시지는 언마운트되지 않는 위치에서 factualApplied로 렌더한다.
  function resetAfterFactualApply() {
    setEngineStates(idleEngineStates());
    setHarden({ status: "idle" });
    setFactualApplied(true);
  }

  const pollHardenJob = useCallback(async (jobId: number) => {
    try {
      const { job } = await api.questions.getHardenChoices(question.id, jobId);
      setHarden((current) => {
        if (current.status !== "tracking" || current.job.id !== jobId) return current;
        return hardenStateForJob(job);
      });
    } catch (error) {
      setHarden((current) => {
        if (current.status !== "tracking" || current.job.id !== jobId) return current;
        if (error instanceof ApiError && error.code === "NETWORK_ERROR") {
          return { ...current, pollError: userFacingError(error, "진행 상태 확인 실패") };
        }
        return {
          status: "error",
          message: userFacingError(error, "진행 상태 확인 실패"),
          job: current.job,
        };
      });
    }
  }, [question.id]);

  const trackedJobId = harden.status === "tracking" ? harden.job.id : null;

  useEffect(() => {
    if (trackedJobId === null) return;
    const refresh = () => void pollHardenJob(trackedJobId);
    const interval = window.setInterval(refresh, 5_000);
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const onPageShow = () => refresh();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [pollHardenJob, trackedJobId]);

  async function requestHarden(engine: GenerationEngineDto, force = false) {
    setHarden({ status: "loading", engine });
    try {
      const { job } = await api.questions.hardenChoices(question.id, engine, force);
      setHarden(hardenStateForJob(job));
    } catch (err) {
      setHarden({
        status: "error",
        message: userFacingError(err, "요청 실패"),
      });
    }
  }

  async function applyHarden() {
    if (harden.status !== "preview" || harden.applying) return;
    setHarden({ ...harden, applying: true });
    try {
      await api.questions.applyHardenChoices(question.id, harden.job.id);
      setEngineStates(idleEngineStates());
      setHarden({ status: "applied" });
    } catch (err) {
      setHarden({
        status: "error",
        message: userFacingError(err, "적용 실패"),
        job: harden.job,
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
            <div className="flex flex-wrap gap-2">
              {ENGINES.map(({ value }) => (
                <button
                  key={value}
                  onClick={() => requestHarden(value)}
                  disabled={
                    harden.status === "loading" ||
                    harden.status === "tracking" ||
                    (harden.status === "preview" && harden.applying)
                  }
                  className="btn btn-secondary text-sm"
                >
                  {(harden.status === "loading" && harden.engine === value) ||
                  (harden.status === "tracking" && harden.job.engine === value)
                    ? "생성 중..."
                    : `${engineLabel(value)}로 올리기`}
                </button>
              ))}
            </div>
          )}
          {harden.status === "tracking" && (
            <div
              className="rounded-[10px] border border-[color:var(--brand)] bg-[color:var(--brand-soft)] px-3 py-2 text-sm"
              role="status"
              aria-live="polite"
            >
              <p className="font-semibold">생성 중...</p>
              <p className="mt-1 text-[color:var(--muted)]">
                앱을 잠시 나가도 작업은 서버에서 계속됩니다. 돌아오면 진행 상태를 다시 확인합니다.
              </p>
              {harden.pollError && (
                <p
                  className="mt-2 rounded-[10px] bg-[color:var(--warning-soft)] px-3 py-2 text-[color:var(--text)]"
                  role="alert"
                >
                  ⚠️ {harden.pollError} 자동 확인은 계속됩니다.
                </p>
              )}
            </div>
          )}
          {harden.status === "error" && (
            <div className="space-y-2">
              <p className="text-[color:var(--danger)]">
                ❌ 수정본을 가져오지 못했습니다: {harden.message}
              </p>
              {harden.job && (
                <button
                  onClick={() => requestHarden(harden.job!.engine, true)}
                  className="btn btn-secondary text-sm"
                >
                  새로 생성
                </button>
              )}
            </div>
          )}
          {harden.status === "preview" && (
            <div className="surface surface-pad space-y-2">
              <p className="chip">{engineLabel(harden.preview.engine)}</p>
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
              <button
                onClick={() => requestHarden(harden.job.engine, true)}
                disabled={harden.applying}
                className="btn btn-secondary ml-2 text-sm"
              >
                새로 생성
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
