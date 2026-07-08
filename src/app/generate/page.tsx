"use client";

import { useEffect, useState } from "react";
import QuestionPreview from "@/components/QuestionPreview";
import type { ImportQuestion } from "@/core/import-schema";
import { api } from "@/lib/api-client";
import type {
  GenerationEngineDto,
  GenerationJobDto,
  TopicDto,
} from "@/lib/api-types";

const ENGINES: Array<{ value: GenerationEngineDto; label: string }> = [
  { value: "CLAUDE", label: "claude code" },
  { value: "CODEX", label: "codex" },
  { value: "ANTIGRAVITY", label: "antigravity" },
];

const POLL_INTERVAL_MS = 3000;
const ACTIVE_JOB_STORAGE_KEY = "drillup.activeGenerationJob";

interface StoredGenerationJob {
  jobId: number;
  topicId: number;
}

function readStoredJob(): StoredGenerationJob | null {
  try {
    const raw = window.localStorage.getItem(ACTIVE_JOB_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredGenerationJob>;
    if (
      typeof parsed.jobId !== "number" ||
      typeof parsed.topicId !== "number"
    ) {
      return null;
    }
    return { jobId: parsed.jobId, topicId: parsed.topicId };
  } catch {
    return null;
  }
}

function storeActiveJob(jobId: number, nextTopicId: number) {
  window.localStorage.setItem(
    ACTIVE_JOB_STORAGE_KEY,
    JSON.stringify({ jobId, topicId: nextTopicId }),
  );
}

function clearActiveJob() {
  window.localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
}

function selectValidItems(next: GenerationJobDto) {
  if (next.status !== "SUCCEEDED" || !next.items) return new Set<number>();
  return new Set(next.items.filter((item) => item.ok).map((item) => item.index));
}

export default function GeneratePage() {
  const [topics, setTopics] = useState<TopicDto[]>([]);
  const [topicId, setTopicId] = useState<number | "">("");
  const [newTopicName, setNewTopicName] = useState("");
  const [engine, setEngine] = useState<GenerationEngineDto>("CLAUDE");
  const [instructions, setInstructions] = useState("");
  const [job, setJob] = useState<GenerationJobDto | null>(null);
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [message, setMessage] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let ignore = false;

    async function loadInitialState() {
      try {
        const topicList = await api.topics.list();
        if (ignore) return;
        setTopics(topicList);

        const stored = readStoredJob();
        if (!stored) return;

        const { job: restored } = await api.generate.get(stored.jobId);
        if (ignore) return;

        setTopicId(restored.topicId);
        setEngine(restored.engine);
        setJob(restored);
        setElapsed(
          Math.max(
            0,
            Math.floor((Date.now() - new Date(restored.createdAt).getTime()) / 1000),
          ),
        );
        if (restored.status === "SUCCEEDED") {
          setSelected(selectValidItems(restored));
          setMessage("✅ 이전 생성 결과를 불러왔습니다");
        } else if (restored.status === "RUNNING") {
          setMessage("이전 생성 작업을 이어서 확인합니다");
        }
      } catch (error: unknown) {
        if (ignore) return;
        setMessage(
          error instanceof Error
            ? error.message
            : "주제 목록을 불러오지 못했습니다",
        );
        clearActiveJob();
      }
    }

    void loadInitialState();
    return () => {
      ignore = true;
    };
  }, []);

  const running = job?.status === "RUNNING";

  useEffect(() => {
    if (!job || job.status !== "RUNNING") return;
    const startedAt = new Date(job.createdAt).getTime();
    const timer = setInterval(async () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
      try {
        const { job: next } = await api.generate.get(job.id);
        if (next.status !== "RUNNING") {
          setJob(next);
          if (next.status === "SUCCEEDED" && next.items) {
            setSelected(selectValidItems(next));
          }
        }
      } catch {
        // 폴링 일시 오류는 다음 주기에 재시도한다.
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [job]);

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

  async function startGeneration() {
    if (topicId === "" || starting || running) return;
    setStarting(true);
    setMessage("");
    setJob(null);
    setSelected(new Set());
    setElapsed(0);
    try {
      const { job: created } = await api.generate.create({
        topicId,
        engine,
        instructions,
      });
      storeActiveJob(created.id, topicId);
      setJob(created);
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "생성 요청에 실패했습니다",
      );
    } finally {
      setStarting(false);
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
    if (job?.status !== "SUCCEEDED" || !job.items) return;
    if (selected.size === 0) return;
    const questions = job.items
      .filter((item) => item.ok && selected.has(item.index))
      .map((item) => (item.ok ? item.question : null))
      .filter((question) => question !== null);

    setSaving(true);
    try {
      const { savedCount } = await api.import.submit(job.topicId, questions);
      setMessage(`✅ ${savedCount}개 문제를 저장했습니다`);
      setJob(null);
      setSelected(new Set());
      clearActiveJob();
      await refreshTopics();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "저장에 실패했습니다");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-bold">AI 문제 생성</h1>

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
        <h2 className="font-semibold">2. 엔진과 추가 지시</h2>
        <div className="flex flex-wrap gap-4">
          {ENGINES.map((item) => (
            <label key={item.value} className="flex items-center gap-2">
              <input
                type="radio"
                name="engine"
                checked={engine === item.value}
                onChange={() => setEngine(item.value)}
              />
              {item.label}
            </label>
          ))}
        </div>
        <textarea
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          rows={4}
          placeholder="범위, 난이도, 문제 수 같은 조건 (예: 쉬운 난이도로 10문제)"
          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 text-sm"
        />
      </section>

      <section className="space-y-3">
        <h2 className="font-semibold">3. 생성</h2>
        <button
          onClick={startGeneration}
          disabled={topicId === "" || starting || running}
          className="rounded bg-sky-600 px-4 py-2 font-semibold disabled:opacity-50"
        >
          {running ? `생성 중... (경과 ${elapsed}초)` : "생성 시작"}
        </button>
        {topicId === "" && (
          <p className="text-sm text-amber-400">주제를 먼저 선택하세요</p>
        )}
      </section>

      {job?.status === "FAILED" && (
        <section className="space-y-3">
          <p className="whitespace-pre-wrap break-all rounded border border-red-800 bg-red-950 p-3 text-sm text-red-300">
            ❌ 생성에 실패했습니다: {job.errorMessage}
          </p>
          <button
            onClick={startGeneration}
            className="rounded bg-slate-700 px-4 py-2"
          >
            다시 시도
          </button>
        </section>
      )}

      {job?.status === "SUCCEEDED" && job.items && (
        <section className="space-y-3">
          <h2 className="font-semibold">4. 미리보기 및 저장</h2>
          {job.items.map((item) => (
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
                      {(item.question as ImportQuestion).type === "mcq"
                        ? "객관식"
                        : "빈칸"}
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
                <QuestionPreview question={item.question as ImportQuestion} />
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
            disabled={selected.size === 0 || saving}
            className="rounded bg-emerald-600 px-4 py-2 font-semibold disabled:opacity-50"
          >
            {saving ? "저장 중..." : `선택한 ${selected.size}개 문제 저장`}
          </button>
        </section>
      )}

      {message && <p className="text-sm text-sky-300">{message}</p>}
    </div>
  );
}
