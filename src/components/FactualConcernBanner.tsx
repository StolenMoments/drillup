"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import { engineLabel } from "@/lib/engine-label";
import type { FactualReviewDto, GenerationEngineDto } from "@/lib/api-types";

const ENGINES: GenerationEngineDto[] = ["CLAUDE", "CODEX", "ANTIGRAVITY"];

type FactualReviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "result"; result: FactualReviewDto; applying: boolean }
  | { status: "error"; message: string };

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
          {ENGINES.map((value) => <option key={value} value={value}>{engineLabel(value)}</option>)}
        </select>
        <button onClick={requestReview} disabled={busy} className="btn btn-secondary text-sm">
          {state.status === "loading" ? "확인 중..." : "🔍 사실 확인 요청"}
        </button>
      </div>
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
