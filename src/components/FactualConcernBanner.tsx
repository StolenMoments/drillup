"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { engineLabel } from "@/lib/engine-label";
import type { FactualReviewJobDto, FactualReviewResultDto, GenerationEngineDto } from "@/lib/api-types";

const ENGINES: GenerationEngineDto[] = ["CLAUDE", "CODEX", "ANTIGRAVITY"];

type FactualReviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "tracking"; jobId: number; pollError: string | null }
  | { status: "result"; result: FactualReviewResultDto; applying: boolean }
  | { status: "error"; message: string };

function userFacingError(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.code === "NETWORK_ERROR") return "연결이 끊겼습니다. 앱으로 돌아오면 진행 상태를 다시 확인할 수 있습니다.";
  return error instanceof Error ? error.message : fallback;
}

function stateForJob(job: FactualReviewJobDto): FactualReviewState {
  if (job.status === "FAILED") return { status: "error", message: job.errorMessage ?? "요청 실패" };
  if (job.status === "SUCCEEDED" && job.result) return { status: "result", result: job.result, applying: false };
  if (job.status === "SUCCEEDED") return { status: "error", message: "결과를 불러오지 못했습니다" };
  return { status: "tracking", jobId: job.id, pollError: null };
}

export interface FactualConcernOriginal {
  question: string;
  choices: string[];
}

interface FactualConcernBannerProps {
  questionId: number;
  original: FactualConcernOriginal;
  concern: string;
  onApplied: () => void;
}

export default function FactualConcernBanner({
  questionId,
  original,
  concern,
  onApplied,
}: FactualConcernBannerProps) {
  const [engine, setEngine] = useState<GenerationEngineDto>("CLAUDE");
  const [state, setState] = useState<FactualReviewState>({ status: "idle" });

  async function requestReview() {
    setState({ status: "loading" });
    try {
      const { job } = await api.questions.reviewFact(questionId, engine, concern);
      setState(stateForJob(job));
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "요청 실패",
      });
    }
  }

  const pollJob = useCallback(async (jobId: number) => {
    try {
      const { job } = await api.questions.getFactualReviewJob(questionId, jobId);
      setState((current) => {
        if (current.status !== "tracking" || current.jobId !== jobId) return current;
        return stateForJob(job);
      });
    } catch (error) {
      setState((current) => {
        if (current.status !== "tracking" || current.jobId !== jobId) return current;
        if (error instanceof ApiError && error.code === "NETWORK_ERROR") {
          return { ...current, pollError: userFacingError(error, "진행 상태 확인 실패") };
        }
        return { status: "error", message: userFacingError(error, "진행 상태 확인 실패") };
      });
    }
  }, [questionId]);

  const trackedJobId = state.status === "tracking" ? state.jobId : null;
  useEffect(() => {
    if (trackedJobId === null) return;
    const refresh = () => void pollJob(trackedJobId);
    const interval = window.setInterval(refresh, 5_000);
    const onVisibilityChange = () => { if (document.visibilityState === "visible") refresh(); };
    const onPageShow = () => refresh();
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pageshow", onPageShow);
    return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", onVisibilityChange); window.removeEventListener("pageshow", onPageShow); };
  }, [pollJob, trackedJobId]);

  async function applyReview() {
    if (state.status !== "result" || state.applying || !state.result.payload) return;
    const payload = state.result.payload;
    setState({ ...state, applying: true });
    try {
      await api.questions.update(questionId, { payload, explanation: null });
      onApplied();
    } catch (err) {
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "적용 실패",
      });
    }
  }

  const busy = state.status === "loading" || state.status === "tracking" || (state.status === "result" && state.applying);

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
          {ENGINES.map((value) => <option key={value} value={value}>{engineLabel(value)}</option>)}
        </select>
        <button onClick={requestReview} disabled={busy} className="btn btn-secondary text-sm">
          {state.status === "loading" || state.status === "tracking" ? "확인 중..." : "🔍 사실 확인 요청"}
        </button>
      </div>
      {state.status === "tracking" && (
        <div className="rounded-[10px] border border-[color:var(--brand)] bg-[color:var(--brand-soft)] px-3 py-2 text-sm" role="status" aria-live="polite">
          <p className="font-semibold">확인 중 — 완료되면 여기에 표시됩니다</p>
          <p className="mt-1 text-[color:var(--muted)]">페이지를 떠나도 작업은 서버에서 계속 진행돼요.</p>
          {state.pollError && <p className="mt-2 rounded-[10px] bg-[color:var(--warning-soft)] px-3 py-2" role="alert">⚠️ {state.pollError} 자동 확인은 계속됩니다.</p>}
        </div>
      )}
      {state.status === "error" && <p className="text-[color:var(--danger)]">❌ {state.message}</p>}
      {state.status === "result" && state.result.verdict === "rejected" && (
        <div className="surface surface-pad space-y-1">
          <p className="text-[color:var(--success)]">✅ 문제에 이상이 없습니다</p>
          <p className="text-[color:var(--muted)]">{state.result.comment}</p>
          {state.result.evidenceUrl && <a href={state.result.evidenceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex text-[color:var(--brand-strong)] underline underline-offset-2">근거 문서 보기</a>}
        </div>
      )}
      {state.status === "result" && state.result.verdict === "unverifiable" && (
        <div className="surface surface-pad space-y-1"><p>판단 불가</p><p className="text-[color:var(--muted)]">{state.result.comment}</p></div>
      )}
      {state.status === "result" && state.result.verdict === "confirmed" && state.result.payload && (
        <div className="surface surface-pad space-y-2">
          <p className="text-[color:var(--muted)]">{state.result.comment}</p>
          {state.result.evidenceUrl && <a href={state.result.evidenceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex text-[color:var(--brand-strong)] underline underline-offset-2">근거 문서 보기</a>}
          <div className="diff-comparison" aria-label="문제와 선지 원본 및 교정 비교">
            <h3 className="section-title">원본 ↔ 교정 비교</h3>
            <section className="diff-panel"><h4 className="diff-panel-title">문제 본문</h4><del className="diff-deleted">{original.question}</del><ins className="diff-added ml-1">{state.result.payload.question}</ins></section>
            <ul className="space-y-2 text-sm">
              {state.result.payload.choices.map((newText, i) => {
                const oldText = original.choices[i] ?? "(원본 없음)";
                const isAnswer = state.result.payload?.answer_indices.includes(i);
                return oldText === newText ? (
                  <li key={i} className="diff-panel"><p className="font-medium">선지 {i + 1} {isAnswer && <span className="chip ml-1">정답 ✅</span>}</p><p className="text-[color:var(--muted)]">변경 없음: {newText}</p></li>
                ) : (
                  <li key={i} className="diff-panel space-y-1"><p className="font-medium">선지 {i + 1} {isAnswer && <span className="chip ml-1">정답 ✅</span>}</p><p><del className="diff-deleted">{oldText}</del></p><p><ins className="diff-added">{newText}</ins></p></li>
                );
              })}
            </ul>
          </div>
          <button onClick={applyReview} disabled={state.applying} className="btn btn-primary text-sm">{state.applying ? "적용 중..." : "✅ 적용하기"}</button>
        </div>
      )}
    </div>
  );
}
