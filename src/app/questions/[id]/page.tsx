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
    return <p className="text-slate-400">{message || "불러오는 중..."}</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">
        문제 수정 #{id}{" "}
        <span className="rounded bg-slate-800 px-1.5 py-0.5 text-sm font-normal">
          {type === "MCQ" ? "객관식" : "빈칸"}
        </span>
      </h1>
      <div className="space-y-1">
        <label className="text-sm text-slate-400">payload (JSON)</label>
        <textarea
          value={payloadText}
          onChange={(event) => setPayloadText(event.target.value)}
          rows={14}
          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2 font-mono text-sm"
        />
      </div>
      <div className="space-y-1">
        <label className="text-sm text-slate-400">해설</label>
        <textarea
          value={explanation}
          onChange={(event) => setExplanation(event.target.value)}
          rows={4}
          className="w-full rounded border border-slate-700 bg-slate-900 px-3 py-2"
        />
      </div>
      {message && <p className="text-sm text-red-300">{message}</p>}
      <div className="flex gap-2">
        <button
          onClick={save}
          className="rounded bg-sky-600 px-4 py-2 font-semibold"
        >
          저장
        </button>
        <button
          onClick={() => router.push("/questions")}
          className="rounded bg-slate-700 px-4 py-2"
        >
          취소
        </button>
      </div>
    </div>
  );
}
