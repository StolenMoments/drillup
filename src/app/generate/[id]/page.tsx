"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import QuestionPreview from "@/components/QuestionPreview";
import GenerationDiagnostics from "@/components/GenerationDiagnostics";
import type { ImportQuestion } from "@/core/import-schema";
import { api } from "@/lib/api-client";
import type { GenerationEngineDto, GenerationJobDto } from "@/lib/api-types";

const POLL_INTERVAL_MS = 5000;
const ENGINES: Array<{ value: GenerationEngineDto; label: string }> = [
  { value: "CLAUDE", label: "Claude" },
  { value: "CODEX", label: "Codex" },
  { value: "ANTIGRAVITY", label: "agy" },
];

function selectValidItems(job: GenerationJobDto): Set<number> {
  if (job.status !== "SUCCEEDED") return new Set<number>();
  if (job.kind === "KEYWORD_TAG") {
    return new Set((job.keywordItems ?? []).map((item) => item.id));
  }
  if (!job.items) return new Set<number>();
  return new Set(
    job.items
      .filter((item) => item.ok && item.verdict !== "fail")
      .map((item) => item.index),
  );
}

function statusLabel(job: GenerationJobDto, elapsed: number): string {
  switch (job.status) {
    case "RUNNING":
      return `생성 중... (경과 ${elapsed}초)`;
    case "VERIFYING":
      return `검증 중... (경과 ${elapsed}초)`;
    case "SUCCEEDED":
      return "✅ 생성 완료";
    case "FAILED":
      return "❌ 생성 실패";
  }
}

