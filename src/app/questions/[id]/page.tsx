"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import ClozeCard from "@/components/ClozeCard";
import McqCard from "@/components/McqCard";
import ResultPanel from "@/components/ResultPanel";
import { api } from "@/lib/api-client";
import type {
  ReviewAnswerDto,
  ReviewResultDto,
  StudyQuestionDto,
} from "@/lib/api-types";

export default function QuestionPracticePage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();
  const [question, setQuestion] = useState<StudyQuestionDto | null>(null);
  const [result, setResult] = useState<ReviewResultDto | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;

    api.study
      .getQuestion(id)
      .then((loadedQuestion) => {
        if (!ignore) setQuestion(loadedQuestion);
      })
      .catch((loadError: unknown) => {
        if (!ignore) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "문제를 불러오지 못했습니다",
          );
        }
      });

    return () => {
      ignore = true;
    };
  }, [id]);

  async function submitAnswer(answer: ReviewAnswerDto) {
    if (!question) return;

    try {
      setResult(
        await api.study.submitReview({
          questionId: question.id,
          mode: "PRACTICE",
          answer,
        }),
      );
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "채점 요청에 실패했습니다",
      );
    }
  }

  if (error) return <p className="text-[color:var(--danger)]">{error}</p>;
  if (!question) return <p className="muted">불러오는 중...</p>;

  return (
    <div className="app-page mx-auto max-w-3xl">
      <div className="page-header">
        <div>
          <h1 className="page-title">문제 풀기 #{question.id}</h1>
          <p className="page-subtitle">
            <span className="chip mr-2">
              {question.type === "MCQ" ? "객관식" : "빈칸"}
            </span>
            자유 연습으로 기록되며 복습 일정은 변경되지 않습니다.
          </p>
        </div>
        <Link href={`/questions/${question.id}/edit`} className="btn btn-secondary">
          수정
        </Link>
      </div>

      {question.type === "MCQ" ? (
        <McqCard
          key={question.id}
          question={question}
          disabled={result !== null}
          onSubmit={(selectedIndices) =>
            submitAnswer({ type: "MCQ", selected_indices: selectedIndices })
          }
        />
      ) : (
        <ClozeCard
          key={question.id}
          question={question}
          disabled={result !== null}
          onSubmit={(filled) => submitAnswer({ type: "CLOZE", filled })}
        />
      )}

      {result && (
        <ResultPanel
          question={question}
          result={result}
          onNext={() => router.push("/questions")}
          isLast
          nextLabel="문제 목록으로"
        />
      )}
    </div>
  );
}
