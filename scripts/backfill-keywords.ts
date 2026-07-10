import "dotenv/config";
import { parseArgs } from "node:util";
import type { GenerationEngine } from "@prisma/client";
import {
  chunkKeywordBackfillIds,
  engineForKeywordBackfillBatch,
  KEYWORD_BACKFILL_BATCH_SIZE,
} from "@/core/keyword-backfill";
import { prisma } from "@/server/db";
import { backfillKeywordBatch } from "@/server/keyword-backfill-service";

const CODEX_MODEL = "gpt-5.6-terra";
const DEFAULT_RETRIES = 2;

interface Options {
  topicId?: number;
  limit?: number;
  retries: number;
  delayMs: number;
  dryRun: boolean;
}

interface Stats {
  planned: number;
  tagged: number;
  skipped: number;
  failed: Map<number, string>;
}

function usage(): string {
  return `키워드 없는 문제를 AI로 일괄 태깅합니다.

사용법:
  npm run keywords:backfill -- [옵션]

옵션:
  --topic-id <id>  특정 주제만 처리
  --limit <count>  이번 실행에서 처리할 최대 문제 수
  --retries <n>    누락/실패 배치의 재시도 횟수 (기본 ${DEFAULT_RETRIES})
  --delay-ms <n>   AI 호출 사이 대기 시간(밀리초, 기본 0)
  --dry-run        AI 호출만 하고 키워드를 저장하지 않음
  --help           이 도움말 표시

문제는 주제별로 최대 ${KEYWORD_BACKFILL_BATCH_SIZE}개씩 처리하며,
Claude:Codex:Antigravity 호출 비율은 1:1:3입니다.
Codex 호출은 ${CODEX_MODEL} 모델을 사용합니다.`;
}

function positiveInteger(raw: string, optionName: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${optionName}은 0보다 큰 정수여야 합니다`);
  }
  return value;
}

function nonNegativeInteger(raw: string, optionName: string): number {
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${optionName}은 0 이상의 정수여야 합니다`);
  }
  return value;
}

function readOptions(): Options | null {
  const { values } = parseArgs({
    options: {
      "topic-id": { type: "string" },
      limit: { type: "string" },
      retries: { type: "string" },
      "delay-ms": { type: "string" },
      "dry-run": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    strict: true,
  });
  if (values.help) return null;

  return {
    topicId: values["topic-id"]
      ? positiveInteger(values["topic-id"], "--topic-id")
      : undefined,
    limit: values.limit ? positiveInteger(values.limit, "--limit") : undefined,
    retries: values.retries
      ? nonNegativeInteger(values.retries, "--retries")
      : DEFAULT_RETRIES,
    delayMs: values["delay-ms"]
      ? nonNegativeInteger(values["delay-ms"], "--delay-ms")
      : 0,
    dryRun: values["dry-run"],
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadUntagedQuestionIds(options: Options): Promise<
  Array<{ topicId: number; ids: number[] }>
> {
  const questions = await prisma.question.findMany({
    where: {
      ...(options.topicId ? { topicId: options.topicId } : {}),
      keywords: { none: {} },
    },
    orderBy: [{ topicId: "asc" }, { id: "asc" }],
    select: { id: true, topicId: true },
    ...(options.limit ? { take: options.limit } : {}),
  });

  const byTopic = new Map<number, number[]>();
  for (const question of questions) {
    const ids = byTopic.get(question.topicId) ?? [];
    ids.push(question.id);
    byTopic.set(question.topicId, ids);
  }
  return [...byTopic].map(([topicId, ids]) => ({ topicId, ids }));
}

async function processBatch(
  questionIds: number[],
  engine: GenerationEngine,
  options: Options,
  stats: Stats,
): Promise<void> {
  let pendingIds = questionIds;
  let attempt = 0;

  while (pendingIds.length > 0 && attempt <= options.retries) {
    attempt += 1;
    const label = `[${engine}] ${pendingIds.join(", ")} (시도 ${attempt}/${options.retries + 1})`;
    try {
      const result = await backfillKeywordBatch({
        questionIds: pendingIds,
        engine,
        codexModel: engine === "CODEX" ? CODEX_MODEL : undefined,
        dryRun: options.dryRun,
      });
      stats.tagged += result.taggedQuestionIds.length;
      stats.skipped += result.skippedQuestionIds.length;
      for (const id of result.skippedQuestionIds) {
        console.warn(`${label}: 문제 ${id}는 요약을 만들 수 없어 건너뛰었습니다`);
      }
      pendingIds = result.unresolvedQuestionIds;
      console.log(
        `${label}: ${result.taggedQuestionIds.length}개 ${options.dryRun ? "제안" : "저장"}, ${pendingIds.length}개 재시도 대상`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "알 수 없는 오류";
      console.error(`${label}: 실패 - ${message}`);
      if (attempt > options.retries) {
        for (const id of pendingIds) stats.failed.set(id, message);
      }
    }

    if (pendingIds.length > 0 && attempt <= options.retries && options.delayMs > 0) {
      await sleep(options.delayMs);
    }
  }

  if (pendingIds.length > 0) {
    for (const id of pendingIds) {
      if (!stats.failed.has(id)) {
        stats.failed.set(id, "AI 응답에 키워드가 포함되지 않았습니다");
      }
    }
  }
}

async function main(): Promise<void> {
  const options = readOptions();
  if (!options) {
    console.log(usage());
    return;
  }

  const topicGroups = await loadUntagedQuestionIds(options);
  const batches = topicGroups.flatMap(({ ids }) => chunkKeywordBackfillIds(ids));
  const planned = batches.reduce((total, batch) => total + batch.length, 0);
  if (planned === 0) {
    console.log("키워드가 없는 문제가 없습니다.");
    return;
  }

  const stats: Stats = { planned, tagged: 0, skipped: 0, failed: new Map() };
  console.log(
    `${planned}개 문제를 ${batches.length}개 배치로 처리합니다 (배치당 최대 ${KEYWORD_BACKFILL_BATCH_SIZE}개${options.dryRun ? ", dry-run" : ""}).`,
  );

  for (const [batchIndex, batch] of batches.entries()) {
    const engine = engineForKeywordBackfillBatch(batchIndex) as GenerationEngine;
    await processBatch(batch, engine, options, stats);
    if (batchIndex < batches.length - 1 && options.delayMs > 0) {
      await sleep(options.delayMs);
    }
  }

  const completed = stats.tagged + stats.skipped + stats.failed.size;
  console.log(
    `완료: ${stats.tagged}개 ${options.dryRun ? "제안" : "저장"}, ${stats.skipped}개 건너뜀, ${stats.failed.size}개 실패 (${completed}/${stats.planned}).`,
  );
  if (stats.failed.size > 0) {
    for (const [id, reason] of stats.failed) {
      console.error(`- 문제 ${id}: ${reason}`);
    }
    process.exitCode = 1;
  }
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