export default function GenerationDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const jobId = Number(params.id);
  const [job, setJob] = useState<GenerationJobDto | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [revealed, setRevealed] = useState<Set<number>>(new Set());
  const [elapsed, setElapsed] = useState(0);
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);
  const [revisionInputs, setRevisionInputs] = useState<Record<number, { engine: GenerationEngineDto; instructions: string }>>({});

  useEffect(() => {
    let ignore = false;
    async function load() {
      if (!Number.isInteger(jobId) || jobId <= 0) {
        setMessage("잘못된 생성 작업 id입니다");
        return;
      }
      try {
        const { job: loaded } = await api.generate.get(jobId);
        if (ignore) return;
        setJob(loaded);
        setElapsed(
          Math.max(
            0,
            Math.floor((Date.now() - new Date(loaded.createdAt).getTime()) / 1000),
          ),
        );
        if (loaded.status === "SUCCEEDED") setSelected(selectValidItems(loaded));
      } catch (error) {
        if (!ignore) {
          setMessage(
            error instanceof Error ? error.message : "생성 작업을 불러오지 못했습니다",
          );
        }
      }
    }
    void load();
    return () => {
      ignore = true;
    };
  }, [jobId]);

  useEffect(() => {
    if (!job) return;
    const currentJob = job;
    const hasRunningRevision = currentJob.items?.some((item) => item.ok && item.revision?.status === "RUNNING") ?? false;
    if (currentJob.status !== "RUNNING" && currentJob.status !== "VERIFYING" && !hasRunningRevision) return;
    const startedAt = new Date(currentJob.createdAt).getTime();
    const timer = setInterval(async () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
      try {
        const { job: next } = await api.generate.get(currentJob.id);
        setJob(next);
        if (next.status === "SUCCEEDED") setSelected(selectValidItems(next));
      } catch {
        // 폴링 일시 오류는 다음 주기에 재시도한다.
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [job]);

  function revisionInput(index: number) {
    return revisionInputs[index] ?? { engine: job?.verifyEngine ?? "CLAUDE", instructions: "" };
  }

  function updateRevisionInput(index: number, update: Partial<{ engine: GenerationEngineDto; instructions: string }>) {
    setRevisionInputs((prev) => ({ ...prev, [index]: { ...revisionInput(index), ...update } }));
  }

  async function requestRevision(index: number) {
    if (!job) return;
    const input = revisionInput(index);
    setMessage("");
    try {
      const result = await api.generate.reviseItem(job.id, index, input);
      setJob(result.job);
      setMessage("✅ AI 재검증을 시작했습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "❌ AI 재검증을 시작하지 못했습니다.");
    }
  }

  async function setRevisionUsage(index: number, useRevision: boolean) {
    if (!job) return;
    try {
      const result = await api.generate.setRevisionUsage(job.id, index, useRevision);
      setJob(result.job);
      setMessage(useRevision ? "✅ 수정본을 적용했습니다." : "✅ 원문으로 되돌렸습니다.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "❌ 수정본을 적용하지 못했습니다.");
    }
  }

  function toggle(index: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  function toggleReveal(index: number) {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  async function save() {
    if (job?.status !== "SUCCEEDED" || selected.size === 0 || saving) return;
    if (
      job.savedCount > 0 &&
      !window.confirm(`이미 ${job.savedCount}개를 저장했습니다. 다시 저장할까요?`)
    ) {
      return;
    }

    setSaving(true);
    setMessage("");
    try {
      const result = await api.generate.approve(job.id, [...selected]);
      setJob(result.job);
      setMessage(
        job.kind === "KEYWORD_TAG"
          ? `✅ ${result.savedCount}개 문제에 키워드를 적용했습니다`
          : `✅ ${result.savedCount}개 문제를 저장했습니다`,
      );
      router.push("/generate");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장에 실패했습니다");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="app-page space-y-4">
      <div className="page-header">
        <div>
          <h1 className="page-title">생성 작업 #{Number.isFinite(jobId) ? jobId : ""}</h1>
          <p className="page-subtitle">
            작업 진행 상태를 확인하고 검증된 항목만 문제은행에 저장합니다.
          </p>
        </div>
        <Link href="/generate" className="btn btn-secondary shrink-0">
          목록
        </Link>
      </div>

      {!job && !message && <p className="muted text-sm">불러오는 중...</p>}

      {job && (
        <section className="surface surface-pad space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="chip">{statusLabel(job, elapsed)}</span>
            {job.kind === "KEYWORD_TAG" ? (
              <span className="chip">🏷️ 키워드 부여 · {job.engine}</span>
            ) : (
              <span className="chip">{job.engine}→{job.verifyEngine}</span>
            )}
            {job.kind === "QUESTION" && job.sourceQuestionIds && (
              <span className="chip">
                🔀 변형 (원본 #{job.sourceQuestionIds.join(", #")})
              </span>
            )}
            {job.savedCount > 0 && (
              <span className="chip text-[color:var(--warning)]">
                ⚠️ 이미 {job.savedCount}개 저장함
              </span>
            )}
          </div>
          <p className="subtle text-xs">
            시작: {new Date(job.createdAt).toLocaleString()}
            {job.finishedAt ? ` · 종료: ${new Date(job.finishedAt).toLocaleString()}` : ""}
          </p>
        </section>
      )}

      {job && <GenerationDiagnostics jobId={job.id} />}

      {job?.status === "FAILED" && (
        <section className="space-y-3">
          <p className="whitespace-pre-wrap break-all rounded-[12px] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] p-3 text-sm">
            ❌ 생성에 실패했습니다: {job.errorMessage}
          </p>
          <Link href="/generate/new" className="btn btn-secondary">
            다시 시도
          </Link>
        </section>
      )}

      {job?.status === "SUCCEEDED" && job.kind === "QUESTION" && job.items && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="section-title">미리보기 및 저장</h2>
            <button
              onClick={save}
              disabled={selected.size === 0 || saving}
              className="btn btn-success"
            >
              {saving ? "저장 중..." : `선택한 ${selected.size}개 문제 저장`}
            </button>
          </div>
          {job.verifyWarning && (
            <p className="whitespace-pre-wrap break-all rounded-[12px] border border-[color:var(--warning)] bg-[color:var(--warning-soft)] p-3 text-sm">
              ⚠️ 검증을 수행하지 못했습니다: {job.verifyWarning}
            </p>
          )}
          {job.items.map((item) => {
            const currentQuestion = item.ok
              ? (item.revision?.appliedQuestion ?? item.question) as ImportQuestion
              : null;
            const revision = item.ok ? item.revision : null;
            const input = revisionInput(item.index);
            return <div
              key={item.index}
              className={`surface surface-pad ${
                item.ok ? "" : "border-[color:var(--danger)] bg-[color:var(--danger-soft)]"
              }`}
            >
              <div className="mb-2 flex items-center gap-2 text-sm">
                <span className="subtle">#{item.index + 1}</span>
                {item.ok ? (
                  <>
                    <span className="chip">
                      {(item.question as ImportQuestion).type === "mcq"
                        ? "객관식"
                        : "빈칸"}
                    </span>
                    {item.verdict === "pass" && (
                      <span className="chip" style={{ color: "var(--success)" }}>
                        ✅ 검증 통과
                      </span>
                    )}
                    {item.verdict === "fail" && (
                      <span className="chip" style={{ color: "var(--warning)" }}>
                        ⚠️ 검증 의견
                      </span>
                    )}
                    {item.verdict === "unverified" && (
                      <span className="chip">검증 안 됨</span>
                    )}
                    <div className="ml-auto flex items-center gap-3">
                      <button
                        type="button"
                        onClick={() => toggleReveal(item.index)}
                        className="btn btn-secondary min-h-9 px-3 py-2 text-sm"
                      >
                        {revealed.has(item.index) ? "정답 숨기기" : "정답 보기"}
                      </button>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={selected.has(item.index)}
                          onChange={() => toggle(item.index)}
                        />
                        저장
                      </label>
                    </div>
                  </>
                ) : (
                  <span className="text-[color:var(--danger)]">오류</span>
                )}
              </div>
              {item.ok ? (
                <>
                  <QuestionPreview
                    question={currentQuestion as ImportQuestion}
                    revealed={revealed.has(item.index)}
                  />
                  {(item.question as ImportQuestion).keywords?.length ? (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {(item.question as ImportQuestion).keywords?.map((keyword) => (
                        <span key={keyword} className="chip">🏷️ {keyword}</span>
                      ))}
                    </div>
                  ) : null}
                  {item.verdict === "fail" && item.verdictComment && (
                    <p className="mt-2 whitespace-pre-wrap break-all rounded-[12px] border border-[color:var(--warning)] bg-[color:var(--warning-soft)] p-2 text-sm">
                      ⚠️ {item.verdictComment}
                    </p>
                  )}
                  {item.verdict === "pass" && item.verdictComment && (
                    <p className="subtle mt-2 text-xs">{item.verdictComment}</p>
                  )}
                  <details className="mt-3 border-t border-[color:var(--border)] pt-3">
                    <summary className="cursor-pointer text-sm font-semibold text-[color:var(--brand)]">
                      ✨ AI 재검증 및 수정
                    </summary>
                    <div className="mt-3 space-y-3">
                      <p className="muted text-sm">
                        엔진을 고르고 추가 요청을 남기세요. 비워도 기본 검증 기준으로 수정본을 제안합니다.
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {ENGINES.map(({ value, label }) => (
                          <label key={value} className="chip gap-2">
                            <input type="radio" name={`revision-engine-${item.index}`} checked={input.engine === value}
                              onChange={() => updateRevisionInput(item.index, { engine: value })}
                              disabled={revision?.status === "RUNNING"} />
                            {label}
                          </label>
                        ))}
                      </div>
                      <textarea value={input.instructions} rows={3} className="textarea text-sm"
                        placeholder="추가로 확인하거나 개선할 사항 (선택)"
                        onChange={(event) => updateRevisionInput(item.index, { instructions: event.target.value })}
                        disabled={revision?.status === "RUNNING"} />
                      <button type="button" onClick={() => void requestRevision(item.index)}
                        disabled={revision?.status === "RUNNING"} className="btn btn-secondary text-sm">
                        {revision?.status === "RUNNING" ? "AI 재검증 중…" : "AI 재검증 및 수정본 받기"}
                      </button>
                      {revision?.status === "FAILED" && (
                        <p className="text-sm text-[color:var(--danger)]">❌ {revision.errorMessage}</p>
                      )}
                      {revision?.status === "SUCCEEDED" && Boolean(revision.proposedQuestion) && (
                        <div className="space-y-3 border-t border-[color:var(--border)] pt-3">
                          <p className="text-sm"><span className="chip">AI 판정: {revision.verdict === "pass" ? "통과" : "개선 권장"}</span> {revision.comment}</p>
                          <div className="grid gap-3 lg:grid-cols-2">
                            <div className="space-y-2"><p className="text-sm font-semibold">현재 저장될 버전</p><QuestionPreview question={currentQuestion as ImportQuestion} revealed={revealed.has(item.index)} /></div>
                            <div className="space-y-2"><p className="text-sm font-semibold">AI 수정 제안</p><QuestionPreview question={revision.proposedQuestion as ImportQuestion} revealed={revealed.has(item.index)} /></div>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <button type="button" onClick={() => void setRevisionUsage(item.index, true)} className="btn btn-primary text-sm">수정본 적용</button>
                            {Boolean(revision.appliedQuestion) && <button type="button" onClick={() => void setRevisionUsage(item.index, false)} className="btn btn-secondary text-sm">원문으로 되돌리기</button>}
                          </div>
                        </div>
                      )}
                    </div>
                  </details>
                </>
              ) : (
                <ul className="list-inside list-disc text-sm text-[color:var(--danger)]">
                  {item.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              )}
            </div>;
          })}
        </section>
      )}

      {job?.status === "SUCCEEDED" && job.kind === "KEYWORD_TAG" && (
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="section-title">제안된 키워드 확인 및 적용</h2>
            <button
              onClick={save}
              disabled={selected.size === 0 || saving}
              className="btn btn-success"
            >
              {saving ? "적용 중..." : `선택한 ${selected.size}개 문제에 적용`}
            </button>
          </div>
          {(job.keywordItems ?? []).length === 0 && (
            <p className="muted text-sm">제안된 키워드가 없습니다.</p>
          )}
          {(job.keywordItems ?? []).map((item) => (
            <div key={item.id} className="surface surface-pad">
              <div className="flex items-start gap-3 text-sm">
                <label className="flex shrink-0 items-center gap-2 pt-0.5">
                  <input
                    type="checkbox"
                    checked={selected.has(item.id)}
                    onChange={() => toggle(item.id)}
                  />
                  <span className="subtle">#{item.id}</span>
                </label>
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="break-all">{item.summary}</p>
                  <div className="flex flex-wrap gap-1">
                    {item.keywords.map((keyword) => (
                      <span key={keyword} className="chip">🏷️ {keyword}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </section>
      )}

      {message && <p className="text-sm text-[color:var(--brand)]">{message}</p>}
    </div>
  );
}
