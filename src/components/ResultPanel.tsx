"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { engineLabel } from "@/lib/engine-label";
import type {
  ChoiceExplanationDto,
  ChoiceHardeningJobDto,
  GenerationEngineDto,
  ReviewResultDto,
  StudyQuestionDto,
} from "@/lib/api-types";
import FactualConcernBanner from "./FactualConcernBanner";

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
const HARDEN_ENGINES: GenerationEngineDto[] = ["CLAUDE", "CODEX", "ANTIGRAVITY"];

type EngineState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "done"; content: string; choiceExplanations: ChoiceExplanationDto[] | null; factualConcern: string | null }
  | { status: "error"; message: string };

type HardenState =
  | { status: "idle" }
  | { status: "loading"; engine: GenerationEngineDto }
  | { status: "tracking"; job: ChoiceHardeningJobDto; pollError: string | null; succeededPolls: number }
  | { status: "autoApplied" }
  | { status: "needsReview"; kind: "concern" | "manual" }
  | { status: "error"; message: string; job?: ChoiceHardeningJobDto };

const MANUAL_REVIEW_POLL_THRESHOLD = 3;

function idleEngineStates(): Record<GenerationEngineDto, EngineState> {
  return { CLAUDE: { status: "idle" }, CODEX: { status: "idle" }, ANTIGRAVITY: { status: "idle" } };
}

function hardenStateForJob(job: ChoiceHardeningJobDto, succeededPolls = 0): HardenState {
  if (job.status === "FAILED") return { status: "error", message: job.errorMessage ?? "작업이 실패했습니다", job };
  if (job.status === "SUCCEEDED") {
    if (job.appliedAt) return { status: "autoApplied" };
    if (job.dismissedAt) return { status: "error", message: "이전 결과를 거절했습니다 — 새로 생성해 주세요", job };
    if (job.preview?.factualConcern) return { status: "needsReview", kind: "concern" };
    if (succeededPolls >= MANUAL_REVIEW_POLL_THRESHOLD) return { status: "needsReview", kind: "manual" };
    return { status: "tracking", job, pollError: null, succeededPolls };
  }
  return { status: "tracking", job, pollError: null, succeededPolls: 0 };
}

function userFacingError(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.code === "NETWORK_ERROR") return "연결이 끊겼습니다. 앱으로 돌아오면 진행 상태를 다시 확인할 수 있습니다.";
  return error instanceof Error ? error.message : fallback;
}

function mcqAnswerText(question: Extract<StudyQuestionDto, { type: "MCQ" }>, answerIndices: number[]): string {
  return answerIndices.map((answerIndex) => {
    const currentIndex = question.choices.findIndex((choice) => choice.original_index === answerIndex);
    return currentIndex < 0 ? `${answerIndex + 1}.` : `${currentIndex + 1}. ${question.choices[currentIndex].text}`;
  }).join(", ");
}

function bannerOriginal(question: Extract<StudyQuestionDto, { type: "MCQ" }>) {
  const choices: string[] = [];
  for (const choice of question.choices) choices[choice.original_index] = choice.text;
  return { question: question.question, choices };
}

