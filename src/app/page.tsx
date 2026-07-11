"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { StatsOverviewDto, TopicStatsDto } from "@/lib/api-types";

function ProgressBar({ topic }: { topic: TopicStatsDto }) {
  if (topic.total === 0) return null;

  const pct = (count: number) => `${(count / topic.total) * 100}%`;

  return (
    <div className="mt-2 space-y-1">
      <div className="flex h-2 gap-0.5 overflow-hidden rounded-full bg-[color:var(--border)]">
        {topic.mastered > 0 && (
          <div
            className="bg-[color:var(--success)]"
            style={{ width: pct(topic.mastered) }}
          />
        )}
        {topic.learning > 0 && (
          <div className="bg-[color:var(--amber)]" style={{ width: pct(topic.learning) }} />
        )}
      </div>
      <p className="text-xs text-[color:var(--muted)]">
        <span className="mr-2">
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[color:var(--success)]" />
          암기 완료 {topic.mastered}
        </span>
        <span className="mr-2">
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[color:var(--amber)]" />
          학습 중 {topic.learning}
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-[color:var(--border-strong)]" />
          미학습 {topic.unlearned}
        </span>
      </p>
    </div>
  );
}

export default function DashboardPage() {
  const [stats, setStats] = useState<StatsOverviewDto | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    api.stats
      .overview()
      .then(setStats)
      .catch(() => setError("통계를 불러오지 못했습니다"));
  }, []);

  if (error) return <p className="text-[color:var(--danger)]">{error}</p>;
  if (!stats) return <p className="muted">불러오는 중...</p>;

  return (
    <div className="app-page">
      <section className="surface surface-pad grid gap-5 md:grid-cols-[1fr_auto] md:items-center">
        <div>
          <p className="page-title">오늘의 학습</p>
          <p className="page-subtitle">
            복습 기한이 된 문제를 먼저 처리하고, 여유가 있으면 자유 연습으로 감을 유지하세요.
          </p>
        </div>
        <div className="rounded-[12px] bg-[color:var(--brand-soft)] p-5 text-center md:min-w-48">
          <p className="text-sm text-[color:var(--muted)]">복습할 문제</p>
          <p className="my-1 text-5xl font-bold text-[color:var(--brand-strong)]">
            {stats.dueTotal}
          </p>
          <Link
            href={stats.dueTotal > 0 ? "/study?mode=srs" : "/study?mode=practice"}
            className={`btn mt-3 w-full ${stats.dueTotal > 0 ? "btn-primary" : "btn-secondary"}`}
          >
            {stats.dueTotal > 0 ? "복습 시작" : "자유 연습"}
          </Link>
        </div>
      </section>

      <section className="space-y-3">
        <div className="page-header">
          <h2 className="section-title">주제별 현황</h2>
          <Link href="/import" className="btn btn-secondary min-h-9 px-3 text-sm">
            문제 추가
          </Link>
        </div>
        {stats.topics.length === 0 && (
          <p className="empty-state">
            아직 주제가 없습니다.{" "}
            <Link href="/import" className="text-[color:var(--brand)]">
              가져오기
            </Link>
            에서 첫 문제를 넣어 보세요.
          </p>
        )}
        <div className="grid gap-3 md:grid-cols-2">
          {stats.topics.map((topic) => (
            <div key={topic.id} className="surface surface-pad">
              <div className="flex items-center justify-between gap-3">
                <span className="min-w-0 font-semibold">{topic.name}</span>
                <span className="chip shrink-0">
                  {topic.total}문제 · 복습 예정 {topic.dueCount}
                </span>
              </div>
              <ProgressBar topic={topic} />
              <div className="mt-4 flex gap-2 text-sm">
                <Link
                  href={`/study?mode=srs&topicId=${topic.id}`}
                  className={`btn min-h-9 px-3 ${topic.dueCount > 0 ? "btn-primary" : "btn-secondary"}`}
                >
                  복습
                </Link>
                <Link
                  href={`/study?mode=practice&topicId=${topic.id}`}
                  className="btn btn-secondary min-h-9 px-3"
                >
                  연습
                </Link>
                <Link
                  href={`/study?mode=unlearned&topicId=${topic.id}`}
                  className="btn btn-secondary min-h-9 px-3"
                >
                  미학습
                </Link>
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
