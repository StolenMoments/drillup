import { randomUUID } from "node:crypto";
import path from "node:path";
import type { GenerationEngine } from "@prisma/client";
import { extractJsonObject } from "@/core/json-extract";
import { KEYWORD_BACKFILL_BATCH_SIZE } from "@/core/keyword-backfill";
import { parseKeywordTagJson } from "@/core/keyword-tag-schema";
import { buildCliKeywordTagPrompt } from "@/core/prompt-template";
import { summarizeQuestionPayload } from "@/core/question-summary";
import { prisma } from "./db";
import { ServiceError } from "./errors";
import { runEngine } from "./generation/run-engine";
import { attachKeywords } from "./keyword-service";

export interface KeywordBackfillBatchResult {
  processedQuestionIds: number[];
  taggedQuestionIds: number[];
  unresolvedQuestionIds: number[];
  skippedQuestionIds: number[];
}

export async function backfillKeywordBatch(input: {
  questionIds: number[];
  engine: GenerationEngine;
  dryRun?: boolean;
}): Promise<KeywordBackfillBatchResult> {
  const requestedIds = [...new Set(input.questionIds)];
  if (requestedIds.length === 0) {
    return {
      processedQuestionIds: [],
      taggedQuestionIds: [],
      unresolvedQuestionIds: [],
      skippedQuestionIds: [],
    };
  }
  if (requestedIds.length > KEYWORD_BACKFILL_BATCH_SIZE) {
    throw new ServiceError(
      "BATCH_TOO_LARGE",
      `키워드 백필 배치는 최대 ${KEYWORD_BACKFILL_BATCH_SIZE}개 문제만 처리할 수 있습니다`,
      400,
    );
  }

  const questions = await prisma.question.findMany({
    where: { id: { in: requestedIds }, keywords: { none: {} } },
    select: {
      id: true,
      topicId: true,
      type: true,
      payload: true,
      topic: { select: { name: true } },
    },
  });
  if (questions.length === 0) {
    return {
      processedQuestionIds: [],
      taggedQuestionIds: [],
      unresolvedQuestionIds: [],
      skippedQuestionIds: [],
    };
  }

  const topicId = questions[0]?.topicId;
  if (questions.some((question) => question.topicId !== topicId)) {
    throw new ServiceError(
      "MIXED_TOPICS",
      "키워드 백필 배치는 하나의 주제만 포함해야 합니다",
      400,
    );
  }

  const targets = questions
    .map((question) => ({
      id: question.id,
      summary: summarizeQuestionPayload(question.type, question.payload),
    }))
    .filter((target) => target.summary);
  const processedQuestionIds = targets.map((target) => target.id);
  const skippedQuestionIds = questions
    .map((question) => question.id)
    .filter((id) => !processedQuestionIds.includes(id));
  if (targets.length === 0) {
    return {
      processedQuestionIds,
      taggedQuestionIds: [],
      unresolvedQuestionIds: [],
      skippedQuestionIds,
    };
  }

  const existingKeywords = await prisma.keyword.findMany({
    where: { questions: { some: { question: { topicId } } } },
    orderBy: { questions: { _count: "desc" } },
    take: 50,
    select: { name: true },
  });
  const dir = path.resolve(
    "generation_output",
    "keyword-backfill",
    `${targets.map((target) => target.id).join("-")}-${input.engine.toLowerCase()}-${randomUUID()}`,
  );
  const prompt = buildCliKeywordTagPrompt(
    questions[0]?.topic.name ?? "",
    targets,
    existingKeywords.map((keyword) => keyword.name),
    path.join(dir, "result.json"),
  );
  const run = await runEngine(input.engine, prompt, dir);
  if (!run.ok) {
    throw new ServiceError("KEYWORD_BACKFILL_FAILED", run.failureReason, 502);
  }

  const parsed = parseKeywordTagJson(extractJsonObject(run.resultText));
  if (!parsed.ok) {
    throw new ServiceError(
      "KEYWORD_BACKFILL_PARSE_ERROR",
      `${parsed.fatal}; 원문 앞 300자: ${run.resultText.slice(0, 300)}`,
      502,
    );
  }

  const targetIds = new Set(processedQuestionIds);
  const assignments = new Map(
    parsed.assignments
      .filter((assignment) => targetIds.has(assignment.id))
      .map((assignment) => [assignment.id, assignment.keywords]),
  );
  const taggedQuestionIds = [...assignments.keys()];
  if (!input.dryRun && taggedQuestionIds.length > 0) {
    await prisma.$transaction(async (tx) => {
      for (const [questionId, keywords] of assignments) {
        await attachKeywords(tx, questionId, keywords);
      }
    });
  }

  return {
    processedQuestionIds,
    taggedQuestionIds,
    unresolvedQuestionIds: processedQuestionIds.filter((id) => !assignments.has(id)),
    skippedQuestionIds,
  };
}
