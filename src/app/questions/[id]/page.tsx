"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import { api } from "@/lib/api-client";
import type { KeywordDto, KeywordRefDto } from "@/lib/api-types";

export default function QuestionEditPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();

  const [payloadText, setPayloadText] = useState("");
  const [explanation, setExplanation] = useState("");
  const [type, setType] = useState<"MCQ" | "CLOZE" | null>(null);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [topicId, setTopicId] = useState<number | null>(null);
  const [keywords, setKeywords] = useState<KeywordRefDto[]>([]);
  const [allKeywords, setAllKeywords] = useState<KeywordDto[]>([]);
  const [newKeyword, setNewKeyword] = useState("");

  useEffect(() => {
    api.questions
      .get(id)
      .then((question) => {
        setPayloadText(JSON.stringify(question.payload, null, 2));
        setExplanation(question.explanation ?? "");
        setType(question.type);
        setTopicId(question.topicId);
        setKeywords(question.keywords);
        setLoaded(true);
      })
      .catch((error: unknown) =>
        setMessage(
          error instanceof Error
            ? error.message
            : "문제를 불러오지 못했습니다",
        ),
      );

    api.keywords
      .list()
      .then((data) => setAllKeywords(data.keywords))
      .catch(() => setAllKeywords([]));
  }, [id]);

  async function save() {
    let payload: unknown;
    try {
      payload = JSON.parse(payloadText);
    } catch {
      setMessage("payload가 올바른 JSON이 아닙니다");
      return;
    }

    try {
      await api.questions.update(id, {
        payload,
        explanation: explanation.trim() ? explanation.trim() : null,
      });
      router.push("/questions");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장에 실패했습니다");
    }
  }

  async function addKeyword() {
    const name = newKeyword.trim();
    if (!name) return;
    try {
      const added = await api.questions.addKeyword(id, name);
      setKeywords((prev) =>
        prev.some((keyword) => keyword.id === added.id)
          ? prev
          : [...prev, added].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setNewKeyword("");
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "키워드 추가에 실패했습니다",
      );
    }
  }

  async function removeKeyword(keywordId: number) {
    try {
      await api.questions.removeKeyword(id, keywordId);
      setKeywords((prev) => prev.filter((keyword) => keyword.id !== keywordId));
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "키워드 삭제에 실패했습니다",
      );
    }
  }

  if (!loaded) {
    return <p className="muted">{message || "불러오는 중..."}</p>;
  }

  return (
    <div className="app-page max-w-4xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">문제 수정 #{id}</h1>
          <p className="page-subtitle">
            <span className="chip">{type === "MCQ" ? "객관식" : "빈칸"}</span>
          </p>
        </div>
      </div>
      <div className="surface surface-pad space-y-2">
        <label className="text-sm font-semibold text-[color:var(--muted)]">payload (JSON)</label>
        <textarea
          value={payloadText}
          onChange={(event) => setPayloadText(event.target.value)}
          rows={14}
          className="textarea font-mono text-sm"
        />
      </div>
      <div className="surface surface-pad space-y-2">
        <label className="text-sm font-semibold text-[color:var(--muted)]">해설</label>
        <textarea
          value={explanation}
          onChange={(event) => setExplanation(event.target.value)}
          rows={4}
          className="textarea"
        />
      </div>
      <div className="surface surface-pad space-y-2">
        <label className="text-sm font-semibold text-[color:var(--muted)]">키워드</label>
        <div className="flex flex-wrap items-center gap-2">
          {keywords.length === 0 && (
            <span className="muted text-sm">아직 키워드가 없습니다.</span>
          )}
          {keywords.map((keyword) => (
            <span key={keyword.id} className="chip gap-1">
              {keyword.name}
              <button
                type="button"
                onClick={() => removeKeyword(keyword.id)}
                aria-label={`${keyword.name} 키워드 삭제`}
                className="text-[color:var(--danger)]"
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={newKeyword}
            onChange={(event) => setNewKeyword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void addKeyword();
              }
            }}
            list="keyword-options"
            placeholder="키워드 추가 (예: TCP)"
            className="field min-w-0 flex-1"
          />
          <datalist id="keyword-options">
            {allKeywords.map((keyword) => (
              <option key={keyword.id} value={keyword.name} />
            ))}
          </datalist>
          <button
            onClick={addKeyword}
            disabled={newKeyword.trim().length === 0}
            className="btn btn-secondary shrink-0"
          >
            추가
          </button>
        </div>
      </div>
      {message && <p className="text-sm text-[color:var(--danger)]">{message}</p>}
      <div className="flex gap-2">
        <button
          onClick={save}
          className="btn btn-primary"
        >
          저장
        </button>
        <button
          onClick={() => router.push("/questions")}
          className="btn btn-secondary"
        >
          취소
        </button>
        {topicId !== null && (
          <Link
            href={`/generate/new?topicId=${topicId}&sourceQuestionIds=${id}`}
            className="btn btn-secondary ml-auto"
          >
            🤖 변형 문제 생성
          </Link>
        )}
      </div>
    </div>
  );
}
