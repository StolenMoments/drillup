"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import HardeningJobList from "@/components/HardeningJobList";
import { useVisiblePolling } from "@/hooks/useVisiblePolling";
import { api } from "@/lib/api-client";
import type {
  ChoiceHardeningJobSummaryDto,
  ChoiceHardeningListStatusDto,
} from "@/lib/api-types";

const POLL_INTERVAL_MS = 5000;

const SECTIONS: Array<{
  status: ChoiceHardeningListStatusDto;
  title: string;
}> = [
  { status: "pending", title: "⏳ 승인 대기" },
  { status: "running", title: "🔄 진행 중" },
  { status: "failed", title: "❌ 실패" },
  { status: "applied", title: "📜 반영 이력" },
];

export default function HardeningReviewPage() {
  const [data, setData] = useState<ChoiceHardeningJobSummaryDto | null>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(() => api.hardenJobs.summary(), []);
  const handleSuccess = useCallback((value: ChoiceHardeningJobSummaryDto) => {
    setData(value);
    setMessage("");
  }, []);
  const handleError = useCallback((error: unknown) => {
    setMessage(error instanceof Error ? error.message : "목록을 불러오지 못했습니다");
  }, []);
  const refresh = useVisiblePolling({
    load,
    onSuccess: handleSuccess,
    onError: handleError,
    intervalMs: POLL_INTERVAL_MS,
  });

  return (
    <div className="app-page space-y-6">
      <div className="page-header">
        <div>
          <h1 className="page-title">선지 검토</h1>
          <p className="page-subtitle">
            선지 강화 결과를 승인하고 진행 상황을 확인합니다. 검증 의견이 없는
            결과는 자동 반영됩니다.
          </p>
        </div>
      </div>

      {message && (
        <p className="text-sm text-[color:var(--danger)]" role="alert">
          ❌ {message}
        </p>
      )}
      {data === null && !message && <p className="muted text-sm">불러오는 중...</p>}

      {data &&
        SECTIONS.map(({ status, title }) => {
          const group = data[status];
          const hasMore = group.totalItems > group.items.length;
          return (
            <section key={status} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="section-title">{title} · {group.totalItems}건</h2>
                {hasMore && (
                  <Link
                    href={`/hardening/${status}`}
                    className="text-sm font-semibold text-[color:var(--brand)]"
                  >
                    전체 {group.totalItems}건 보기
                  </Link>
                )}
              </div>
              <HardeningJobList
                status={status}
                items={group.items}
                onChanged={() => void refresh()}
              />
            </section>
          );
        })}
    </div>
  );
}
