import type {
  GenerationItemDto,
  GenerationJobDto,
} from "./api-types";

type SuccessfulGenerationItem = Extract<GenerationItemDto, { ok: true }>;

export function isQuestionItemSaveable(item: GenerationItemDto): boolean {
  return (
    item.ok &&
    (item.verdict !== "fail" || Boolean(item.revision?.appliedQuestion))
  );
}

export function selectValidItemIndices(job: GenerationJobDto): Set<number> {
  if (job.status !== "SUCCEEDED") return new Set<number>();
  if (job.kind === "KEYWORD_TAG") {
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
      if (item.revision?.status === "RUNNING") counts.running += 1;
      if (item.revision?.appliedQuestion) counts.applied += 1;
      return counts;
    },
    { applied: 0, running: 0 },
  );
}

export function hasAppliedRevision(
  item: SuccessfulGenerationItem,
): boolean {
  return Boolean(item.revision?.appliedQuestion);
}

export function getSavedFlashMessage(value: string | null): string | null {
  if (!value || !/^\d+$/.test(value)) return null;
  return `✅ ${value}개 항목을 저장했습니다.`;
}
