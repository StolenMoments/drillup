"use client";

import { useState } from "react";
import type {
  ChoiceHardeningJobListItemDto,
  ChoiceHardeningListStatusDto,
} from "@/lib/api-types";
import { api } from "@/lib/api-client";
import { engineLabel } from "@/lib/engine-label";
import HardeningPendingCard from "./HardeningPendingCard";

interface Props {
  status: ChoiceHardeningListStatusDto;
  items: ChoiceHardeningJobListItemDto[];
  onChanged: () => void;
}

const EMPTY_MESSAGES: Record<ChoiceHardeningListStatusDto, string> = {
  pending: "승인이 필요한 항목이 없습니다 🎉",
  running: "진행 중인 작업이 없습니다.",
  failed: "실패한 작업이 없습니다.",
  applied: "반영된 항목이 없습니다.",
};

function jobLine(item: ChoiceHardeningJobListItemDto): string {
  return `#${item.id} · ${item.topicName} · ${engineLabel(item.engine)}`;
}

function RunningItem({ item }: { item: ChoiceHardeningJobListItemDto }) {
  return (
    <div className="surface surface-pad text-sm">
      <p className="font-medium">{item.questionPreview}</p>
      <p className="subtle mt-1 text-xs">
        {jobLine(item)} · 시작{" "}
        {new Date(item.startedAt ?? item.createdAt).toLocaleString()}
      </p>
    </div>
  );
}

function FailedItem({
  item,
  onChanged,
}: {
  item: ChoiceHardeningJobListItemDto;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function run(action: () => Promise<unknown>, fallback: string) {
    setBusy(true);
    setMessage("");
    try {
      await action();
      onChanged();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="surface surface-pad space-y-2 text-sm">
      <p className="font-medium">{item.questionPreview}</p>
      <p className="break-all text-[color:var(--danger)]">
        {item.errorMessage ?? "알 수 없는 오류"}
      </p>
      <p className="subtle text-xs">{jobLine(item)}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() =>
            void run(
              () =>
                api.questions.hardenChoices(
                  item.questionId,
                  item.engine,
                  true,
                ),
              "재시도 실패",
            )
          }
          disabled={busy}
          className="btn btn-secondary text-sm"
        >
          🔁 재시도
        </button>
        <button
          type="button"
          onClick={() =>
            void run(
              () => api.questions.dismissHardenChoices(item.questionId, item.id),
              "거절 실패",
            )
          }
          disabled={busy}
          className="btn btn-secondary text-sm"
        >
          🗑 거절
        </button>
      </div>
      {message && <p className="text-[color:var(--danger)]">❌ {message}</p>}
    </div>
  );
}

function AppliedItem({ item }: { item: ChoiceHardeningJobListItemDto }) {
  return (
    <div className="surface surface-pad text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="chip">{item.autoApplied ? "자동 반영" : "수동 반영"}</span>
        <p className="min-w-0 flex-1 font-medium">{item.questionPreview}</p>
      </div>
      <p className="subtle mt-1 text-xs">
        {jobLine(item)} · 반영{" "}
        {item.appliedAt ? new Date(item.appliedAt).toLocaleString() : "-"}
      </p>
    </div>
  );
}

export default function HardeningJobList({ status, items, onChanged }: Props) {
  if (items.length === 0) {
    return <p className="muted text-sm">{EMPTY_MESSAGES[status]}</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => {
        if (status === "pending") {
          return (
            <HardeningPendingCard
              key={item.id}
              item={item}
              onChanged={onChanged}
            />
          );
        }
        if (status === "running") return <RunningItem key={item.id} item={item} />;
        if (status === "failed") {
          return <FailedItem key={item.id} item={item} onChanged={onChanged} />;
        }
        return <AppliedItem key={item.id} item={item} />;
      })}
    </div>
  );
}
