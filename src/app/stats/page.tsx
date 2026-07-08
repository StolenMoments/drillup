"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";
import type {
  QuestionListPageDto,
  QuestionListSortDto,
  QuestionTypeDto,
  StatsOverviewDto,
} from "@/lib/api-types";

const emptyPage: QuestionListPageDto = {
  items: [],
  page: 1,
  pageSize: 15,
  totalItems: 0,
  totalPages: 1,
};

function visibleRange(pageData: QuestionListPageDto): string {
  if (pageData.totalItems === 0) return "0 / 0";
  const start = (pageData.page - 1) * pageData.pageSize + 1;
  const end = Math.min(pageData.page * pageData.pageSize, pageData.totalItems);
  return `${start}-${end} / ${pageData.totalItems}`;
}

function accuracyText(question: QuestionListPageDto["items"][number]): string {
  if (question.attempts === 0) return "미학습";
  return `${Math.round((question.correctCount / question.attempts) * 100)}% (${question.correctCount}/${question.attempts})`;
}

export default function StatsPage() {
  const [stats, setStats] = useState<StatsOverviewDto | null>(null);
  const [topicId, setTopicId] = useState<number | "">("");
  const [typeFilter, setTypeFilter] = useState<QuestionTypeDto | "">("");
  const [sort, setSort] = useState<QuestionListSortDto>("latest");
  const [page, setPage] = useState(1);
  const [questionPage, setQuestionPage] =
    useState<QuestionListPageDto>(emptyPage);
  const [error, setError] = useState("");

  useEffect(() => {
    api.stats
      .overview()
      .then(setStats)
      .catch(() => setError("통계를 불러오지 못했습니다"));
  }, []);

  useEffect(() => {
    api.questions
      .list({
        topicId: topicId === "" ? undefined : topicId,
        type: typeFilter === "" ? undefined : typeFilter,
        sort,
        page,
      })
      .then((nextPage) => {
        setQuestionPage(nextPage);
        if (nextPage.page !== page) {
          setPage(nextPage.page);
        }
      })
      .catch(() => setError("문제 목록을 불러오지 못했습니다"));
  }, [topicId, typeFilter, sort, page]);

  function resetPage() {
    setPage(1);
  }

  if (error) return <p className="text-[color:var(--danger)]">{error}</p>;
  if (!stats) return <p className="muted">불러오는 중...</p>;

  const questions = questionPage.items;

  return (
    <div className="app-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">통계</h1>
          <p className="page-subtitle">
            주제별 진척도와 문제별 정답률을 확인해 다음 학습 대상을 고릅니다.
          </p>
        </div>
      </div>

      <section className="surface surface-pad space-y-3">
        <h2 className="section-title">주제별 진척도</h2>
        <div className="overflow-x-auto rounded-[10px] border border-[color:var(--border)]">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[color:var(--border)] bg-[oklch(0.21_0.026_252)] text-left text-[color:var(--muted)]">
                <th className="px-3 py-2">주제</th>
                <th className="px-3 py-2 text-right">전체</th>
                <th className="px-3 py-2 text-right">익히기 완료</th>
                <th className="px-3 py-2 text-right">학습 중</th>
                <th className="px-3 py-2 text-right">미학습</th>
                <th className="px-3 py-2 text-right">오늘 복습</th>
              </tr>
            </thead>
            <tbody>
              {stats.topics.map((topic) => (
                <tr
                  key={topic.id}
                  className="border-b border-[color:var(--border)] last:border-b-0"
                >
                  <td className="px-3 py-2">{topic.name}</td>
                  <td className="px-3 py-2 text-right">{topic.total}</td>
                  <td className="px-3 py-2 text-right">{topic.mastered}</td>
                  <td className="px-3 py-2 text-right">{topic.learning}</td>
                  <td className="px-3 py-2 text-right">{topic.unlearned}</td>
                  <td className="px-3 py-2 text-right">{topic.dueCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="section-title">문제별 정답률</h2>
        <div className="surface surface-pad flex flex-wrap items-center gap-2">
          <select
            value={topicId}
            onChange={(event) => {
              setTopicId(event.target.value ? Number(event.target.value) : "");
              resetPage();
            }}
            className="field w-auto min-w-52"
          >
            <option value="">전체 주제</option>
            {stats.topics.map((topic) => (
              <option key={topic.id} value={topic.id}>
                {topic.name}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(event) => {
              setTypeFilter(event.target.value as QuestionTypeDto | "");
              resetPage();
            }}
            className="field w-auto min-w-36"
          >
            <option value="">전체 유형</option>
            <option value="MCQ">객관식</option>
            <option value="CLOZE">빈칸</option>
          </select>
          <select
            value={sort}
            onChange={(event) => {
              setSort(event.target.value as QuestionListSortDto);
              resetPage();
            }}
            className="field w-auto min-w-44"
          >
            <option value="latest">최신순</option>
            <option value="accuracyAsc">정답률 낮은순</option>
            <option value="accuracyDesc">정답률 높은순</option>
          </select>
        </div>

        {questions.length === 0 ? (
          <p className="empty-state">문제가 없습니다.</p>
        ) : (
          <ul className="space-y-1">
            {questions.map((question) => (
              <li
                key={question.id}
                className="list-row flex items-center gap-3 px-3 py-2 text-sm"
              >
                <span className="chip">
                  {question.type === "MCQ" ? "객관식" : "빈칸"}
                </span>
                <span className="min-w-0 flex-1 truncate">
                  {question.preview}
                </span>
                <span className="shrink-0 text-[color:var(--muted)]">
                  {accuracyText(question)}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="pagination-bar">
          <button
            type="button"
            onClick={() => setPage((current) => Math.max(1, current - 1))}
            disabled={questionPage.page <= 1}
            className="btn btn-secondary min-h-9 px-3 text-sm"
          >
            이전
          </button>
          <span className="pagination-summary">
            {questionPage.page} / {questionPage.totalPages} 페이지
          </span>
          <span className="pagination-summary">{visibleRange(questionPage)}</span>
          <button
            type="button"
            onClick={() =>
              setPage((current) => Math.min(questionPage.totalPages, current + 1))
            }
            disabled={questionPage.page >= questionPage.totalPages}
            className="btn btn-secondary min-h-9 px-3 text-sm"
          >
            다음
          </button>
        </div>
      </section>
    </div>
  );
}
