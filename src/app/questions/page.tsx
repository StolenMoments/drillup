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
    <div className="space-y-4">
      <h1 className="text-xl font-bold">문제 관리</h1>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={topicId}
          onChange={(event) =>
            setTopicId(event.target.value ? Number(event.target.value) : "")
          }
          className="rounded border border-slate-700 bg-slate-900 px-3 py-2"
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
              className="rounded bg-slate-700 px-3 py-2 text-sm"
            >
              주제 이름 변경
            </button>
            <button
              onClick={removeTopic}
              className="rounded bg-red-800 px-3 py-2 text-sm"
            >
              주제 삭제
            </button>
          </>
        )}
      </div>

      {message && <p className="text-sm text-red-300">{message}</p>}

      {questions.length === 0 ? (
        <p className="text-slate-400">문제가 없습니다.</p>
      ) : (
        <ul className="space-y-2">
          {questions.map((question) => (
            <li
              key={question.id}
              className="flex items-center gap-3 rounded border border-slate-800 p-3"
            >
              <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">
                {question.type === "MCQ" ? "객관식" : "빈칸"}
              </span>
              <span className="min-w-0 flex-1 truncate">{question.preview}</span>
              <span className="shrink-0 text-sm text-slate-400">
                {question.attempts === 0
                  ? "미학습"
                  : `${Math.round(
                      (question.correctCount / question.attempts) * 100,
                    )}% (${question.correctCount}/${question.attempts})`}
              </span>
              <Link
                href={`/questions/${question.id}`}
                className="shrink-0 text-sm text-sky-400"
              >
                수정
              </Link>
              <button
                onClick={() => removeQuestion(question.id)}
                className="shrink-0 text-sm text-red-400"
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
