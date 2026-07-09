"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { GenerationJobSummaryDto } from "@/lib/api-types";

const POLL_INTERVAL_MS = 3000;

function statusBadge(job: GenerationJobSummaryDto): string {
  switch (job.status) {
    case "RUNNING":
      return "⏳ 생성 중";
    case "VERIFYING":
      return "⏳ 검증 중";
    case "SUCCEEDED":
      return job.approvedAt ? `✅ 저장됨 ${job.savedCount}개` : "✅ 완료 · 미저장";
    case "FAILED":
      return "❌ 실패";
  }
}

export default function GenerationListPage() {
  const [jobs, setJobs] = useState<GenerationJobSummaryDto[] | null>(null);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let ignore = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function refresh() {
      try {
        const { jobs: list } = await api.generate.list();
        if (ignore) return;
        setJobs(list);
        const active = list.some(
          (job) => job.status === "RUNNING" || job.status === "VERIFYING",
        );
        if (!active && timer) {
          clearInterval(timer);
          timer = null;
        }
      } catch (error) {
        if (!ignore) {
          setMessage(
            error instanceof Error ? error.message : "작업 목록을 불러오지 못했습니다",
          );
        }
      }
    }

    void refresh().then(() => {
      if (ignore) return;
      timer = setInterval(refresh, POLL_INTERVAL_MS);
    });

    return () => {
      ignore = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  async function remove(id: number) {
    if (!window.confirm(`작업 #${id}을(를) 삭제할까요?`)) return;
    try {
      await api.generate.remove(id);
      setJobs((prev) => prev?.filter((job) => job.id !== id) ?? null);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "삭제에 실패했습니다");
    }
  }

  return (
    <div className="app-page space-y-4">
      <div className="page-header flex items-center justify-between">
        <div>
          <h1 className="page-title">AI 생성 작업</h1>
          <p className="page-subtitle">생성 작업의 진행 상태를 확인하고 결과를 승인합니다.</p>
        </div>
        <Link href="/generate/new" className="btn btn-primary shrink-0">
          새 생성
        </Link>
      </div>

      {jobs === null && !message && <p className="muted text-sm">불러오는 중...</p>}

      {jobs !== null && jobs.length === 0 && (
        <p className="muted text-sm">
          진행 중인 생성 작업이 없습니다 - "새 생성"으로 시작하세요.
        </p>
      )}

      {jobs !== null && jobs.length > 0 && (
        <div className="space-y-2">
          {jobs.map((job) => (
            <div key={job.id} className="surface surface-pad flex items-center gap-3">
              <Link href={`/generate/${job.id}`} className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="subtle">#{job.id}</span>
                  <span className="font-bold">{job.topicName}</span>
                  <span className="chip">
                    {job.engine}→{job.verifyEngine}
                  </span>
                  <span className="chip">{statusBadge(job)}</span>
                  {job.status === "SUCCEEDED" && job.itemCount !== null && (
                    <span className="subtle text-xs">{job.itemCount}개 항목</span>
                  )}
                </div>
                <div className="subtle mt-1 text-xs">
                  {new Date(job.createdAt).toLocaleString()}
                  {job.status === "FAILED" && job.errorMessage && (
                    <span className="ml-2 break-all text-[color:var(--danger)]">
                      {job.errorMessage.slice(0, 80)}
                    </span>
                  )}
                </div>
              </Link>
              <button
                onClick={() => remove(job.id)}
                className="btn btn-secondary shrink-0"
              >
                삭제
              </button>
            </div>
          ))}
        </div>
      )}

      {message && <p className="text-sm text-[color:var(--danger)]">{message}</p>}
    </div>
  );
}
