import type {
  GenerationItemDto,
  GenerationJobDto,
} from "./api-types";

type SuccessfulGenerationItem = Extract<GenerationItemDto, { ok: true }>;

export function isQuestionItemSaveable(item: GenerationItemDto): boolean {
  return (
    item.ok &&
    (item.verdict !== "fail" || Boolean(item.selectedRevision?.proposedQuestion))
  );
}

export function selectValidItemIndices(job: GenerationJobDto): Set<number> {
  if (job.status !== "SUCCEEDED") return new Set<number>();
  if (job.type === "KEYWORD_TAGGING") {
    return new Set((job.keywordItems ?? []).map((item) => item.id));
  }
  return new Set(
    (job.items ?? [])
      .filter(isQuestionItemSaveable)
      .map((item) => item.index),
  );
}

export function getRevisionCounts(items: GenerationItemDto[] | null): {
  applied: number;
  running: number;
} {
  return (items ?? []).reduce(
    (counts, item) => {
      if (!item.ok) return counts;
      if (
        item.revision?.status === "PENDING" ||
        item.revision?.status === "RUNNING"
      ) counts.running += 1;
      if (item.selectedRevision?.proposedQuestion) counts.applied += 1;
      return counts;
    },
    { applied: 0, running: 0 },
  );
}

export function hasAppliedRevision(
  item: SuccessfulGenerationItem,
): boolean {
  return Boolean(item.selectedRevision?.proposedQuestion);
}

export function getSavedFlashMessage(value: string | null): string | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return `✅ ${value}개 항목을 저장했습니다.`;
}
