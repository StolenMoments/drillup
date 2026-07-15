"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import { engineLabel } from "@/lib/engine-label";
import type { ChoiceHardeningJobListDto, ChoiceHardeningJobListItemDto } from "@/lib/api-types";
import HardeningPendingCard from "@/components/HardeningPendingCard";

const POLL_INTERVAL_MS = 5000;
function jobLine(item: ChoiceHardeningJobListItemDto): string { return `#${item.id} · ${item.topicName} · ${engineLabel(item.engine)}`; }

export default function HardeningReviewPage() {
  const [data, setData] = useState<ChoiceHardeningJobListDto | null>(null);
  const [message, setMessage] = useState("");
  const refresh = useCallback(async () => { try { setData(await api.hardenJobs.list()); setMessage(""); } catch (error) { setMessage(error instanceof Error ? error.message : "목록을 불러오지 못했습니다"); } }, []);
  useEffect(() => { queueMicrotask(() => void refresh()); const tick = () => { if (document.visibilityState === "visible") void refresh(); }; const interval = window.setInterval(tick, POLL_INTERVAL_MS); document.addEventListener("visibilitychange", tick); return () => { window.clearInterval(interval); document.removeEventListener("visibilitychange", tick); }; }, [refresh]);
  async function runAction(action: () => Promise<unknown>, fallback: string) { try { await action(); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : fallback); } }
  return <div className="app-page space-y-6">
    <div className="page-header"><h1 className="page-title">선지 검토</h1><p className="page-subtitle">선지 강화 결과를 승인하고 진행 상황을 확인합니다. 검증 의견이 없는 결과는 자동 반영됩니다.</p></div>
    {message && <p className="text-sm text-[color:var(--danger)]" role="alert">❌ {message}</p>}
    {data === null && !message && <p className="muted text-sm">불러오는 중...</p>}
    {data && <>
      <section className="space-y-2"><h2 className="section-title">⏳ 승인 대기</h2>{data.pending.length === 0 ? <p className="muted text-sm">승인이 필요한 항목이 없습니다 🎉</p> : data.pending.map((item) => <HardeningPendingCard key={item.id} item={item} onChanged={() => void refresh()} />)}</section>
      <section className="space-y-2"><h2 className="section-title">🔄 진행 중</h2>{data.running.length === 0 ? <p className="muted text-sm">진행 중인 작업이 없습니다.</p> : data.running.map((item) => <div key={item.id} className="surface surface-pad text-sm"><p className="font-medium">{item.questionPreview}</p><p className="subtle mt-1 text-xs">{jobLine(item)} · 시작 {new Date(item.startedAt ?? item.createdAt).toLocaleString()}</p></div>)}</section>
      <section className="space-y-2"><h2 className="section-title">❌ 실패</h2>{data.failed.length === 0 ? <p className="muted text-sm">실패한 작업이 없습니다.</p> : data.failed.map((item) => <div key={item.id} className="surface surface-pad space-y-2 text-sm"><p className="font-medium">{item.questionPreview}</p><p className="break-all text-[color:var(--danger)]">{item.errorMessage ?? "알 수 없는 오류"}</p><p className="subtle text-xs">{jobLine(item)}</p><div className="flex flex-wrap gap-2"><button onClick={() => void runAction(() => api.questions.hardenChoices(item.questionId, item.engine, true), "재시도 실패")} className="btn btn-secondary text-sm">🔁 재시도</button><button onClick={() => void runAction(() => api.questions.dismissHardenChoices(item.questionId, item.id), "거절 실패")} className="btn btn-secondary text-sm">🗑 거절</button></div></div>)}</section>
      <section className="space-y-2"><h2 className="section-title">📜 최근 반영 이력</h2>{data.recentApplied.length === 0 ? <p className="muted text-sm">반영된 항목이 없습니다.</p> : data.recentApplied.map((item) => <div key={item.id} className="surface surface-pad text-sm"><div className="flex flex-wrap items-center gap-2"><span className="chip">{item.autoApplied ? "자동 반영" : "수동 반영"}</span><p className="min-w-0 flex-1 font-medium">{item.questionPreview}</p></div><p className="subtle mt-1 text-xs">{jobLine(item)} · 반영 {item.appliedAt ? new Date(item.appliedAt).toLocaleString() : "-"}</p></div>)}</section>
    </>}
  </div>;
}
