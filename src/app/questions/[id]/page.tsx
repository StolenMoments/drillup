"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api-client";

export default function QuestionEditPage() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const router = useRouter();

  const [payloadText, setPayloadText] = useState("");
  const [explanation, setExplanation] = useState("");
  const [type, setType] = useState<"MCQ" | "CLOZE" | null>(null);
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api.questions
      .get(id)
      .then((question) => {
        setPayloadText(JSON.stringify(question.payload, null, 2));
        setExplanation(question.explanation ?? "");
        setType(question.type);
        setLoaded(true);
      })
      .catch((error: unknown) =>
        setMessage(
          error instanceof Error
            ? error.message
            : "문제를 불러오지 못했습니다",
        ),
      );
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
      </div>
    </div>
  );
}
