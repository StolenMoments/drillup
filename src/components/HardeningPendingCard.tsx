"use client";

import { useState } from "react";
import { ApiError, api } from "@/lib/api-client";
import { engineLabel } from "@/lib/engine-label";
import type { ChoiceHardeningJobListItemDto } from "@/lib/api-types";
import FactualConcernBanner from "./FactualConcernBanner";

interface Props { item: ChoiceHardeningJobListItemDto; onChanged: () => void; }

function actionError(error: unknown, fallback: string): string {
  if (error instanceof ApiError && error.code === "CHOICE_HARDENING_SOURCE_CHANGED") return "원본이 변경되어 적용할 수 없습니다 — 거절 후 새로 생성해 주세요";
  return error instanceof Error ? error.message : fallback;
}

export default function HardeningPendingCard({ item, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const preview = item.preview;
  if (!preview) return null;

  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true); setMessage("");
    try { await action(); onChanged(); } catch (error) { setMessage(actionError(error, fallback)); } finally { setBusy(false); }
  }

  return <div className="surface surface-pad space-y-2">
    <div className="flex flex-wrap items-center gap-2 text-sm"><span className="subtle">#{item.id}</span><span className="font-bold">{item.topicName}</span><span className="chip">{engineLabel(item.engine)}</span></div>
    <p className="font-medium">{item.source.question}</p>
    {preview.factualConcern && <FactualConcernBanner questionId={item.questionId} original={item.source} concern={preview.factualConcern} onApplied={() => void run(() => api.questions.dismissHardenChoices(item.questionId, item.id), "처리 실패")} />}
    <p className="text-[color:var(--muted)]">{preview.comment}</p>
    <ul className="space-y-2 text-sm">{preview.payload.choices.map((newText, i) => { const oldText = item.source.choices[i]; const isAnswer = preview.payload.answer_indices.includes(i); if (isAnswer) return <li key={i}><span className="font-medium">{newText}</span> <span className="chip">정답 유지 ✅</span></li>; if (oldText === newText) return <li key={i} className="text-[color:var(--muted)]">{newText}</li>; return <li key={i} className="space-y-1"><p className="text-[color:var(--muted)] line-through">{oldText}</p><p className="font-medium">→ {newText}</p></li>; })}</ul>
    <div className="flex flex-wrap gap-2">
      <button onClick={() => void run(() => api.questions.applyHardenChoices(item.questionId, item.id), "승인 실패")} disabled={busy} className="btn btn-primary text-sm">✅ 승인</button>
      <button onClick={() => void run(() => api.questions.dismissHardenChoices(item.questionId, item.id), "거절 실패")} disabled={busy} className="btn btn-secondary text-sm">🗑 거절</button>
      <button onClick={() => void run(() => api.questions.hardenChoices(item.questionId, item.engine, true), "재생성 실패")} disabled={busy} className="btn btn-secondary text-sm">🔁 재생성</button>
    </div>
    {message && <p className="text-[color:var(--danger)]">❌ {message}</p>}
  </div>;
}
