"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api-client";
import type {
  GenerationEngineDto,
  ReferenceFileListDto,
  TopicDto,
} from "@/lib/api-types";

const ENGINES: Array<{ value: GenerationEngineDto; label: string }> = [
  { value: "CLAUDE", label: "claude code" },
  { value: "CODEX", label: "codex" },
  { value: "ANTIGRAVITY", label: "antigravity" },
];

function GenerationNewForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const sourceQuestionIds = useMemo(() => {
    const raw = searchParams.get("sourceQuestionIds");
    if (!raw) return [];
    return raw
      .split(",")
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
      .slice(0, 10);
  }, [searchParams]);
  const [topics, setTopics] = useState<TopicDto[]>([]);
  const [topicId, setTopicId] = useState<number | "">("");
  const [newTopicName, setNewTopicName] = useState("");
  const [engine, setEngine] = useState<GenerationEngineDto>("CLAUDE");
  const [verifyEngine, setVerifyEngine] = useState<GenerationEngineDto>("CODEX");
  const [verifyTouched, setVerifyTouched] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [refList, setRefList] = useState<ReferenceFileListDto | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState("");

  const selectedTopic = topics.find((topic) => topic.id === topicId);

  useEffect(() => {
    let ignore = false;
    async function load() {
      try {
        const list = await api.topics.list();
        if (!ignore) {
          setTopics(list);
          const preset = Number(searchParams.get("topicId"));
          if (Number.isInteger(preset) && list.some((topic) => topic.id === preset)) {
            setTopicId(preset);
          }
        }
      } catch (error) {
        if (!ignore) {
          setMessage(
            error instanceof Error ? error.message : "주제 목록을 불러오지 못했습니다",
          );
        }
      }
    }
    void load();
    return () => {
      ignore = true;
    };
  }, [searchParams]);

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
    if (!verifyTouched) setVerifyEngine(value === "CLAUDE" ? "CODEX" : "CLAUDE");
  }

  function selectVerifyEngine(value: GenerationEngineDto) {
    setVerifyEngine(value);
    setVerifyTouched(true);
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

  function toggleFile(filePath: string) {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }

  async function startGeneration() {
    if (topicId === "" || starting) return;
    setStarting(true);
    setMessage("");
    try {
      await api.generate.create({
        topicId,
        engine,
        verifyEngine,
        instructions,
        referenceFiles: selectedTopic?.referenceDir ? [...selectedFiles] : [],
        sourceQuestionIds:
          sourceQuestionIds.length > 0 ? sourceQuestionIds : undefined,
      });
      router.push("/generate");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "생성 요청에 실패했습니다");
      setStarting(false);
    }
  }

  return (
    <div className="app-page space-y-4">
      <div className="page-header">
        <div>
          <h1 className="page-title">AI 문제 생성</h1>
          <p className="page-subtitle">
            생성 엔진에 문제 제작을 맡기고 결과를 검증해 문제은행에 저장합니다.
          </p>
        </div>
      </div>

      {sourceQuestionIds.length > 0 && (
        <section className="surface surface-pad space-y-1">
          <h2 className="section-title">🔀 변형 출제</h2>
          <p className="muted text-sm">
            원본 문제 {sourceQuestionIds.length}개(#{sourceQuestionIds.join(", #")})와 같은
            개념을 다른 각도로 묻는 문제를 생성합니다.
          </p>
        </section>
      )}

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
            generation_reference/{selectedTopic.referenceDir}/ - 선택한 파일을
            에이전트가 읽고 근거로 출제합니다
          </p>
          {refList === null ? (
            <p className="muted text-sm">파일 목록을 불러오는 중...</p>
          ) : !refList.dirExists || refList.files.length === 0 ? (
            <p className="text-sm text-[color:var(--warning)]">
              ⚠️ 참고 자료가 없습니다 - generation_reference/
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
            검증 엔진 - 생성된 문제를 다른 CLI로 교차 검증합니다
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
          disabled={topicId === "" || starting}
          className="btn btn-primary"
        >
          {starting ? "시작하는 중..." : "생성 시작"}
        </button>
        {topicId === "" && (
          <p className="text-sm text-[color:var(--warning)]">주제를 먼저 선택하세요</p>
        )}
      </section>

      {message && <p className="text-sm text-[color:var(--brand)]">{message}</p>}
    </div>
  );
}

export default function GenerationNewPage() {
  return (
    <Suspense fallback={<p className="muted">불러오는 중...</p>}>
      <GenerationNewForm />
    </Suspense>
  );
}
