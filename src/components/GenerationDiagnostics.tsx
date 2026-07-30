"use client";

import { useState } from "react";
import { api } from "@/lib/api-client";
import type { GenerationRunLogDto, GenerationRunStageDto } from "@/lib/api-types";

const stageLabels: Record<GenerationRunStageDto, string> = { BLUEPRINT: "Blueprint", BLUEPRINT_REPAIR: "Blueprint repair", GENERATION: "Generation", VERIFY: "Verify", ITEM_REPAIR: "Item repair", REPAIR_VERIFY: "Repair verify", MANUAL_ITEM_REVISION: "Manual revision", KEYWORD_TAG: "Keyword tag" };

export default function GenerationDiagnostics({ jobId }: { jobId: number }) {
  const [runs, setRuns] = useState<GenerationRunLogDto[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  async function load() { if (runs || loading) return; setLoading(true); try { setRuns((await api.generate.diagnostics(jobId)).runs); } catch (e) { setError(e instanceof Error ? e.message : "진단 기록을 불러오지 못했습니다."); } finally { setLoading(false); } }
  async function copy(label: string, value: string) { try { await navigator.clipboard.writeText(value); setMessage(`✅ ${label}을 복사했습니다.`); } catch { setMessage(`❌ ${label}을 복사하지 못했습니다.`); } }
  return <details className="surface surface-pad" onToggle={(event) => { if ((event.currentTarget as HTMLDetailsElement).open) void load(); }}><summary className="cursor-pointer font-semibold">AI 진단 기록</summary>{loading && <p className="muted mt-3 text-sm">불러오는 중…</p>}{error && <p className="mt-3 text-sm text-[color:var(--danger)]">{error}</p>}{runs?.length === 0 && <p className="muted mt-3 text-sm">기록이 없습니다.</p>}{runs?.map((run) => <article key={run.id} className="mt-3 border-t border-[color:var(--border)] pt-3 text-sm"><p><strong>{stageLabels[run.stage]}</strong> · {run.status} · {run.engine}{run.model ? ` / ${run.model}` : ""}{run.itemIndex !== null ? ` · 문항 #${run.itemIndex + 1}` : ""}{run.durationMs !== null ? ` · ${run.durationMs}ms` : ""}</p>{run.errorMessage && <p className="mt-1 text-[color:var(--danger)]">{run.errorMessage}</p>}{([['Prompt', run.prompt], ['Response', run.response], ['stdout', run.stdoutTail], ['stderr', run.stderrTail]] as const).filter(([, value]) => value).map(([label, value]) => <details key={label} className="mt-2"><summary className="cursor-pointer">{label}</summary><button type="button" className="btn btn-secondary mt-2 text-xs" onClick={() => void copy(label, value as string)}>복사</button><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{value}</pre></details>)}</article>)}{message && <p className="mt-2 text-sm">{message}</p>}</details>;
}
