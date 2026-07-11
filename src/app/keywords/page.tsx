"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import type {
  KeywordDto,
  QuestionListItemDto,
  TopicDto,
} from "@/lib/api-types";

const VARIANT_SOURCE_LIMIT = 10;

function mostCommonTopicId(questions: QuestionListItemDto[]): number | null {
  const counts = new Map<number, number>();
  for (const question of questions) {
    counts.set(question.topicId, (counts.get(question.topicId) ?? 0) + 1);
  }
  let best: number | null = null;
  let bestCount = 0;
  for (const [topicId, count] of counts) {
    if (count > bestCount) {
      best = topicId;
      bestCount = count;
    }
  }
  return best;
}

export default function KeywordsPage() {
  const [topics, setTopics] = useState<TopicDto[]>([]);
  const [topicFilter, setTopicFilter] = useState<number | "">("");
  const [keywords, setKeywords] = useState<KeywordDto[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [questions, setQuestions] = useState<QuestionListItemDto[]>([]);
  const [totalQuestions, setTotalQuestions] = useState(0);
  const [message, setMessage] = useState("");

  const selected = useMemo(
    () => keywords?.find((keyword) => keyword.id === selectedId) ?? null,
    [keywords, selectedId],
  );

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const [topicList, keywordList] = await Promise.all([
          api.topics.list(),
          api.keywords.list(topicFilter === "" ? undefined : topicFilter),
        ]);
        if (ignore) return;
        setTopics(topicList);
        setKeywords(keywordList.keywords);
        setSelectedId(null);
        setQuestions([]);
        setMessage("");
      } catch (error) {
        if (!ignore) {
          setMessage(
            error instanceof Error
              ? error.message
              : "키워드 목록을 불러오지 못했습니다",
          );
        }
      }
    }
    void load();
    return () => {
      ignore = true;
    };
  }, [topicFilter]);

  useEffect(() => {
    if (selectedId === null) return;
    let ignore = false;
    api.questions
      .list({ keywordId: selectedId })
      .then((page) => {
        if (ignore) return;
        setQuestions(page.items);
        setTotalQuestions(page.totalItems);
        setMessage("");
      })
      .catch((error: unknown) => {
        if (!ignore) {
          setMessage(
            error instanceof Error
              ? error.message
              : "문제 목록을 불러오지 못했습니다",
          );
        }
      });
    return () => {
      ignore = true;
    };
  }, [selectedId]);

  const generateHref = useMemo(() => {
    if (!selected || questions.length === 0) return null;
    const sourceIds = questions
      .slice(0, VARIANT_SOURCE_LIMIT)
      .map((question) => question.id)
      .join(",");
    const topicId = mostCommonTopicId(questions);
    return `/generate/new?sourceQuestionIds=${sourceIds}${topicId ? `&topicId=${topicId}` : ""}`;
  }, [selected, questions]);

  return (
    <div className="app-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">키워드</h1>
          <p className="page-subtitle">
            개념 키워드로 문제를 모아보고, 집중 연습하거나 변형 문제를 만듭니다.
          </p>
        </div>
      </div>

      <div className="surface surface-pad flex flex-wrap items-center gap-2">
        <select
          value={topicFilter}
          onChange={(event) =>
            setTopicFilter(event.target.value ? Number(event.target.value) : "")
          }
          className="field w-auto min-w-52"
        >
          <option value="">전체 주제</option>
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.name} ({topic.questionCount})
            </option>
          ))}
        </select>
      </div>

      {message && <p className="text-sm text-[color:var(--danger)]">{message}</p>}

      {keywords === null ? (
        <p className="muted">불러오는 중...</p>
      ) : keywords.length === 0 ? (
        <p className="empty-state">
          키워드가 없습니다 — 문제 목록에서 &quot;키워드 일괄 부여&quot;를 실행하거나
          문제 상세에서 직접 추가하세요.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {keywords.map((keyword) => (
            <button
              key={keyword.id}
              type="button"
              onClick={() => {
                const nextSelectedId =
                  selectedId === keyword.id ? null : keyword.id;
                setSelectedId(nextSelectedId);
                setQuestions([]);
                setTotalQuestions(0);
                setMessage("");
              }}
              className={`chip ${selectedId === keyword.id ? "bg-[color:var(--brand-soft)] font-bold" : ""}`}
            >
              {keyword.name}
              <span className="subtle ml-1 text-xs">{keyword.questionCount}</span>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <section className="surface surface-pad space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="section-title min-w-0 flex-1">
              {selected.name} — {totalQuestions}문제
            </h2>
            <Link
              href={`/study?mode=practice&keywordId=${selected.id}`}
              className="btn btn-primary shrink-0"
            >
              📝 이 키워드 연습하기
            </Link>
            {generateHref && (
              <Link href={generateHref} className="btn btn-secondary shrink-0">
                🤖 이 개념으로 문제 생성
              </Link>
            )}
          </div>
          <ul className="space-y-2">
            {questions.map((question) => (
              <li key={question.id} className="list-row flex items-center gap-3 p-3">
                <span className="chip">
                  {question.type === "MCQ" ? "객관식" : "빈칸"}
                </span>
                <span className="min-w-0 flex-1 truncate">{question.preview}</span>
                <Link
                  href={`/questions/${question.id}/edit`}
                  className="shrink-0 text-sm font-semibold text-[color:var(--brand)]"
                >
                  수정
                </Link>
              </li>
            ))}
          </ul>
          {totalQuestions > questions.length && (
            <p className="muted text-sm">
              첫 {questions.length}개만 표시 — 전체는 문제 목록에서 키워드 필터로
              확인하세요.
            </p>
          )}
        </section>
      )}
    </div>
  );
}
