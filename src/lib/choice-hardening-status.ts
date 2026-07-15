import type { ChoiceHardeningListStatusDto } from "./api-types";

export const CHOICE_HARDENING_LIST_STATUSES = [
  "pending",
  "running",
  "failed",
  "applied",
] as const satisfies readonly ChoiceHardeningListStatusDto[];

export function isChoiceHardeningListStatus(
  value: string,
): value is ChoiceHardeningListStatusDto {
  return CHOICE_HARDENING_LIST_STATUSES.some((status) => status === value);
}
