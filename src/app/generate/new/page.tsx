"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { api } from "@/lib/api-client";
import { buildGenerationRetryInput } from "@/lib/generation-retry";
import type {
  ChoiceCountDto,
  CorrectAnswerCountDto,
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
const AIP_REQUIRED_FILES = new Set([
  "common/00-exam-guide.md",
  "common/01-style-examples.md",
]);
const CORRECT_ANSWER_COUNTS: CorrectAnswerCountDto[] = [1, 2];
const CHOICE_COUNTS: ChoiceCountDto[] = [4, 5, 6];

function GenerationNewForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialSourceQuestionIds = useMemo(() => {
    const raw = searchParams.get("sourceQuestionIds");
    if (!raw) return [];
    return raw
      .split(",")
      .map((value) => Number(value))
      .filter((value) => Number.isInteger(value) && value > 0)
      .slice(0, 10);
  }, [searchParams]);
  const retryJobId = useMemo(() => {
    const raw = searchParams.get("retryJobId");
    if (!raw) return null;
    const value = Number(raw);
    return Number.isInteger(value) && value > 0 ? value : null;
  }, [searchParams]);
  const [topics, setTopics] = useState<TopicDto[]>([]);
  const [topicId, setTopicId] = useState<number | "">("");
  const [newTopicName, setNewTopicName] = useState("");
  const [engine, setEngine] = useState<GenerationEngineDto>("CLAUDE");
  const [verifyEngine, setVerifyEngine] = useState<GenerationEngineDto>("CODEX");
  const [verifyTouched, setVerifyTouched] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [correctAnswerCount, setCorrectAnswerCount] = useState<CorrectAnswerCountDto>(1);
  const [choiceCount, setChoiceCount] = useState<ChoiceCountDto>(5);
  const [refList, setRefList] = useState<ReferenceFileListDto | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [starting, setStarting] = useState(false);
  const [message, setMessage] = useState("");
  const [retryJob, setRetryJob] = useState<GenerationJobDto | null>(null);
  const [retryMissingFiles, setRetryMissingFiles] = useState<string[]>([]);
  const [sourceIds, setSourceIds] = useState<number[]>(initialSourceQuestionIds);
  const retryConsumedRef = useRef(false);

  const selectedTopic = topics.find((topic) => topic.id === topicId);

  useEffect(() => {
    let ignore = false;
    retryConsumedRef.current = false;

    async function load() {
      const [topicsResult, retryResult] = await Promise.allSettled([
        api.topics.list(),
        retryJobId === null ? Promise.resolve(null) : api.generate.get(retryJobId),
      ]);
      if (ignore) return;
      setRetryJob(null);
      setRetryMissingFiles([]);

      if (topicsResult.status === "fulfilled") {
        const list = topicsResult.value;
        setTopics(list);
        const preset = Number(searchParams.get("topicId"));
        if (
          retryJobId === null &&
          Number.isInteger(preset) &&
          list.some((topic) => topic.id === preset)
        ) {
          setTopicId(preset);
        }
      } else {
        setMessage(
          topicsResult.reason instanceof Error
            ? topicsResult.reason.message
            : "주제 목록을 불러오지 못했습니다",
        );
      }

      if (retryJobId === null) return;
      if (retryResult.status === "rejected") {
        setMessage(
          `❌ 이전 생성 작업을 불러오지 못했습니다. ${
            retryResult.reason instanceof Error
              ? retryResult.reason.message
              : "잠시 후 다시 시도해 주세요"
          } 일반 새 생성은 계속할 수 있습니다.`,
        );
        return;
      }
      if (retryResult.value === null) return;

      const loaded = retryResult.value.job;
      if (loaded.kind !== "QUESTION") {
        setMessage("❌ 키워드 부여 작업은 문제 생성 재시도로 복원할 수 없습니다.");
        return;
      }

      const retryInput = buildGenerationRetryInput(loaded, []);
      if (!retryInput.input) return;
      setRetryJob(loaded);
      setTopicId(retryInput.input.topicId);
      setEngine(retryInput.input.engine);
      setVerifyEngine(retryInput.input.verifyEngine);
      setVerifyTouched(true);
      setInstructions(retryInput.input.instructions);
      setCorrectAnswerCount(retryInput.input.correctAnswerCount);
      setChoiceCount(retryInput.input.choiceCount);
      setSourceIds(retryInput.input.sourceQuestionIds);
    }
    void load();
    return () => {
      ignore = true;
    };
  }, [retryJobId, searchParams]);

  useEffect(() => {
    const topic = topics.find((item) => item.id === topicId);
    let ignore = false;

    async function loadReferenceFiles() {
      setRefList(null);
      setSelectedFiles(new Set());
      setRetryMissingFiles([]);
      const shouldRestoreRetry =
        retryJob !== null &&
        retryJob.topicId === topicId &&
        !retryConsumedRef.current;

      if (topicId === "") return;
      if (!topic?.referenceDir) {
        if (shouldRestoreRetry) {
          const retry = buildGenerationRetryInput(retryJob as GenerationJobDto, []);
          if (retry.input) {
            setSelectedFiles(new Set(retry.input.referenceFiles));
            setRetryMissingFiles(retry.missingReferenceFiles);
          }
          retryConsumedRef.current = true;
        }
        return;
      }

      try {
        const list = await api.topics.referenceFiles(topicId);
        if (ignore) return;
        setRefList(list);
        if (shouldRestoreRetry) {
          const retry = buildGenerationRetryInput(
            retryJob as GenerationJobDto,
            list.files.map((file) => file.path),
          );
          if (retry.input) {
            setSelectedFiles(new Set(retry.input.referenceFiles));
            setRetryMissingFiles(retry.missingReferenceFiles);
          }
          retryConsumedRef.current = true;
        } else {
          setSelectedFiles(new Set(list.files.map((file) => file.path)));
        }
      } catch {
        if (!ignore) setRefList({ files: [], dirExists: false });
      }
    }

    void loadReferenceFiles();
    return () => {
      ignore = true;
    };
  }, [retryJob, topicId, topics]);

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
    if (selectedTopic?.referenceDir === "aip-c01" && AIP_REQUIRED_FILES.has(filePath)) return;
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filePath)) next.delete(filePath);
      else next.add(filePath);
      return next;
    });
  }

  async function startGeneration() {
    if (topicId === "" || starting) return;
    if (selectedTopic?.referenceDir === "aip-c01") {
      const domainFiles = [...selectedFiles].filter((file) => !AIP_REQUIRED_FILES.has(file));
      if (domainFiles.length === 0) {
        setMessage("AIP-C01은 시험 가이드·스타일 예시와 함께 도메인 참고 자료를 하나 이상 선택해야 합니다.");
        return;
      }
    }
    setStarting(true);
    setMessage("");
    try {
      await api.generate.create({
        topicId,
        engine,
        verifyEngine,
        instructions,
        correctAnswerCount,
        choiceCount,
        referenceFiles: selectedTopic?.referenceDir ? [...selectedFiles] : [],
        sourceQuestionIds:
          sourceIds.length > 0 ? sourceIds : undefined,
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

      {sourceIds.length > 0 && (
        <section className="surface surface-pad space-y-1">
          <h2 className="section-title">🔀 변형 출제</h2>
          <p className="muted text-sm">
            원본 문제 {sourceIds.length}개(#{sourceIds.join(", #")})와 같은
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
              {refList.files.map((file) => {
                const required = selectedTopic.referenceDir === "aip-c01" && AIP_REQUIRED_FILES.has(file.path);
                return (
                <label key={file.path} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={selectedFiles.has(file.path)}
                    onChange={() => toggleFile(file.path)}
                    disabled={required}
                  />
                  <span className="min-w-0 flex-1 break-all">{file.path}{required ? " (필수)" : ""}</span>
                  <span className="subtle shrink-0 text-xs">
                    {(file.size / 1024).toFixed(1)} KB
                  </span>
                </label>
                );
              })}
            </div>
          )}
        </section>
      )}

      {retryMissingFiles.length > 0 && (
        <p className="whitespace-pre-wrap break-all rounded-[12px] border border-[color:var(--warning)] bg-[color:var(--warning-soft)] p-3 text-sm">
          ⚠️ 이전 작업에서 선택한 참고 자료 중 현재 존재하지 않는 파일은 제외했습니다: {retryMissingFiles.join(", ")}
        </p>
      )}

      <section className="surface surface-pad space-y-3">
        <h2 className="section-title">문항 구성</h2>
        <fieldset className="space-y-2">
          <legend className="muted text-sm">정답 수 — 모든 문항에 정확히 적용됩니다</legend>
          <div className="flex flex-wrap gap-2">
            {CORRECT_ANSWER_COUNTS.map((count) => (
              <label key={count} className="chip gap-2">
                <input
                  type="radio"
                  name="correctAnswerCount"
                  value={count}
                  checked={correctAnswerCount === count}
                  onChange={() => setCorrectAnswerCount(count)}
                />
                정답 {count}개
              </label>
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="muted text-sm">선지 수 — 모든 문항에 정확히 적용됩니다</legend>
          <div className="flex flex-wrap gap-2">
            {CHOICE_COUNTS.map((count) => (
              <label key={count} className="chip gap-2">
                <input
                  type="radio"
                  name="choiceCount"
                  value={count}
                  checked={choiceCount === count}
                  onChange={() => setChoiceCount(count)}
                />
                선지 {count}개
              </label>
            ))}
          </div>
        </fieldset>
      </section>

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
