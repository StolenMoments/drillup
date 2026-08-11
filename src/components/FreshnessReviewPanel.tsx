"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { engineLabel } from "@/lib/engine-label";
import type { FreshnessReviewJobDto, FreshnessReviewResultDto, GenerationEngineDto } from "@/lib/api-types";

const ENGINES: GenerationEngineDto[] = ["CLAUDE", "CODEX", "ANTIGRAVITY"];

type ReviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "tracking"; jobId: number; pollError: string | null }
  | { status: "result"; result: FreshnessReviewResultDto; applying: boolean }
  | { status: "error"; message: string };

export interface FreshnessReviewOriginal {
  question: string;
  choices: string[];
}

function toState(job: FreshnessReviewJobDto): ReviewState {
  if (job.status === "FAILED") return { status: "error", message: job.errorMessage ?? "검증 작업이 실패했습니다" };
  if (job.status === "SUCCEEDED" && job.result) return { status: "result", result: job.result, applying: false };
  if (job.status === "SUCCEEDED") return { status: "error", message: "검증 결과를 불러오지 못했습니다" };
  return { status: "tracking", jobId: job.id, pollError: null };
}

function userFacingError(error: unknown): string {
  if (error instanceof ApiError && error.code === "NETWORK_ERROR") return "연결이 끊겼습니다. 앱으로 돌아오면 진행 상태를 다시 확인할 수 있습니다.";
  return error instanceof Error ? error.message : "요청에 실패했습니다";
}

