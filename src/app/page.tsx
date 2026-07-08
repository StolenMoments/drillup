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
      <div className="flex h-2 gap-0.5 overflow-hidden rounded bg-slate-800">
        {topic.mastered > 0 && (
          <div
            className="bg-emerald-600"
            style={{ width: pct(topic.mastered) }}
          />
        )}
        {topic.learning > 0 && (
          <div className="bg-sky-600" style={{ width: pct(topic.learning) }} />
        )}
      </div>
      <p className="text-xs text-slate-400">
        <span className="mr-2">
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-600" />
          암기 완료 {topic.mastered}
        </span>
        <span className="mr-2">
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-sky-600" />
          학습 중 {topic.learning}
        </span>
        <span>
          <span className="mr-1 inline-block h-2 w-2 rounded-full bg-slate-700" />
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

  if (error) return <p className="text-red-300">{error}</p>;
  if (!stats) return <p className="text-slate-400">불러오는 중...</p>;

  return (
    <div className="space-y-6">
      <section className="rounded border border-slate-800 bg-slate-900 p-5 text-center">
        <p className="text-sm text-slate-400">오늘 복습할 문제</p>
        <p className="my-1 text-4xl font-bold text-slate-100">
          {stats.dueTotal}
        </p>
        {stats.dueTotal > 0 ? (
          <Link
            href="/study?mode=srs"
            className="mt-2 inline-block rounded bg-sky-600 px-6 py-3 font-semibold"
          >
            복습 시작
          </Link>
        ) : (
          <Link
            href="/study?mode=practice"
            className="mt-2 inline-block rounded bg-slate-700 px-6 py-3"
          >
            자유 연습
          </Link>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">주제별 현황</h2>
        {stats.topics.length === 0 && (
          <p className="text-slate-400">
            아직 주제가 없습니다.{" "}
            <Link href="/import" className="text-sky-400">
              가져오기
            </Link>
            에서 첫 문제를 넣어 보세요.
          </p>
        )}
        {stats.topics.map((topic) => (
          <div key={topic.id} className="rounded border border-slate-800 p-4">
            <div className="flex items-center justify-between gap-3">
              <span className="min-w-0 font-semibold">{topic.name}</span>
              <span className="shrink-0 text-sm text-slate-400">
                {topic.total}문제 · 오늘 {topic.dueCount}
              </span>
            </div>
            <ProgressBar topic={topic} />
            <div className="mt-3 flex gap-2 text-sm">
              <Link
                href={`/study?mode=srs&topicId=${topic.id}`}
                className="rounded bg-slate-700 px-3 py-1.5"
              >
                복습
              </Link>
              <Link
                href={`/study?mode=practice&topicId=${topic.id}`}
                className="rounded bg-slate-800 px-3 py-1.5"
              >
                연습
              </Link>
            </div>
          </div>
        ))}
      </section>
    </div>
  );
}
