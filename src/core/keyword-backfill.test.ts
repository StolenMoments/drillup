import { describe, expect, it } from "vitest";
import {
  chunkKeywordBackfillIds,
  engineForKeywordBackfillBatch,
  KEYWORD_BACKFILL_BATCH_SIZE,
  KEYWORD_BACKFILL_ENGINE_SCHEDULE,
} from "./keyword-backfill";

describe("키워드 백필 엔진 순환", () => {
  it("Claude:Codex:Antigravity를 1:1:3 비율로 배정한다", () => {
    const engines = Array.from({ length: 10 }, (_, index) =>
      engineForKeywordBackfillBatch(index),
    );

    expect(engines).toEqual([
      ...KEYWORD_BACKFILL_ENGINE_SCHEDULE,
      ...KEYWORD_BACKFILL_ENGINE_SCHEDULE,
    ]);
    expect(engines.filter((engine) => engine === "CLAUDE")).toHaveLength(2);
    expect(engines.filter((engine) => engine === "CODEX")).toHaveLength(2);
    expect(engines.filter((engine) => engine === "ANTIGRAVITY")).toHaveLength(6);
  });

  it("문제 id를 최대 5개씩 자른다", () => {
    expect(chunkKeywordBackfillIds([1, 2, 3, 4, 5, 6, 7])).toEqual([
      [1, 2, 3, 4, 5],
      [6, 7],
    ]);
    expect(KEYWORD_BACKFILL_BATCH_SIZE).toBe(5);
  });

  it("잘못된 배치 인덱스는 거부한다", () => {
    expect(() => engineForKeywordBackfillBatch(-1)).toThrow();
    expect(() => engineForKeywordBackfillBatch(0.5)).toThrow();
  });
});
