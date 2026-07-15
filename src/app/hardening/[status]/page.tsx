import { notFound } from "next/navigation";
import {
  CHOICE_HARDENING_LIST_STATUSES,
  isChoiceHardeningListStatus,
} from "@/lib/choice-hardening-status";
import HardeningStatusPage from "./HardeningStatusPage";

export function generateStaticParams() {
  return CHOICE_HARDENING_LIST_STATUSES.map((status) => ({ status }));
}

function parsePage(raw: string | string[] | undefined): number {
  const value = Array.isArray(raw) ? raw[0] : raw;
  const page = Number(value);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ status: string }>;
  searchParams: Promise<{ page?: string | string[] }>;
}) {
  const [{ status }, query] = await Promise.all([params, searchParams]);
  if (!isChoiceHardeningListStatus(status)) notFound();

  return (
    <HardeningStatusPage
      status={status}
      initialPage={parsePage(query.page)}
    />
  );
}
