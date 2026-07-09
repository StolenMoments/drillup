"use client";

import { useEffect, useState } from "react";
import QuestionPreview from "@/components/QuestionPreview";
import type { ImportQuestion } from "@/core/import-schema";
import { api } from "@/lib/api-client";
import type {
  GenerationEngineDto,
  GenerationJobDto,
  ReferenceFileListDto,
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
  return new Set(
    next.items
      .filter((item) => item.ok && item.verdict !== "fail")
      .map((item) => item.index),
  );
}

export default function GeneratePage() {
  const [topics, setTopics] = useState<TopicDto[]>([]);
  const [topicId, setTopicId] = useState<number | "">("");
  const [newTopicName, setNewTopicName] = useState("");
  const [engine, setEngine] = useState<GenerationEngineDto>("CLAUDE");
  const [verifyEngine, setVerifyEngine] = useState<GenerationEngineDto>("CODEX");
  const [verifyTouched, setVerifyTouched] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [job, setJob] = useState<GenerationJobDto | null>(null);
  const [starting, setStarting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [refList, setRefList] = useState<ReferenceFileListDto | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
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
        setVerifyEngine(restored.verifyEngine);
        setVerifyTouched(true);
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
        } else if (restored.status === "RUNNING" || restored.status === "VERIFYING") {
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

  const inProgress = job?.status === "RUNNING" || job?.status === "VERIFYING";
  const selectedTopic = topics.find((topic) => topic.id === topicId);

  useEffect(() => {
    if (!job || (job.status !== "RUNNING" && job.status !== "VERIFYING")) return;
    const startedAt = new Date(job.createdAt).getTime();
    const timer = setInterval(async () => {
      setElapsed(Math.max(0, Math.floor((Date.now() - startedAt) / 1000)));
      try {
        const { job: next } = await api.generate.get(job.id);
        if (next.status !== job.status) {
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

  useEffect(() => {
    const topic = topics.find((item) => item.id === topicId);
    let ignore = false;

    async function loadReferenceFiles() {
      setRefList(null);
      setSelectedFiles(new Set());
      if (topicId === "" || !topic?.referenceDir) return;

      try {
        const list = await api.topics.referenceFiles(topicId);
        if (ignore) return;
        setRefList(list);
        setSelectedFiles(new Set(list.files.map((file) => file.path)));
      } catch {
        if (!ignore) setRefList({ files: [], dirExists: false });
      }
    }

    void loadReferenceFiles();
    return () => {
      ignore = true;
    };
  }, [topicId, topics]);

  function selectEngine(value: GenerationEngineDto) {
    setEngine(value);
    if (!verifyTouched) {
      setVerifyEngine(value === "CLAUDE" ? "CODEX" : "CLAUDE");
    }
  }

  function selectVerifyEngine(value: GenerationEngineDto) {
    setVerifyEngine(value);
    setVerifyTouched(true);
  }

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
    if (topicId === "" || starting || inProgress) return;
    setStarting(true);
    setMessage("");
    setJob(null);
    setSelected(new Set());
    setElapsed(0);
    try {
      const { job: created } = await api.generate.create({
        topicId,
        engine,
        verifyEngine,
        instructions,
        referenceFiles: selectedTopic?.referenceDir ? [...selectedFiles] : [],
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

  function toggleFile(filePath: string) {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
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
    <div className="app-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">AI 문제 생성</h1>
          <p className="page-subtitle">
            생성 엔진에 문제 제작을 맡기고 결과를 검증해 바로 문제은행에 저장합니다.
          </p>
        </div>
      </div>

      <section className="surface surface-pad space-y-3">
        <h2 className="section-title">주제 선택</h2>
        <select
          value={topicId}
          onChange={(event) =>
            setTopicId(event.target.value ? Number(event.target.value) : "")
          }
          className="field"
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
            className="field min-w-0 flex-1"
          />
          <button
            onClick={createTopic}
            disabled={newTopicName.trim().length === 0}
            className="btn btn-secondary shrink-0"
          >
            추가
          </button>
        </div>
      </section>

      {selectedTopic?.referenceDir && (
        <section className="surface surface-pad space-y-3">
          <h2 className="section-title">참고 자료</h2>
          <p className="muted text-sm">
            generation_reference/{selectedTopic.referenceDir}/ — 선택한 파일을
            에이전트가 읽고 근거로 출제합니다
          </p>
          {refList === null ? (
            <p className="muted text-sm">파일 목록을 불러오는 중...</p>
          ) : !refList.dirExists || refList.files.length === 0 ? (
            <p className="text-sm text-[color:var(--warning)]">
              ⚠️ 참고 자료가 없습니다 — generation_reference/
              {selectedTopic.referenceDir}/ 에 md/txt 파일을 넣으세요
            </p>
          ) : (
            <div className="space-y-1">
              {refList.files.map((file) => (
                <label key={file.path} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedFiles.has(file.path)}
                    onChange={() => toggleFile(file.path)}
                  />
                  <span className="min-w-0 flex-1 break-all">{file.path}</span>
                  <span className="subtle shrink-0 text-xs">
                    {(file.size / 1024).toFixed(1)} KB
                  </span>
                </label>
              ))}
            </div>
          )}
        </section>
      )}

      <section className="surface surface-pad space-y-3">
        <h2 className="section-title">엔진과 추가 지시</h2>
        <div className="flex flex-wrap gap-4">
          {ENGINES.map((item) => (
            <label key={item.value} className="chip gap-2">
              <input
                type="radio"
                name="engine"
                checked={engine === item.value}
                onChange={() => selectEngine(item.value)}
              />
              {item.label}
            </label>
          ))}
        </div>
        <div className="space-y-1">
          <p className="muted text-sm">
            검증 엔진 — 생성된 문제를 다른 CLI로 교차 검증합니다
          </p>
          <div className="flex flex-wrap gap-4">
            {ENGINES.map((item) => (
              <label key={item.value} className="chip gap-2">
                <input
                  type="radio"
                  name="verifyEngine"
                  checked={verifyEngine === item.value}
                  onChange={() => selectVerifyEngine(item.value)}
                />
                {item.label}
              </label>
            ))}
          </div>
        </div>
        <textarea
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          rows={4}
          placeholder="범위, 난이도, 문제 수 같은 조건 (예: 쉬운 난이도로 10문제)"
          className="textarea text-sm"
        />
      </section>

      <section className="surface surface-pad space-y-3">
        <h2 className="section-title">생성</h2>
        <button
          onClick={startGeneration}
          disabled={topicId === "" || starting || inProgress}
          className="btn btn-primary"
        >
          {job?.status === "VERIFYING"
            ? `검증 중... (경과 ${elapsed}초)`
            : inProgress
              ? `생성 중... (경과 ${elapsed}초)`
              : "생성 시작"}
        </button>
        {topicId === "" && (
          <p className="text-sm text-[color:var(--warning)]">주제를 먼저 선택하세요</p>
        )}
      </section>

      {job?.status === "FAILED" && (
        <section className="space-y-3">
          <p className="whitespace-pre-wrap break-all rounded-[12px] border border-[color:var(--danger)] bg-[color:var(--danger-soft)] p-3 text-sm">
            ❌ 생성에 실패했습니다: {job.errorMessage}
          </p>
          <button
            onClick={startGeneration}
            className="btn btn-secondary"
          >
            다시 시도
          </button>
        </section>
      )}

      {job?.status === "SUCCEEDED" && job.items && (
        <section className="space-y-3">
          <h2 className="section-title">미리보기 및 저장</h2>
          {job.verifyWarning && (
            <p className="whitespace-pre-wrap break-all rounded-[12px] border border-[color:var(--warning)] bg-[color:var(--warning-soft)] p-3 text-sm">
              ⚠️ 검증을 수행하지 못했습니다: {job.verifyWarning}
            </p>
          )}
          {job.items.map((item) => (
            <div
              key={item.index}
              className={`surface surface-pad ${
                item.ok ? "" : "border-[color:var(--danger)] bg-[color:var(--danger-soft)]"
              }`}
            >
              <div className="mb-2 flex items-center gap-2 text-sm">
                <span className="subtle">#{item.index + 1}</span>
                {item.ok ? (
                  <>
                    <span className="chip">
                      {(item.question as ImportQuestion).type === "mcq"
                        ? "객관식"
                        : "빈칸"}
                    </span>
                    {item.verdict === "pass" && (
                      <span className="chip" style={{ color: "var(--success)" }}>
                        ✅ 검증 통과
                      </span>
                    )}
                    {item.verdict === "fail" && (
                      <span className="chip" style={{ color: "var(--warning)" }}>
                        ⚠️ 검증 의견
                      </span>
                    )}
                    {item.verdict === "unverified" && (
                      <span className="chip">검증 안 됨</span>
                    )}
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
                  <span className="text-[color:var(--danger)]">오류</span>
                )}
              </div>
              {item.ok ? (
                <>
                  <QuestionPreview question={item.question as ImportQuestion} />
                  {item.verdict === "fail" && item.verdictComment && (
                    <p className="mt-2 whitespace-pre-wrap break-all rounded-[12px] border border-[color:var(--warning)] bg-[color:var(--warning-soft)] p-2 text-sm">
                      ⚠️ {item.verdictComment}
                    </p>
                  )}
                  {item.verdict === "pass" && item.verdictComment && (
                    <p className="subtle mt-2 text-xs">{item.verdictComment}</p>
                  )}
                </>
              ) : (
                <ul className="list-inside list-disc text-sm text-[color:var(--danger)]">
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
            className="btn btn-success"
          >
            {saving ? "저장 중..." : `선택한 ${selected.size}개 문제 저장`}
          </button>
        </section>
      )}

      {message && <p className="text-sm text-[color:var(--brand)]">{message}</p>}
    </div>
  );
}
