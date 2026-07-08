"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import type { QuestionListItemDto, TopicDto } from "@/lib/api-types";

export default function QuestionsPage() {
  const [topics, setTopics] = useState<TopicDto[]>([]);
  const [topicId, setTopicId] = useState<number | "">("");
  const [questions, setQuestions] = useState<QuestionListItemDto[]>([]);
  const [message, setMessage] = useState("");
  const requestIdRef = useRef(0);

  const reload = useCallback(async (selectedTopicId: number | "") => {
    const requestId = ++requestIdRef.current;
    try {
      const [topicList, questionList] = await Promise.all([
        api.topics.list(),
        api.questions.list(selectedTopicId === "" ? undefined : selectedTopicId),
      ]);
      if (requestId !== requestIdRef.current) return;
      setTopics(topicList);
      setQuestions(questionList);
    } catch (error) {
      if (requestId !== requestIdRef.current) return;
      setMessage(
        error instanceof Error ? error.message : "목록을 불러오지 못했습니다",
      );
    }
  }, []);

  useEffect(() => {
    void Promise.resolve().then(() => reload(topicId));
  }, [topicId, reload]);

  async function removeQuestion(id: number) {
    if (!window.confirm("이 문제를 삭제할까요?")) return;
    await api.questions.remove(id);
    await reload(topicId);
  }

  async function renameTopic() {
    if (topicId === "") return;
    const current = topics.find((topic) => topic.id === topicId);
    const name = window.prompt("새 주제 이름", current?.name ?? "");
    if (!name?.trim()) return;

    try {
      await api.topics.update(topicId, { name: name.trim() });
      await reload(topicId);
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "이름 변경 실패");
    }
  }

  async function removeTopic() {
    if (topicId === "") return;
    if (!window.confirm("주제와 포함된 문제가 모두 삭제됩니다. 계속할까요?")) {
      return;
    }
    await api.topics.remove(topicId);
    setTopicId("");
    await reload("");
  }

  return (
    <div className="app-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">문제 관리</h1>
          <p className="page-subtitle">
            주제별로 문제를 훑고, 필요할 때 원본 payload와 해설을 수정합니다.
          </p>
        </div>
      </div>

      <div className="surface surface-pad flex flex-wrap items-center gap-2">
        <select
          value={topicId}
          onChange={(event) =>
            setTopicId(event.target.value ? Number(event.target.value) : "")
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
        {topicId !== "" && (
          <>
            <button
              onClick={renameTopic}
              className="btn btn-secondary min-h-9 px-3 text-sm"
            >
              주제 이름 변경
            </button>
            <button
              onClick={removeTopic}
              className="btn btn-danger min-h-9 px-3 text-sm"
            >
              주제 삭제
            </button>
          </>
        )}
      </div>

      {message && <p className="text-sm text-[color:var(--danger)]">{message}</p>}

      {questions.length === 0 ? (
        <p className="empty-state">문제가 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {questions.map((question) => (
            <li
              key={question.id}
              className="list-row flex items-center gap-3 p-3"
            >
              <span className="chip">
                {question.type === "MCQ" ? "객관식" : "빈칸"}
              </span>
              <span className="min-w-0 flex-1 truncate">{question.preview}</span>
              <span className="shrink-0 text-sm text-[color:var(--muted)]">
                {question.attempts === 0
                  ? "미학습"
                  : `${Math.round(
                      (question.correctCount / question.attempts) * 100,
                    )}% (${question.correctCount}/${question.attempts})`}
              </span>
              <Link
                href={`/questions/${question.id}`}
                className="shrink-0 text-sm font-semibold text-[color:var(--brand)]"
              >
                수정
              </Link>
              <button
                onClick={() => removeQuestion(question.id)}
                className="shrink-0 text-sm font-semibold text-[color:var(--danger)]"
              >
                삭제
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
