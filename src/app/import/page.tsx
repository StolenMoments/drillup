"use client";

import { useEffect, useState } from "react";
import {
  parseImportJson,
  type ImportItemResult,
  type ImportParseResult,
} from "@/core/import-schema";
import QuestionPreview from "@/components/QuestionPreview";
import { buildGenerationPrompt } from "@/core/prompt-template";
import { api } from "@/lib/api-client";
import type { TopicDto } from "@/lib/api-types";

export default function ImportPage() {
  const [topics, setTopics] = useState<TopicDto[]>([]);
  const [topicId, setTopicId] = useState<number | "">("");
  const [newTopicName, setNewTopicName] = useState("");
  const [rawJson, setRawJson] = useState("");
  const [parsed, setParsed] = useState<ImportParseResult | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.topics
      .list()
      .then(setTopics)
      .catch((error: unknown) =>
        setMessage(
          error instanceof Error
            ? error.message
            : "주제 목록을 불러오지 못했습니다",
        ),
      );
  }, []);

  const selectedTopic = topics.find((topic) => topic.id === topicId);

  async function refreshTopics() {
    setTopics(await api.topics.list());
  }

  async function createTopic() {
    const name = newTopicName.trim();
    if (!name) return;

    try {
      const topic = await api.topics.create({ name });
      setTopics((prev) =>
        [...prev, topic].sort((a, b) => a.name.localeCompare(b.name)),
      );
      setTopicId(topic.id);
      setNewTopicName("");
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "주제 생성에 실패했습니다",
      );
    }
  }

  async function copyPrompt() {
    if (!selectedTopic) return;
    await navigator.clipboard.writeText(buildGenerationPrompt(selectedTopic.name));
    setMessage("프롬프트를 클립보드에 복사했습니다");
  }

  function validate() {
    const result = parseImportJson(rawJson);
    setParsed(result);
    setMessage("");
    if (result.ok) {
      setSelected(new Set(result.items.filter((item) => item.ok).map((item) => item.index)));
    } else {
      setSelected(new Set());
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

  async function save() {
    if (!parsed?.ok || topicId === "" || selected.size === 0) return;
    const questions = parsed.items
      .filter((item): item is Extract<ImportItemResult, { ok: true }> => item.ok)
      .filter((item) => selected.has(item.index))
      .map((item) => item.question);

    setSaving(true);
    try {
      const { savedCount } = await api.import.submit(topicId, questions);
      setMessage(`${savedCount}개 문제를 저장했습니다`);
      setParsed(null);
      setRawJson("");
      setSelected(new Set());
      await refreshTopics();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장에 실패했습니다");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">문제 가져오기</h1>

      <section className="space-y-3">
        <h2 className="font-semibold">1. 주제 선택</h2>
        <select
          value={topicId}
          onChange={(event) =>
            setTopicId(event.target.value ? Number(event.target.value) : "")
          }
          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
        >
          <option value="">주제를 선택하세요</option>
          {topics.map((topic) => (
            <option key={topic.id} value={topic.id}>
              {topic.name} ({topic.questionCount}문제)
            </option>
          ))}
        </select>
        <div className="flex gap-2">
          <input
            value={newTopicName}
            onChange={(event) => setNewTopicName(event.target.value)}
            placeholder="새 주제 이름"
            className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-3 py-2"
          />
          <button
            onClick={createTopic}
            disabled={newTopicName.trim().length === 0}
            className="shrink-0 rounded bg-slate-700 px-4 py-2 disabled:opacity-50"
          >
            추가
          </button>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">2. LLM 프롬프트 복사</h2>
        <button
          onClick={copyPrompt}
          disabled={!selectedTopic}
          className="rounded bg-slate-700 px-4 py-2 disabled:opacity-50"
        >
          프롬프트 복사
        </button>
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">3. 생성된 JSON 붙여넣기</h2>
        <textarea
          value={rawJson}
          onChange={(event) => setRawJson(event.target.value)}
          rows={12}
          placeholder='{"questions": [...]}'
          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm"
        />
        <button
          onClick={validate}
          disabled={rawJson.trim().length === 0}
          className="rounded bg-sky-600 px-4 py-2 font-semibold disabled:opacity-50"
        >
          검증
        </button>
      </section>

      {parsed && !parsed.ok && (
        <p className="rounded border border-red-800 bg-red-950 p-3 text-red-300">
          {parsed.fatal}
        </p>
      )}

      {parsed?.ok && (
        <section className="space-y-3">
          <h2 className="font-semibold">4. 미리보기 및 저장</h2>
          {parsed.items.map((item) => (
            <div
              key={item.index}
              className={`rounded border p-3 ${
                item.ok ? "border-slate-700" : "border-red-800 bg-red-950/40"
              }`}
            >
              <div className="mb-2 flex items-center gap-2 text-sm">
                <span className="text-slate-500">#{item.index + 1}</span>
                {item.ok ? (
                  <>
                    <span className="rounded bg-slate-800 px-1.5 py-0.5 text-xs">
                      {item.question.type === "mcq" ? "객관식" : "빈칸"}
                    </span>
                    <label className="ml-auto flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected.has(item.index)}
                        onChange={() => toggle(item.index)}
                      />
                      저장
                    </label>
                  </>
                ) : (
                  <span className="text-red-300">오류</span>
                )}
              </div>
              {item.ok ? (
                <QuestionPreview question={item.question} />
              ) : (
                <ul className="list-inside list-disc text-sm text-red-300">
                  {item.errors.map((error) => (
                    <li key={error}>{error}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <button
            onClick={save}
            disabled={topicId === "" || selected.size === 0 || saving}
            className="rounded bg-emerald-600 px-4 py-2 font-semibold disabled:opacity-50"
          >
            {saving ? "저장 중..." : `선택한 ${selected.size}개 문제 저장`}
          </button>
          {topicId === "" && (
            <p className="text-sm text-amber-400">주제를 먼저 선택하세요</p>
          )}
        </section>
      )}

      {message && <p className="text-sm text-sky-300">{message}</p>}
    </div>
  );
}
