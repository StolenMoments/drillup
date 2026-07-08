"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type { QuestionListItemDto, StatsOverviewDto } from "@/lib/api-types";

export default function StatsPage() {
  const [stats, setStats] = useState<StatsOverviewDto | null>(null);
  const [topicId, setTopicId] = useState<number | "">("");
  const [questions, setQuestions] = useState<QuestionListItemDto[]>([]);
  const [error, setError] = useState("");

  useEffect(() => {
    api.stats
      .overview()
      .then(setStats)
      .catch(() => setError("통계를 불러오지 못했습니다"));
  }, []);

  useEffect(() => {
    api.questions
      .list(topicId === "" ? undefined : topicId)
      .then(setQuestions)
      .catch(() => setError("문제 목록을 불러오지 못했습니다"));
  }, [topicId]);

  if (error) return <p className="text-red-300">{error}</p>;
  if (!stats) return <p className="text-slate-400">불러오는 중...</p>;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">통계</h1>

      <section className="space-y-2">
        <h2 className="font-semibold">주제별 진척도</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-700 text-left text-slate-400">
                <th className="py-2 pr-3">주제</th>
                <th className="py-2 pr-3 text-right">전체</th>
                <th className="py-2 pr-3 text-right">암기 완료</th>
                <th className="py-2 pr-3 text-right">학습 중</th>
                <th className="py-2 pr-3 text-right">미학습</th>
                <th className="py-2 text-right">오늘 복습</th>
              </tr>
            </thead>
            <tbody>
              {stats.topics.map((topic) => (
                <tr key={topic.id} className="border-b border-slate-800">
                  <td className="py-2 pr-3">{topic.name}</td>
                  <td className="py-2 pr-3 text-right">{topic.total}</td>
                  <td className="py-2 pr-3 text-right">{topic.mastered}</td>
                  <td className="py-2 pr-3 text-right">{topic.learning}</td>
                  <td className="py-2 pr-3 text-right">{topic.unlearned}</td>
                  <td className="py-2 text-right">{topic.dueCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="font-semibold">문제별 정답률</h2>
        <select
          value={topicId}
          onChange={(event) =>
            setTopicId(event.target.value ? Number(event.target.value) : "")
          }
          className="rounded border border-slate-700 bg-slate-900 px-3 py-2"
        >
          <option value="">전체 주제</option>
          {stats.topics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.name}
            </option>
          ))}
        </select>
        {questions.length === 0 ? (
          <p className="text-slate-400">문제가 없습니다.</p>
        ) : (
          <ul className="space-y-1">
            {questions.map((question) => (
              <li
                key={question.id}
                className="flex items-center gap-3 rounded border border-slate-800 px-3 py-2 text-sm"
              >
                <span className="min-w-0 flex-1 truncate">
                  {question.preview}
                </span>
                <span className="shrink-0 text-slate-400">
                  {question.attempts === 0
                    ? "미풀이"
                    : `${Math.round(
                        (question.correctCount / question.attempts) * 100,
                      )}% (${question.correctCount}/${question.attempts})`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
