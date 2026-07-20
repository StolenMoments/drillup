"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ApiError, api } from "@/lib/api-client";
import type {
  GenerationEngineDto,
  NoteTidyJobDto,
  TopicNoteDto,
} from "@/lib/api-types";

const ENGINES: GenerationEngineDto[] = ["CLAUDE", "CODEX", "ANTIGRAVITY"];
const POLL_MS = 3_000;
const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

interface NotePanelProps {
  topicId: number;
  onClose: () => void;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function Markdown({ content }: { content: string }) {
  if (content.trim().length === 0) {
    return (
      <div className="empty-state text-sm">
        <p>아직 노트가 없습니다. 편집을 눌러 첫 내용을 적어 보세요.</p>
      </div>
    );
  }

  return (
    <div className="note-markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </div>
  );
}

export default function NotePanel(props: NotePanelProps) {
  return <NotePanelContent key={props.topicId} {...props} />;
}

function NotePanelContent({ topicId, onClose }: NotePanelProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const topicGenerationRef = useRef(0);
  const jobRequestTokenRef = useRef(0);
  const savingRef = useRef(false);
  const [note, setNote] = useState<TopicNoteDto | null>(null);
  const [mode, setMode] = useState<"view" | "edit">("view");
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [tidyStarting, setTidyStarting] = useState(false);
  const [tidyAction, setTidyAction] = useState<"apply" | "dismiss" | null>(
    null,
  );
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");
  const [pollError, setPollError] = useState("");
  const [engine, setEngine] = useState<GenerationEngineDto>("CLAUDE");
  const [job, setJob] = useState<NoteTidyJobDto | null>(null);
  const [comparing, setComparing] = useState<"draft" | "current">("draft");

  const invalidateJobRequests = useCallback(() => {
    jobRequestTokenRef.current += 1;
  }, []);

  const loadJob = useCallback(
    async (jobId: number, topicGeneration: number) => {
      const requestToken = ++jobRequestTokenRef.current;
      const requestIsCurrent = () =>
        topicGenerationRef.current === topicGeneration &&
        jobRequestTokenRef.current === requestToken;

      try {
        const { job: loaded } = await api.notes.tidyJob(jobId);
        if (!requestIsCurrent()) return undefined;
        setJob(loaded);
        setPollError("");
        return loaded;
      } catch (loadError) {
        if (!requestIsCurrent()) return undefined;
        setPollError(
          errorMessage(loadError, "정리 작업 조회에 실패했습니다"),
        );
        return null;
      }
    },
    [],
  );

  useEffect(() => {
    const topicGeneration = topicGenerationRef.current + 1;
    topicGenerationRef.current = topicGeneration;
    invalidateJobRequests();

    api.notes
      .get(topicId)
      .then((loaded) => {
        if (topicGenerationRef.current !== topicGeneration) return;
        setNote(loaded);
        if (loaded.activeTidyJob) {
          void loadJob(loaded.activeTidyJob.id, topicGeneration);
        }
      })
      .catch((loadError: unknown) => {
        if (topicGenerationRef.current === topicGeneration) {
          setError(errorMessage(loadError, "노트를 불러오지 못했습니다"));
        }
      });

    return () => {
      if (topicGenerationRef.current === topicGeneration) {
        topicGenerationRef.current += 1;
      }
      invalidateJobRequests();
    };
  }, [invalidateJobRequests, loadJob, topicId]);

  useEffect(() => {
    if (job?.status !== "RUNNING") return;
    const topicGeneration = topicGenerationRef.current;
    let cancelled = false;
    let timer: number | undefined;

    const schedule = () => {
      timer = window.setTimeout(() => void poll(), POLL_MS);
    };

    const poll = async () => {
      const loaded = await loadJob(job.id, topicGeneration);
      if (cancelled || loaded === undefined) return;
      if (loaded === null || loaded.status === "RUNNING") schedule();
    };

    schedule();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      invalidateJobRequests();
    };
  }, [invalidateJobRequests, job?.id, job?.status, loadJob]);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        panelRef.current?.querySelectorAll<HTMLElement>(
          FOCUSABLE_SELECTOR,
        ) ?? [],
      );
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      const focusIsOutside = !panelRef.current?.contains(active);
      if (event.shiftKey && (active === first || focusIsOutside)) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || focusIsOutside)
      ) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [onClose]);

  function startEdit() {
    if (!note) return;
    setDraft(note.content);
    setMode("edit");
    setFeedback("");
    setError("");
  }

  async function save() {
    if (savingRef.current) return;
    const topicGeneration = topicGenerationRef.current;
    savingRef.current = true;
    setSaving(true);
    setError("");
    try {
      const saved = await api.notes.save(topicId, draft);
      if (topicGenerationRef.current !== topicGeneration) return;
      setNote(saved);
      setMode("view");
      setFeedback("저장했습니다 ✅");
    } catch (saveError) {
      if (topicGenerationRef.current !== topicGeneration) return;
      setError(errorMessage(saveError, "저장에 실패했습니다"));
    } finally {
      if (topicGenerationRef.current === topicGeneration) {
        savingRef.current = false;
        setSaving(false);
      }
    }
  }

  async function startTidy() {
    const topicGeneration = topicGenerationRef.current;
    invalidateJobRequests();
    setTidyStarting(true);
    setError("");
    setFeedback("");
    try {
      const { job: started } = await api.notes.tidy(topicId, engine);
      if (topicGenerationRef.current !== topicGeneration) return;
      setJob(started);
      setComparing("draft");
    } catch (startError) {
      if (topicGenerationRef.current !== topicGeneration) return;
      setError(
        errorMessage(startError, "정리 작업 시작에 실패했습니다"),
      );
    } finally {
      if (topicGenerationRef.current === topicGeneration) {
        setTidyStarting(false);
      }
    }
  }

  async function applyTidy() {
    if (!job) return;
    const currentJob = job;
    const topicGeneration = topicGenerationRef.current;
    invalidateJobRequests();
    setTidyAction("apply");
    setError("");
    try {
      const applied = await api.notes.applyTidy(currentJob.id);
      if (topicGenerationRef.current !== topicGeneration) return;
      setNote(applied);
      setJob(null);
      setFeedback("정리 결과를 반영했습니다 ✅");
    } catch (applyError) {
      if (topicGenerationRef.current !== topicGeneration) return;
      if (
        applyError instanceof ApiError &&
        applyError.code === "NOTE_TIDY_SOURCE_CHANGED"
      ) {
        setError(
          "노트가 그 사이 수정되어 반영할 수 없습니다 ❌ 초안을 폐기하고 다시 실행해 주세요",
        );
      } else {
        setError(errorMessage(applyError, "반영에 실패했습니다"));
      }
    } finally {
      if (topicGenerationRef.current === topicGeneration) {
        setTidyAction(null);
      }
    }
  }

  async function dismissTidy() {
    if (!job) return;
    const currentJob = job;
    const topicGeneration = topicGenerationRef.current;
    invalidateJobRequests();
    setTidyAction("dismiss");
    setError("");
    try {
      await api.notes.dismissTidy(currentJob.id);
      if (topicGenerationRef.current !== topicGeneration) return;
      setJob(null);
      setFeedback("정리 초안을 폐기했습니다");
    } catch (dismissError) {
      if (topicGenerationRef.current !== topicGeneration) return;
      setError(errorMessage(dismissError, "폐기에 실패했습니다"));
    } finally {
      if (topicGenerationRef.current === topicGeneration) {
        setTidyAction(null);
      }
    }
  }

  const pendingDraft = job?.status === "SUCCEEDED" && job.preview !== null;
  const hasContent = Boolean(note?.content.trim());

  return (
    <div
      className="note-sheet-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panelRef}
        aria-labelledby={titleId}
        aria-modal="true"
        className="surface note-sheet"
        role="dialog"
      >
        <header className="note-sheet-header">
          <div>
            <h2 id={titleId} className="section-title">
              <span aria-hidden="true">📝 </span>
              주제 노트
            </h2>
            <p className="muted mt-1 text-xs">현재 문제의 주제에 저장됩니다.</p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="btn btn-secondary text-sm"
          >
            닫기
          </button>
        </header>

        <div className="note-sheet-content">
          {error && (
            <p role="alert" className="text-sm text-[color:var(--danger)]">
              {error}
            </p>
          )}
          {pollError && (
            <p role="alert" className="text-sm text-[color:var(--danger)]">
              {pollError}
            </p>
          )}
          {feedback && (
            <p role="status" className="text-sm text-[color:var(--success)]">
              {feedback}
            </p>
          )}

          {!note && !error && (
            <p role="status" className="muted text-sm">
              불러오는 중...
            </p>
          )}

          {note && !pendingDraft && mode === "view" && (
            <>
              <Markdown content={note.content} />
              <div className="flex flex-wrap items-end gap-2 border-t border-[color:var(--border)] pt-3">
                <button
                  type="button"
                  onClick={startEdit}
                  className="btn btn-secondary text-sm"
                >
                  <span aria-hidden="true">✏️ </span>
                  편집
                </button>
                {job?.status === "RUNNING" ? (
                  <span role="status" className="chip min-h-[2.45rem]">
                    🤖 AI 정리 중...
                  </span>
                ) : (
                  <>
                    <label className="grid gap-1 text-xs font-semibold">
                      정리 엔진
                      <select
                        aria-label="정리 엔진"
                        value={engine}
                        onChange={(event) =>
                          setEngine(event.target.value as GenerationEngineDto)
                        }
                        className="field min-w-36 py-2 text-sm"
                      >
                        {ENGINES.map((name) => (
                          <option key={name} value={name}>
                            {name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      onClick={() => void startTidy()}
                      disabled={!hasContent || tidyStarting}
                      className="btn btn-secondary text-sm"
                    >
                      {tidyStarting ? (
                        "AI 정리 요청 중..."
                      ) : (
                        <>
                          <span aria-hidden="true">🤖 </span>
                          AI 정리
                        </>
                      )}
                    </button>
                  </>
                )}
                {job?.status === "FAILED" && (
                  <p
                    role="alert"
                    className="w-full text-sm text-[color:var(--danger)]"
                  >
                    정리 실패 ❌ {job.errorMessage}
                  </p>
                )}
              </div>
            </>
          )}

          {note && !pendingDraft && mode === "edit" && (
            <>
              <label htmlFor="note-content" className="text-sm font-semibold">
                노트 내용
              </label>
              <textarea
                id="note-content"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                disabled={saving}
                rows={14}
                className="textarea min-h-64 font-mono text-sm"
                placeholder="# 핵심 개념\n\n- 기억할 내용을 적어 보세요"
              />
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="btn btn-primary text-sm"
                >
                  {saving ? "저장 중..." : "저장"}
                </button>
                <button
                  type="button"
                  onClick={() => setMode("view")}
                  disabled={saving}
                  className="btn btn-secondary text-sm"
                >
                  취소
                </button>
              </div>
            </>
          )}

          {note && pendingDraft && job && (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span role="status" aria-live="polite" className="chip">
                  🤖 정리 초안 도착
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setComparing((current) =>
                      current === "draft" ? "current" : "draft",
                    )
                  }
                  className="btn btn-secondary text-sm"
                >
                  {comparing === "draft"
                    ? "현재 노트 보기"
                    : "정리 초안 보기"}
                </button>
              </div>
              <div className="rounded-[10px] border border-[color:var(--border)] bg-[color:var(--bg-soft)] p-3">
                <Markdown
                  content={
                    comparing === "draft" ? (job.preview ?? "") : note.content
                  }
                />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void applyTidy()}
                  disabled={tidyAction !== null}
                  className="btn btn-primary text-sm"
                >
                  {tidyAction === "apply" ? "반영 중..." : "반영"}
                </button>
                <button
                  type="button"
                  onClick={() => void dismissTidy()}
                  disabled={tidyAction !== null}
                  className="btn btn-danger text-sm"
                >
                  {tidyAction === "dismiss" ? "폐기 중..." : "폐기"}
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
