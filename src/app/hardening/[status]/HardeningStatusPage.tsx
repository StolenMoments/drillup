"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useState } from "react";
import HardeningJobList from "@/components/HardeningJobList";
import { useVisiblePolling } from "@/hooks/useVisiblePolling";
import { api } from "@/lib/api-client";
import type {
  ChoiceHardeningJobPageDto,
  ChoiceHardeningListStatusDto,
} from "@/lib/api-types";

const POLL_INTERVAL_MS = 5000;
const STATUS_TITLES: Record<ChoiceHardeningListStatusDto, string> = {
  pending: "승인 대기",
  running: "진행 중",
  failed: "실패",
  applied: "반영 이력",
};

interface Props {
  status: ChoiceHardeningListStatusDto;
  initialPage: number;
}

function pageUrl(status: ChoiceHardeningListStatusDto, page: number): string {
  return `/hardening/${status}?page=${page}`;
}

function visibleRange(data: ChoiceHardeningJobPageDto): string {
  if (data.totalItems === 0) return "0건";
  const first = (data.page - 1) * data.pageSize + 1;
  const last = Math.min(data.page * data.pageSize, data.totalItems);
  return `${first}-${last} / ${data.totalItems}건`;
}

export default function HardeningStatusPage({ status, initialPage }: Props) {
  const router = useRouter();
  const [data, setData] = useState<ChoiceHardeningJobPageDto | null>(null);
  const [message, setMessage] = useState("");
  const load = useCallback(
    () => api.hardenJobs.page(status, initialPage),
    [initialPage, status],
  );
  const handleSuccess = useCallback(
    (value: ChoiceHardeningJobPageDto) => {
      setData(value);
      setMessage("");
      if (value.page !== initialPage) {
        router.replace(pageUrl(status, value.page), { scroll: false });
      }
    },
    [initialPage, router, status],
  );
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
    <div className="app-page">
      <div className="page-header">
        <div>
          <Link
            href="/hardening"
            className="text-sm font-semibold text-[color:var(--brand)]"
          >
            ← 선지 검토
          </Link>
          <h1 className="page-title mt-2">
            {STATUS_TITLES[status]} · {data?.totalItems ?? 0}건
          </h1>
          <p className="page-subtitle">상태별 선지 강화 작업을 최신순으로 확인합니다.</p>
        </div>
      </div>

      {message && (
        <p role="alert" className="text-sm text-[color:var(--danger)]">
          ❌ {message}
        </p>
      )}
      {data === null && !message && <p className="muted text-sm">불러오는 중...</p>}
      {data && (
        <>
          <HardeningJobList
            status={status}
            items={data.items}
            onChanged={() => void refresh()}
          />
          <nav className="pagination-bar" aria-label="선지 검토 페이지">
            {data.page > 1 ? (
              <Link
                href={pageUrl(status, data.page - 1)}
                className="btn btn-secondary min-h-9 px-3 text-sm"
              >
                이전
              </Link>
            ) : (
              <span
                className="btn btn-secondary min-h-9 px-3 text-sm opacity-50"
                aria-disabled="true"
              >
                이전
              </span>
            )}
            <span className="pagination-summary">
              {data.page} / {data.totalPages} 페이지
            </span>
            <span className="pagination-summary">{visibleRange(data)}</span>
            {data.page < data.totalPages ? (
              <Link
                href={pageUrl(status, data.page + 1)}
                className="btn btn-secondary min-h-9 px-3 text-sm"
              >
                다음
              </Link>
            ) : (
              <span
                className="btn btn-secondary min-h-9 px-3 text-sm opacity-50"
                aria-disabled="true"
              >
                다음
              </span>
            )}
          </nav>
        </>
      )}
    </div>
  );
}