export default function ResultPanel({ question, result, onNext, isLast, nextLabel }: ResultPanelProps) {
  const [engineStates, setEngineStates] = useState<Record<GenerationEngineDto, EngineState>>(idleEngineStates);
  const [harden, setHarden] = useState<HardenState>({ status: "idle" });
  const [factualApplied, setFactualApplied] = useState(false);

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
        const nextPolls = job.status === "SUCCEEDED" && !job.appliedAt && !job.preview?.factualConcern
          ? current.succeededPolls + 1 : 0;
        return hardenStateForJob(job, nextPolls);
      });
    } catch (error) {
      setHarden((current) => {
        if (current.status !== "tracking" || current.job.id !== jobId) return current;
        if (error instanceof ApiError && error.code === "NETWORK_ERROR") return { ...current, pollError: userFacingError(error, "진행 상태 확인 실패") };
        return { status: "error", message: userFacingError(error, "진행 상태 확인 실패"), job: current.job };
      });
    }
  }, [question.id]);

  const trackedJobId = harden.status === "tracking" ? harden.job.id : null;
  useEffect(() => {
    if (trackedJobId === null) return;
    const refresh = () => void pollHardenJob(trackedJobId);
    const interval = window.setInterval(refresh, 5_000);
    const onVisibilityChange = () => { if (document.visibilityState === "visible") refresh(); };
    const onPageShow = () => refresh();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisibilityChange); window.removeEventListener("pageshow", onPageShow); };
  }, [pollHardenJob, trackedJobId]);

  async function requestHarden(engine: GenerationEngineDto, force = false) {
    setHarden({ status: "loading", engine });
    try {
      const { job } = await api.questions.hardenChoices(question.id, engine, force);
      setHarden(hardenStateForJob(job));
    } catch (error) { setHarden({ status: "error", message: userFacingError(error, "요청 실패") }); }
  }

  async function requestExplanation(engine: GenerationEngineDto) {
    setEngineStates((prev) => ({ ...prev, [engine]: { status: "loading" } }));
    try {
      const res = await api.questions.explain(question.id, engine);
      setEngineStates((prev) => ({ ...prev, [engine]: { status: "done", content: res.content, choiceExplanations: res.choiceExplanations, factualConcern: res.factualConcern } }));
    } catch (error) {
      setEngineStates((prev) => ({ ...prev, [engine]: { status: "error", message: error instanceof Error ? error.message : "요청 실패" } }));
    }
  }

  const isCorrect = result.isCorrect;
  return (
    <div className={`space-y-3 rounded-[12px] border p-4 ${isCorrect ? "border-[color:var(--success)] bg-[color:var(--success-soft)]" : "border-[color:var(--danger)] bg-[color:var(--danger-soft)]"}`}>
      <p className="text-lg font-bold">{isCorrect ? "정답입니다 ✅" : "오답입니다 ❌"}</p>
      {factualApplied && <p className="text-[color:var(--success)]">✅ 사실 교정이 적용되었습니다 — 다음 학습부터 교정된 문제가 나옵니다 🎉</p>}
      {!isCorrect && result.correct.type === "MCQ" && question.type === "MCQ" && <p>정답: {mcqAnswerText(question, result.correct.answer_indices)}</p>}
      {result.explanation && <p className="text-[color:var(--muted)]">{result.explanation}</p>}
      <div className="space-y-2 border-t border-[color:var(--border)] pt-3">
        <p className="section-title">🤖 AI 해설 받기</p>
        <div className="flex flex-wrap gap-2">{ENGINES.map(({ value, label }) => {
          const state = engineStates[value];
          return <button key={value} onClick={() => void requestExplanation(value)} disabled={state.status === "loading" || state.status === "done"} className="btn btn-secondary text-sm">{state.status === "loading" ? "불러오는 중..." : state.status === "done" ? `${label} ✓` : label}</button>;
        })}</div>
        {ENGINES.map(({ value, label }) => {
          const state = engineStates[value];
          if (state.status === "done") return <div key={value} className="surface surface-pad space-y-1"><p className="chip">{engineLabel(value)}</p>{state.factualConcern && question.type === "MCQ" && <FactualConcernBanner questionId={question.id} original={bannerOriginal(question)} concern={state.factualConcern} onApplied={resetAfterFactualApply} />}<p className="whitespace-pre-wrap text-[color:var(--muted)]">{state.content}</p></div>;
          if (state.status === "error") return <p key={value} className="text-[color:var(--danger)]">❌ {label} 해설을 가져오지 못했습니다: {state.message}</p>;
          return null;
        })}
      </div>
      {question.type === "MCQ" && <div className="space-y-2 border-t border-[color:var(--border)] pt-3">
        <p className="section-title">🎯 선지 난이도 올리기</p>
        {(harden.status === "idle" || harden.status === "loading" || harden.status === "error") && <div className="flex flex-wrap gap-2">{HARDEN_ENGINES.map((value) => <button key={value} onClick={() => void requestHarden(value)} disabled={harden.status === "loading"} className="btn btn-secondary text-sm">{harden.status === "loading" && harden.engine === value ? "요청 중..." : `${engineLabel(value)}로 올리기`}</button>)}</div>}
        {harden.status === "tracking" && <div className="rounded-[10px] border border-[color:var(--brand)] bg-[color:var(--brand-soft)] px-3 py-2 text-sm" role="status" aria-live="polite"><p className="font-semibold">생성 중 — 완료되면 자동 반영됩니다</p><p className="mt-1 text-[color:var(--muted)]">페이지를 떠나도 작업은 서버에서 계속 진행돼요.</p>{harden.pollError && <p className="mt-2 rounded-[10px] bg-[color:var(--warning-soft)] px-3 py-2" role="alert">⚠️ {harden.pollError} 자동 확인은 계속됩니다.</p>}</div>}
        {harden.status === "autoApplied" && <p className="text-[color:var(--success)]">✅ 자동 반영됨 — 다음 학습부터 새 선지가 나옵니다 🎉</p>}
        {harden.status === "needsReview" && <p className="rounded-[10px] bg-[color:var(--warning-soft)] px-3 py-2 text-sm">{harden.kind === "concern" ? "⚠️ 검증 의견이 있어요 — " : "⏳ 아직 반영되지 않았어요 — "}<a href="/hardening" className="font-medium underline underline-offset-2">선지 검토</a>{harden.kind === "concern" ? "에서 승인해 주세요" : "에서 수동으로 승인할 수 있어요"}</p>}
        {harden.status === "error" && <div className="space-y-2"><p className="text-[color:var(--danger)]">❌ {harden.message}</p>{harden.job && <button onClick={() => void requestHarden(harden.job!.engine, true)} className="btn btn-secondary text-sm">새로 생성</button>}</div>}
      </div>}
      <button onClick={onNext} className="btn btn-secondary w-full">{nextLabel ?? (isLast ? "완료" : "다음 문제")}</button>
    </div>
  );
}
