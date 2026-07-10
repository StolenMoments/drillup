import type { EngineName } from "./engine-command";

export const KEYWORD_BACKFILL_BATCH_SIZE = 5;

// 호출 순서를 분산하면서 Claude:Codex:Antigravity 비율을 1:1:3으로 유지한다.
export const KEYWORD_BACKFILL_ENGINE_SCHEDULE = [
  "ANTIGRAVITY",
  "CLAUDE",
  "ANTIGRAVITY",
  "CODEX",
  "ANTIGRAVITY",
] as const satisfies readonly EngineName[];

export function engineForKeywordBackfillBatch(batchIndex: number): EngineName {
  if (!Number.isInteger(batchIndex) || batchIndex < 0) {
    throw new Error("batchIndex는 0 이상의 정수여야 합니다");
  }
  return KEYWORD_BACKFILL_ENGINE_SCHEDULE[
    batchIndex % KEYWORD_BACKFILL_ENGINE_SCHEDULE.length
  ];
}

export function chunkKeywordBackfillIds(
  ids: number[],
): number[][] {
  const chunks: number[][] = [];
  for (let index = 0; index < ids.length; index += KEYWORD_BACKFILL_BATCH_SIZE) {
    chunks.push(ids.slice(index, index + KEYWORD_BACKFILL_BATCH_SIZE));
  }
  return chunks;
}