export default function FreshnessReviewPanel({ questionId, original, onApplied }: {
  questionId: number;
  original: FreshnessReviewOriginal;
  onApplied: () => void;
}) {
  const [engine, setEngine] = useState<GenerationEngineDto>("CLAUDE");
  const [state, setState] = useState<ReviewState>({ status: "idle" });

  async function requestReview() {
    setState({ status: "loading" });
    try {
      const { job } = await api.questions.reviewFreshness(questionId, engine);
      setState(toState(job));
    } catch (error) {
      setState({ status: "error", message: userFacingError(error) });
    }
  }

  const poll = useCallback(async (jobId: number) => {
    try {
      const { job } = await api.questions.getFreshnessReviewJob(questionId, jobId);
      setState((current) => current.status === "tracking" && current.jobId === jobId ? toState(job) : current);
    } catch (error) {
      setState((current) => {
        if (current.status !== "tracking" || current.jobId !== jobId) return current;
        if (error instanceof ApiError && error.code === "NETWORK_ERROR") return { ...current, pollError: userFacingError(error) };
        return { status: "error", message: userFacingError(error) };
      });
    }
  }, [questionId]);

  const jobId = state.status === "tracking" ? state.jobId : null;
  useEffect(() => {
    if (jobId === null) return;
    const refresh = () => void poll(jobId);
    const interval = window.setInterval(refresh, 5_000);
    const onVisibility = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", refresh);
    return () => {
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", refresh);
    };
  }, [jobId, poll]);

  async function applyReview() {
    if (state.status !== "result" || state.applying || !state.result.payload) return;
    setState({ ...state, applying: true });
    try {
      await api.questions.update(questionId, { payload: state.result.payload, explanation: null });
      onApplied();
    } catch (error) {
      setState({ status: "error", message: userFacingError(error) });
    }
  }

  const busy = state.status === "loading" || state.status === "tracking" || (state.status === "result" && state.applying);
  return (
    <section className="space-y-2 border-t border-[color:var(--border)] pt-3" aria-label="최신 정보 검증">
      <p className="section-title">🔍 최신 정보 검증</p>
      <p className="text-sm text-[color:var(--muted)]">현재 공식 문서로 문제·선지·정답·해설을 다시 확인합니다.</p>
      <div className="flex flex-wrap items-center gap-2">
        <select value={engine} onChange={(event) => setEngine(event.target.value as GenerationEngineDto)} disabled={busy} className="field w-auto min-w-36" aria-label="검증 엔진">
          {ENGINES.map((value) => <option key={value} value={value}>{engineLabel(value)} 엔진</option>)}
        </select>
        <button onClick={() => void requestReview()} disabled={busy} className="btn btn-secondary text-sm">
          {busy ? "검증 중..." : "🔍 최신 정보 검증"}
        </button>
      </div>
      {state.status === "tracking" && <div className="rounded-[10px] border border-[color:var(--brand)] bg-[color:var(--brand-soft)] px-3 py-2 text-sm" role="status" aria-live="polite">
        <p className="font-semibold">최신 공식 문서를 확인하고 있습니다</p>
        <p className="mt-1 text-[color:var(--muted)]">페이지를 떠나도 작업은 서버에서 계속 진행돼요.</p>
        {state.pollError && <p className="mt-2 rounded-[10px] bg-[color:var(--warning-soft)] px-3 py-2" role="alert">⚠️ {state.pollError} 자동 확인은 계속됩니다.</p>}
      </div>}
      {state.status === "error" && <p className="text-sm text-[color:var(--danger)]">❌ {state.message}</p>}
      {state.status === "result" && state.result.verdict === "pass" && <div className="surface surface-pad space-y-1"><p className="text-[color:var(--success)]">✅ 최신 공식 문서 기준으로 이상이 없습니다</p><p className="text-sm text-[color:var(--muted)]">{state.result.comment}</p><Evidence url={state.result.evidenceUrl} /></div>}
      {state.status === "result" && state.result.verdict === "unverified" && <div className="surface surface-pad space-y-1"><p>판단 불가</p><p className="text-sm text-[color:var(--muted)]">{state.result.comment}</p><Evidence url={state.result.evidenceUrl} /></div>}
      {state.status === "result" && state.result.verdict === "fail" && state.result.payload && <div className="surface surface-pad space-y-2"><p className="text-[color:var(--danger)]">⚠️ 최신 정보와 다른 내용이 있습니다</p><p className="text-sm text-[color:var(--muted)]">{state.result.comment}</p><Evidence url={state.result.evidenceUrl} /><Comparison original={original} revised={state.result.payload} /><button onClick={() => void applyReview()} disabled={state.applying} className="btn btn-primary text-sm">{state.applying ? "적용 중..." : "✅ 적용하기"}</button></div>}
      {state.status === "result" && state.result.verdict === "fail" && !state.result.payload && <div className="surface surface-pad space-y-2"><p className="text-[color:var(--danger)]">⚠️ 최신 정보와 다른 내용이 있습니다</p><p className="text-sm text-[color:var(--muted)]">{state.result.comment}</p><Evidence url={state.result.evidenceUrl} /><Link href={`/questions/${questionId}/edit`} className="inline-flex text-sm font-medium text-[color:var(--brand-strong)] underline underline-offset-2">문제 편집으로 교정하기</Link></div>}
    </section>
  );
}

function Evidence({ url }: { url: string | null }) {
  return url ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex text-sm font-medium text-[color:var(--brand-strong)] underline underline-offset-2">근거 문서 보기</a> : null;
}

function Comparison({ original, revised }: { original: FreshnessReviewOriginal; revised: FreshnessReviewResultDto["payload"] & {} }) {
  if (!revised) return null;
  return <div className="diff-comparison" aria-label="문제와 선지 원본 및 교정 비교"><h3 className="section-title">원본 ↔ 교정 비교</h3><section className="diff-panel"><h4 className="diff-panel-title">문제 본문</h4><del className="diff-deleted">{original.question}</del><ins className="diff-added ml-1">{revised.question}</ins></section><ul className="space-y-2 text-sm">{revised.choices.map((choice, index) => <li key={index} className="diff-panel"><p className="font-medium">선지 {index + 1} {revised.answer_indices.includes(index) && <span className="chip ml-1">정답 ✅</span>}</p>{original.choices[index] === choice ? <p className="text-[color:var(--muted)]">변경 없음: {choice}</p> : <><del className="diff-deleted">{original.choices[index] ?? "(원본 없음)"}</del><ins className="diff-added ml-1">{choice}</ins></>}</li>)}</ul></div>;
}
