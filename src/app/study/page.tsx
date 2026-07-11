"use client";

import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import ClozeCard from "@/components/ClozeCard";
import McqCard from "@/components/McqCard";
import ResultPanel from "@/components/ResultPanel";
import { api } from "@/lib/api-client";
import type {
  ReviewAnswerDto,
  ReviewResultDto,
  StudyQuestionDto,
} from "@/lib/api-types";

function completionMessage(mode: "srs" | "practice"): string {
  if (mode === "srs") return "오늘 복습할 문제를 모두 끝냈습니다 🎉";
  return "풀 문제가 없습니다.";
}

function modeLabel(mode: "srs" | "practice"): string {
  if (mode === "srs") return "오늘의 복습";
  return "자유 연습";
}

function StudySession({
  mode,
  topicId,
  keywordId,
}: {
  mode: "srs" | "practice";
  topicId?: number;
  keywordId?: number;
}) {
  const [queue, setQueue] = useState<StudyQuestionDto[] | null>(null);
  const [index, setIndex] = useState(0);
  const [result, setResult] = useState<ReviewResultDto | null>(null);
  const [error, setError] = useState("");
  const [keywordName, setKeywordName] = useState<string | null>(null);

  useEffect(() => {
    let ignore = false;

    api.study
      .queue(mode, topicId, keywordId)
      .then((questions) => {
        if (!ignore) setQueue(questions);
      })
      .catch((err: unknown) => {
        if (!ignore) {
          setError(
            err instanceof Error ? err.message : "문제를 불러오지 못했습니다",
          );
        }
      });

    return () => {
      ignore = true;
    };
  }, [mode, topicId, keywordId]);

  useEffect(() => {
    if (!keywordId) return;

    let ignore = false;
    api.keywords
      .list()
      .then((data) => {
        if (ignore) return;
        const match = data.keywords.find((keyword) => keyword.id === keywordId);
        setKeywordName(match?.name ?? null);
      })
      .catch(() => {
        // 라벨 표시용 조회 실패는 무시한다.
      });

    return () => {
      ignore = true;
    };
  }, [keywordId]);

  const current = queue?.[index];

  async function submitAnswer(answer: ReviewAnswerDto) {
    if (!current) return;
    try {
      const reviewResult = await api.study.submitReview({
        questionId: current.id,
        mode: mode === "srs" ? "SRS" : "PRACTICE",
        answer,
      });
      setResult(reviewResult);
      if (mode === "srs" && !reviewResult.isCorrect) {
        setQueue((q) => (q ? [...q, current] : q));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "채점 요청에 실패했습니다");
    }
  }

  function next() {
    setResult(null);
    setIndex((currentIndex) => currentIndex + 1);
  }

  async function removeCurrentQuestion() {
    if (!current) return;
    if (!window.confirm("이 문제를 영구 삭제할까요? 되돌릴 수 없습니다.")) return;
    try {
      await api.questions.remove(current.id);
      setQueue((q) => (q ? q.filter((item) => item.id !== current.id) : q));
      setResult(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "문제 삭제에 실패했습니다");
    }
  }

  if (error) return <p className="text-[color:var(--danger)]">{error}</p>;
  if (!queue) return <p className="muted">불러오는 중...</p>;

  if (!current) {
    return (
      <div className="surface surface-pad mx-auto max-w-lg space-y-4 text-center">
        <p className="text-xl font-bold">{completionMessage(mode)}</p>
        {mode === "srs" && (
          <Link
            href={`/study?mode=practice${topicId ? `&topicId=${topicId}` : ""}`}
            className="btn btn-secondary"
          >
            자유 연습하기
          </Link>
        )}
        <Link href="/" className="block text-[color:var(--brand)]">
          대시보드로
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="surface surface-pad flex items-center justify-between gap-3 text-sm">
        <span className="font-semibold">
          {modeLabel(mode)}
          {keywordName && (
            <span className="chip ml-2">🏷️ {keywordName}</span>
          )}
        </span>
        <div className="flex items-center gap-3">
          <span className="chip">
            {index + 1} / {queue.length}
          </span>
          <button
            onClick={removeCurrentQuestion}
            className="btn btn-danger text-sm"
          >
            🗑️ 문제 삭제
          </button>
        </div>
      </div>
      {current.type === "MCQ" ? (
        <McqCard
          key={`${current.id}-${index}`}
          question={current}
          disabled={result !== null}
          onSubmit={(selectedIndices) =>
            submitAnswer({ type: "MCQ", selected_indices: selectedIndices })
          }
        />
      ) : (
        <ClozeCard
          key={`${current.id}-${index}`}
          question={current}
          disabled={result !== null}
          onSubmit={(filled) => submitAnswer({ type: "CLOZE", filled })}
        />
      )}
      {result && (
        <ResultPanel
          question={current}
          result={result}
          onNext={next}
          isLast={index + 1 >= queue.length}
        />
      )}
    </div>
  );
}

function StudyContent() {
  const params = useSearchParams();
  const mode: "srs" | "practice" =
    params.get("mode") === "practice" ? "practice" : "srs";
  const topicIdRaw = params.get("topicId");
  const topicId = topicIdRaw ? Number(topicIdRaw) : undefined;
  const keywordIdRaw = params.get("keywordId");
  const keywordId = keywordIdRaw ? Number(keywordIdRaw) : undefined;

  return (
    <StudySession
      key={`${mode}-${topicId ?? "all"}-${keywordId ?? "all"}`}
      mode={mode}
      topicId={topicId}
      keywordId={keywordId}
    />
  );
}

export default function StudyPage() {
  return (
    <div className="app-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">학습</h1>
          <p className="page-subtitle">
            오늘 복습과 자유 연습을 같은 흐름으로 풀고 즉시 피드백을 확인합니다.
          </p>
        </div>
      </div>
      <Suspense fallback={<p className="muted">불러오는 중...</p>}>
        <StudyContent />
      </Suspense>
    </div>
  );
}
