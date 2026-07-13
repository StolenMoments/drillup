import { rm } from "node:fs/promises";
import path from "node:path";
import { Prisma, type GenerationEngine, type GenerationItemRevision, type GenerationJob } from "@prisma/client";
import { parseImportJson, type ImportQuestion, validateGeneratedQuestions } from "@/core/import-schema";
import { attachTestedDistinctions, prepareGeneratedItems } from "@/core/generation-result";
import { extractJsonObject } from "@/core/json-extract";
import { shuffleMcqChoices } from "@/core/random";
import { parseKeywordTagJson } from "@/core/keyword-tag-schema";
import {
  buildCliGenerationFromBlueprintPrompt,
  buildCliKeywordTagPrompt,
  buildCliQuestionBlueprintPrompt,
  buildCliQuestionBlueprintRepairPrompt,
  buildCliRevisionPrompt,
  buildCliVerifyPrompt,
  type ExistingQuestions,
  type VariantSource,
} from "@/core/prompt-template";
import { capSummaries, summarizeQuestionPayload } from "@/core/question-summary";
import { mergeVerdicts, parseVerifyJson } from "@/core/verify-schema";
import { parseRevisionJson } from "@/core/revision-schema";
import { assessQuestionBlueprint, formatDifficultyViolations, type DifficultyAssessment } from "@/core/question-difficulty";
import { parseQuestionBlueprintJson, type QuestionBlueprint } from "@/core/question-blueprint";
import type { GenerationQuestionShape } from "@/core/generation-shape";
import type {
  GenerationEngineDto,
  GenerationItemDto,
  GenerationJobDto,
  GenerationJobKindDto,
  GenerationJobSummaryDto,
  GenerationItemRevisionDto,
  KeywordTagItemDto,
  ChoiceCountDto,
  CorrectAnswerCountDto,
} from "@/lib/api-types";
import { prisma } from "../db";
import { ServiceError } from "../errors";
import { importQuestions, type ImportQuestionInput } from "../import-service";
import { attachKeywords } from "../keyword-service";
import { requiredReferenceFiles, resolveReferenceFiles } from "./reference";
import { generationTimeoutMs, jobOutputDir } from "./run-engine";
import { completeTrackedRun, failTrackedRun, runTrackedEngine } from "./tracked-run";

const ORPHAN_GRACE_MS = 60_000;
// 게이트 실패로 잡 전체(설계표+수선 토큰)를 버리는 것보다 소규모 수선 재시도가 싸다.
const BLUEPRINT_REPAIR_ATTEMPTS = 2;
const EXISTING_QUESTION_LIMIT = 100;
const VARIANT_SOURCE_LIMIT = 10;
const EXISTING_KEYWORD_LIMIT = 50;
const KEYWORD_TAG_BATCH_LIMIT = 50;

function normalizeStringArray(value: Prisma.JsonValue | null): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function jobQuestionShape(job: Pick<GenerationJob, "correctAnswerCount" | "choiceCount">): GenerationQuestionShape | undefined {
  if (!job.correctAnswerCount || !job.choiceCount) return undefined;
  return {
    correctAnswerCount: job.correctAnswerCount as CorrectAnswerCountDto,
    choiceCount: job.choiceCount as ChoiceCountDto,
  };
}

function toRevisionDto(revision: GenerationItemRevision): GenerationItemRevisionDto {
  return {
    status: revision.status,
    engine: revision.engine,
    verdict: revision.verdict === "PASS" ? "pass" : revision.verdict === "FAIL" ? "fail" : null,
    comment: revision.comment,
    proposedQuestion: revision.proposedQuestion,
    appliedQuestion: revision.appliedQuestion,
    errorMessage: revision.errorMessage,
  };
}

function toDto(job: GenerationJob, revisions: GenerationItemRevision[] = []): GenerationJobDto {
  const revisionByIndex = new Map(revisions.map((revision) => [revision.itemIndex, revision]));
  const storedItems = job.kind === "QUESTION" && job.status === "SUCCEEDED"
    ? (job.result as unknown as Array<Exclude<GenerationItemDto, { index: number; ok: false; errors: string[] }>> | null)
    : null;
  return {
    id: job.id,
    topicId: job.topicId,
    engine: job.engine,
    verifyEngine: job.verifyEngine,
    instructions: typeof job.instructions === "string" ? job.instructions : "",
    referenceFiles: normalizeStringArray(job.referenceFiles),
    correctAnswerCount: job.correctAnswerCount as CorrectAnswerCountDto | null,
    choiceCount: job.choiceCount as ChoiceCountDto | null,
    status: job.status,
    kind: job.kind as GenerationJobKindDto,
    items: storedItems?.map((item) => ({
      ...item,
      revision: revisionByIndex.has(item.index)
        ? toRevisionDto(revisionByIndex.get(item.index) as GenerationItemRevision)
        : null,
    })) ?? null,
    keywordItems:
      job.kind === "KEYWORD_TAG" && job.status === "SUCCEEDED"
        ? (job.result as unknown as KeywordTagItemDto[])
        : null,
    errorMessage: job.errorMessage,
    verifyWarning: job.verifyWarning,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
    approvedAt: job.approvedAt?.toISOString() ?? null,
    savedCount: job.savedCount,
    sourceQuestionIds: (job.sourceQuestionIds as unknown as number[] | null) ?? null,
  };
}

function toSummaryDto(
  job: GenerationJob & { topic: { name: string } },
): GenerationJobSummaryDto {
  return {
    id: job.id,
    topicId: job.topicId,
    topicName: job.topic.name,
    engine: job.engine,
    verifyEngine: job.verifyEngine,
    correctAnswerCount: job.correctAnswerCount as CorrectAnswerCountDto | null,
    choiceCount: job.choiceCount as ChoiceCountDto | null,
    status: job.status,
    kind: job.kind as GenerationJobKindDto,
    itemCount:
      job.status === "SUCCEEDED" && Array.isArray(job.result)
        ? (job.result as unknown[]).length
        : null,
    savedCount: job.savedCount,
    approvedAt: job.approvedAt?.toISOString() ?? null,
    errorMessage: job.errorMessage,
    createdAt: job.createdAt.toISOString(),
    finishedAt: job.finishedAt?.toISOString() ?? null,
  };
}

async function loadExistingQuestions(
  topicId: number,
): Promise<ExistingQuestions> {
  // 구세대 문제(testedDistinction null)는 중복 방지 목록에서 제외한다.
  const where = { topicId, testedDistinction: { not: null } };
  const [total, questions] = await Promise.all([
    prisma.question.count({ where }),
    prisma.question.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: EXISTING_QUESTION_LIMIT,
      select: { testedDistinction: true },
    }),
  ]);
  const capped = capSummaries([
    ...new Set(questions.map((question) => question.testedDistinction ?? "")),
  ]);
  return {
    distinctions: capped.kept,
    truncated: capped.truncated || total > EXISTING_QUESTION_LIMIT,
  };
}

async function loadExistingKeywords(topicId: number): Promise<string[]> {
  const keywords = await prisma.keyword.findMany({
    where: { questions: { some: { question: { topicId } } } },
    orderBy: { questions: { _count: "desc" } },
    take: EXISTING_KEYWORD_LIMIT,
    select: { name: true },
  });
  return keywords.map((keyword) => keyword.name);
}

export async function createJob(input: {
  topicId: number;
  engine: GenerationEngineDto;
  verifyEngine: GenerationEngineDto;
  instructions: string;
  correctAnswerCount: CorrectAnswerCountDto;
  choiceCount: ChoiceCountDto;
  referenceFiles: string[];
  sourceQuestionIds?: number[];
}): Promise<GenerationJobDto> {
  const topic = await prisma.topic.findUnique({ where: { id: input.topicId } });
  if (!topic) {
    throw new ServiceError("TOPIC_NOT_FOUND", "주제를 찾을 수 없습니다", 404);
  }

  const running = await prisma.generationJob.findFirst({
    where: { topicId: input.topicId, status: { in: ["RUNNING", "VERIFYING"] } },
  });
  if (running) {
    throw new ServiceError(
      "JOB_ALREADY_RUNNING",
      "이미 생성 중인 작업이 있습니다",
      409,
    );
  }

  const referenceAbsPaths = await resolveReferenceFiles(
    topic.referenceDir,
    input.referenceFiles,
  );
  const existing = await loadExistingQuestions(input.topicId);

  let variantSources: VariantSource[] = [];
  const sourceQuestionIds = input.sourceQuestionIds?.slice(0, VARIANT_SOURCE_LIMIT);
  if (sourceQuestionIds && sourceQuestionIds.length > 0) {
    const sourceQuestions = await prisma.question.findMany({
      where: { id: { in: sourceQuestionIds } },
    });
    if (sourceQuestions.length !== new Set(sourceQuestionIds).size) {
      throw new ServiceError("NOT_FOUND", "원본 문제를 찾을 수 없습니다", 404);
    }
    variantSources = sourceQuestions.map((question) => ({
      question: JSON.stringify({
        type: question.type === "MCQ" ? "mcq" : "cloze",
        ...(question.payload as Record<string, unknown>),
        ...(question.explanation ? { explanation: question.explanation } : {}),
      }),
    }));
  }
  const existingKeywords = await loadExistingKeywords(input.topicId);

  const job = await prisma.generationJob.create({
    data: {
      topicId: input.topicId,
      engine: input.engine,
      verifyEngine: input.verifyEngine,
      instructions: input.instructions,
      correctAnswerCount: input.correctAnswerCount,
      choiceCount: input.choiceCount,
      referenceFiles: [...new Set([...requiredReferenceFiles(topic.referenceDir), ...input.referenceFiles])],
      sourceQuestionIds:
        sourceQuestionIds && sourceQuestionIds.length > 0 ? sourceQuestionIds : undefined,
    },
  });

  void runJob(
    job.id,
    topic.name,
    input.instructions,
    { correctAnswerCount: input.correctAnswerCount, choiceCount: input.choiceCount },
    existing,
    referenceAbsPaths,
    existingKeywords,
    variantSources,
  ).catch((e) => {
    console.error(`generation job ${job.id} failed unexpectedly`, e);
  });

  return toDto(job);
}

export async function createKeywordTagJob(input: {
  topicId: number;
  engine: GenerationEngineDto;
}): Promise<GenerationJobDto> {
  const topic = await prisma.topic.findUnique({ where: { id: input.topicId } });
  if (!topic) {
    throw new ServiceError("TOPIC_NOT_FOUND", "주제를 찾을 수 없습니다", 404);
  }

  const running = await prisma.generationJob.findFirst({
    where: { topicId: input.topicId, status: { in: ["RUNNING", "VERIFYING"] } },
  });
  if (running) {
    throw new ServiceError(
      "JOB_ALREADY_RUNNING",
      "이미 생성 중인 작업이 있습니다",
      409,
    );
  }

  const untagged = await prisma.question.findMany({
    where: { topicId: input.topicId, keywords: { none: {} } },
    orderBy: { id: "asc" },
    take: KEYWORD_TAG_BATCH_LIMIT,
    select: { id: true, type: true, payload: true },
  });
  const targets = untagged
    .map((question) => ({
      id: question.id,
      summary: summarizeQuestionPayload(question.type, question.payload),
    }))
    .filter((target) => target.summary);
  if (targets.length === 0) {
    throw new ServiceError(
      "NO_UNTAGGED_QUESTIONS",
      "키워드를 부여할 문제가 없습니다",
      400,
    );
  }

  const existingKeywords = await loadExistingKeywords(input.topicId);

  const job = await prisma.generationJob.create({
    data: {
      topicId: input.topicId,
      engine: input.engine,
      verifyEngine: input.engine,
      instructions: "",
      kind: "KEYWORD_TAG",
    },
  });

  void runKeywordTagJob(job.id, topic.name, targets, existingKeywords).catch(
    (e) => {
      console.error(`keyword tag job ${job.id} failed unexpectedly`, e);
    },
  );

  return toDto(job);
}

async function runKeywordTagJob(
  jobId: number,
  topicName: string,
  targets: Array<{ id: number; summary: string }>,
  existingKeywords: string[],
): Promise<void> {
  const dir = jobOutputDir(jobId);
  const resultPath = path.join(dir, "result.json");
  const prompt = buildCliKeywordTagPrompt(
    topicName,
    targets,
    existingKeywords,
    resultPath,
  );

  const job = await prisma.generationJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RUNNING") return;

  const run = await runTrackedEngine({ generationJobId: jobId, stage: "KEYWORD_TAG", engine: job.engine, prompt, dir });
  if (!run.ok) {
    await failJob(jobId, run.failureReason, null);
    return;
  }

  const parsed = parseKeywordTagJson(extractJsonObject(run.resultText));
  if (!parsed.ok) {
    await failTrackedRun(run.runLogId, parsed.fatal);
    await failJob(
      jobId,
      `${parsed.fatal}; 원문 앞 300자: ${run.resultText.slice(0, 300)}`,
      run.resultText,
    );
    return;
  }
  await completeTrackedRun(run.runLogId);

  const summaryById = new Map(targets.map((target) => [target.id, target.summary]));
  // 요청에 없던 문제 id는 무시한다.
  const items: KeywordTagItemDto[] = parsed.assignments
    .filter((assignment) => summaryById.has(assignment.id))
    .map((assignment) => ({
      id: assignment.id,
      summary: summaryById.get(assignment.id) as string,
      keywords: assignment.keywords,
    }));

  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      result: items as unknown as Prisma.InputJsonValue,
      rawOutput: run.resultText,
      finishedAt: new Date(),
    },
  });
}

type BlueprintAssessment = { blueprint: QuestionBlueprint; assessment: DifficultyAssessment };

function summarizeGateViolations(items: BlueprintAssessment[]): string {
  return items.map((item) => formatDifficultyViolations(item.blueprint.id, item.assessment.violations)).join("\n");
}

// 난이도 게이트에 걸린 설계표만 골라 최대 BLUEPRINT_REPAIR_ATTEMPTS회 수선한다.
// 위반 코드·메시지·선택지 id를 그대로 전달해야 수선 모델이 무엇을 고칠지 알 수 있다 (job #50 재발 방지).
export async function repairGateFailures(input: {
  generationJobId: number;
  engine: GenerationEngine;
  dir: string;
  shape?: GenerationQuestionShape;
  blueprints: QuestionBlueprint[];
  blueprintRunLogId?: number | null;
}): Promise<{ passed: QuestionBlueprint[]; excludedCount: number; violationSummary: string | null }> {
  let assessments: BlueprintAssessment[] = input.blueprints.map((blueprint) => ({ blueprint, assessment: assessQuestionBlueprint(blueprint, input.shape) }));
  const initialFailing = assessments.filter((item) => !item.assessment.pass);
  if (input.blueprintRunLogId !== undefined) {
    if (initialFailing.length) await failTrackedRun(input.blueprintRunLogId, summarizeGateViolations(initialFailing));
    else await completeTrackedRun(input.blueprintRunLogId);
  }

  for (let attempt = 1; attempt <= BLUEPRINT_REPAIR_ATTEMPTS; attempt += 1) {
    const failed = assessments.filter((item) => !item.assessment.pass);
    if (!failed.length) break;
    const repairPath = path.join(input.dir, `blueprint-repair-${attempt}-result.json`);
    const prompt = buildCliQuestionBlueprintRepairPrompt(failed.map((item) => item.blueprint), summarizeGateViolations(failed), repairPath, input.shape);
    const repairRun = await runTrackedEngine({ generationJobId: input.generationJobId, stage: "BLUEPRINT_REPAIR", attempt, engine: input.engine, prompt, dir: input.dir, filePrefix: `blueprint-repair-${attempt}-` });
    // 엔진 실행 자체가 실패하면(타임아웃 등) 같은 조건 재시도의 기대 효용이 낮아 중단한다.
    if (!repairRun.ok) break;
    const repaired = parseQuestionBlueprintJson(extractJsonObject(repairRun.resultText));
    if (!repaired.ok) {
      await failTrackedRun(repairRun.runLogId, repaired.fatal);
      continue;
    }
    const failedIds = new Set(failed.map((item) => item.blueprint.id));
    const replacements = new Map(repaired.blueprints.filter((blueprint) => failedIds.has(blueprint.id)).map((blueprint) => [blueprint.id, blueprint]));
    assessments = assessments.map((item) => {
      const replacement = replacements.get(item.blueprint.id);
      return replacement ? { blueprint: replacement, assessment: assessQuestionBlueprint(replacement, input.shape) } : item;
    });
    const stillFailing = assessments.filter((item) => !item.assessment.pass);
    if (!stillFailing.length) {
      await completeTrackedRun(repairRun.runLogId);
      break;
    }
    await failTrackedRun(repairRun.runLogId, summarizeGateViolations(stillFailing));
  }

  const excluded = assessments.filter((item) => !item.assessment.pass);
  return {
    passed: assessments.filter((item) => item.assessment.pass).map((item) => item.blueprint),
    excludedCount: excluded.length,
    violationSummary: excluded.length ? summarizeGateViolations(excluded) : null,
  };
}

async function runJob(
  jobId: number,
  topicName: string,
  instructions: string,
  shape: GenerationQuestionShape,
  existing: ExistingQuestions,
  referenceAbsPaths: string[],
  existingKeywords: string[],
  variantSources: VariantSource[],
): Promise<void> {
  const dir = jobOutputDir(jobId);
  const job = await prisma.generationJob.findUnique({ where: { id: jobId } });
  if (!job || job.status !== "RUNNING") return;

  const blueprintPath = path.join(dir, "blueprint-result.json");
  const blueprintPrompt = buildCliQuestionBlueprintPrompt(topicName, instructions, blueprintPath, existing, referenceAbsPaths, existingKeywords, variantSources, shape);
  const blueprintRun = await runTrackedEngine({ generationJobId: jobId, stage: "BLUEPRINT", engine: job.engine, prompt: blueprintPrompt, dir, filePrefix: "blueprint-" });
  if (!blueprintRun.ok) {
    await failJob(jobId, blueprintRun.failureReason, null);
    return;
  }
  const blueprintParsed = parseQuestionBlueprintJson(extractJsonObject(blueprintRun.resultText));
  if (!blueprintParsed.ok) {
    await failTrackedRun(blueprintRun.runLogId, blueprintParsed.fatal);
    await failJob(jobId, blueprintParsed.fatal, blueprintRun.resultText);
    return;
  }
  const gate = await repairGateFailures({ generationJobId: jobId, engine: job.engine, dir, shape, blueprints: blueprintParsed.blueprints, blueprintRunLogId: blueprintRun.runLogId });
  const blueprints = gate.passed;
  if (!blueprints.length) {
    await failJob(jobId, `난이도 게이트를 통과한 설계표가 없습니다 (수선 ${BLUEPRINT_REPAIR_ATTEMPTS}회 시도).\n${gate.violationSummary}`, blueprintRun.resultText);
    return;
  }
  const blueprintWarning = gate.excludedCount ? `${gate.excludedCount} blueprint(s) were excluded after ${BLUEPRINT_REPAIR_ATTEMPTS} repair attempts.` : null;
  const resultPath = path.join(dir, "result.json");
  const prompt = buildCliGenerationFromBlueprintPrompt(topicName, blueprints, resultPath, referenceAbsPaths, shape);

  const run = await runTrackedEngine({ generationJobId: jobId, stage: "GENERATION", engine: job.engine, prompt, dir });
  if (!run.ok) {
    await failJob(jobId, run.failureReason, null);
    return;
  }

  const parsed = parseImportJson(extractJsonObject(run.resultText));
  if (!parsed.ok) {
    await failTrackedRun(run.runLogId, parsed.fatal);
    await failJob(
      jobId,
      `${parsed.fatal}; 원문 앞 300자: ${run.resultText.slice(0, 300)}`,
      run.resultText,
    );
    return;
  }

  // 이 시점의 verdict는 전부 unverified — 검증이 끝나면 덮어쓴다.
  if (parsed.items.length !== blueprints.length) {
    const countMismatch = `Generated question count (${parsed.items.length}) does not match blueprint count (${blueprints.length}).`;
    await failTrackedRun(run.runLogId, countMismatch);
    await failJob(jobId, countMismatch, run.resultText);
    return;
  }
  const shapeValidatedItems = parsed.items.map((item) => {
    if (!item.ok) return item;
    const validated = validateGeneratedQuestions([item.question], shape)[0];
    return validated ? { ...validated, index: item.index } : item;
  });
  const { items: generatedItems, validCount, failureMessage } = prepareGeneratedItems(shapeValidatedItems);
  const unverifiedItems = mergeVerdicts(generatedItems, []);
  const validItems = generatedItems.filter((item) => item.ok);

  const invalidItems = generatedItems.filter((item): item is Extract<typeof item, { ok: false }> => !item.ok);
  if (invalidItems.length === 0) await completeTrackedRun(run.runLogId);
  else await failTrackedRun(run.runLogId, `${invalidItems.length}개 문항이 유효성 검사를 통과하지 못했습니다: ${invalidItems.map((item) => `#${item.index + 1} ${item.errors[0] ?? "알 수 없는 검증 오류"}`).join("; ")}`);

  if (validCount === 0) {
    await prisma.generationJob.update({
      where: { id: jobId },
      data: {
        status: "FAILED",
        result: attachTestedDistinctions(unverifiedItems, blueprints) as unknown as Prisma.InputJsonValue,
        errorMessage: failureMessage,
        rawOutput: run.resultText,
        finishedAt: new Date(),
      },
    });
    return;
  }

  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "VERIFYING",
      result: attachTestedDistinctions(unverifiedItems, blueprints) as unknown as Prisma.InputJsonValue,
      rawOutput: run.resultText,
    },
  });

  const verifyResultPath = path.join(dir, "verify-result.json");
  const verifyPrompt = buildCliVerifyPrompt(
    topicName,
    validItems.map((item) => ({ index: item.index, question: item.question, blueprint: blueprints[item.index] })),
    verifyResultPath,
    referenceAbsPaths,
    shape,
  );

  let finalItems = unverifiedItems;
  let verifyWarning: string | null = null;

  const verifyRun = await runTrackedEngine({ generationJobId: jobId, stage: "VERIFY", engine: job.verifyEngine, prompt: verifyPrompt, dir, filePrefix: "verify-" });
  if (!verifyRun.ok) {
    verifyWarning = verifyRun.failureReason;
  } else {
    const verdicts = parseVerifyJson(extractJsonObject(verifyRun.resultText));
    if (!verdicts.ok) {
      await failTrackedRun(verifyRun.runLogId, verdicts.fatal);
      verifyWarning = `검증 결과를 해석하지 못했습니다: ${verdicts.fatal}`;
    } else {
      await completeTrackedRun(verifyRun.runLogId);
      finalItems = mergeVerdicts(generatedItems, verdicts.verdicts);
    }
  }

  // Quality gate: failed items get exactly one automatic repair and a second verdict.
  const repairTargets = finalItems.filter(
    (item): item is Extract<typeof item, { ok: true }> => item.ok && item.verdict === "fail",
  );
  if (repairTargets.length > 0) {
    const repaired: Array<{ index: number; question: ImportQuestion; previousComment: string | null }> = [];
    for (const item of repairTargets) {
      const repairPath = path.join(dir, `repair-${item.index}.json`);
      const repairPrompt = buildCliRevisionPrompt(
        topicName,
        item.question,
        `자동 품질 수정입니다. 검증 실패 사유: ${item.verdictComment ?? "품질 기준 미충족"}. 시험형 객관식 규칙, answer_indices와 choice_explanations를 모두 충족하세요.`,
        repairPath,
        referenceAbsPaths,
        blueprints[item.index],
        shape,
      );
      const repairRun = await runTrackedEngine({ generationJobId: jobId, stage: "ITEM_REPAIR", itemIndex: item.index, engine: job.engine, prompt: repairPrompt, dir, filePrefix: `repair-${item.index}-` });
      if (!repairRun.ok) continue;
      const revision = parseRevisionJson(extractJsonObject(repairRun.resultText));
      if (!revision.ok) {
        await failTrackedRun(repairRun.runLogId, revision.fatal);
        continue;
      }
      const validated = validateGeneratedQuestions([revision.question], shape)[0];
      if (!validated?.ok) {
        await failTrackedRun(repairRun.runLogId, validated?.errors.join(" ") ?? "수정본 검증 결과가 없습니다.");
        continue;
      }
      await completeTrackedRun(repairRun.runLogId);
      repaired.push({
        index: item.index,
        question: validated.question.type === "mcq"
          ? shuffleMcqChoices(validated.question) as ImportQuestion
          : validated.question,
        previousComment: item.verdictComment,
      });
    }
    if (repaired.length > 0) {
      const repairVerifyPath = path.join(dir, "repair-verify-result.json");
      const repairVerifyPrompt = buildCliVerifyPrompt(topicName, repaired.map((item) => ({ ...item, blueprint: blueprints[item.index] })), repairVerifyPath, referenceAbsPaths, shape);
      const repairVerifyRun = await runTrackedEngine({ generationJobId: jobId, stage: "REPAIR_VERIFY", engine: job.verifyEngine, prompt: repairVerifyPrompt, dir, filePrefix: "repair-verify-" });
      if (repairVerifyRun.ok) {
        const repairVerdicts = parseVerifyJson(extractJsonObject(repairVerifyRun.resultText));
        if (!repairVerdicts.ok) await failTrackedRun(repairVerifyRun.runLogId, repairVerdicts.fatal);
        else await completeTrackedRun(repairVerifyRun.runLogId);
        if (repairVerdicts.ok) {
          const repairedResults = mergeVerdicts(
            repaired.map((item) => ({ index: item.index, ok: true as const, question: item.question })),
            repairVerdicts.verdicts,
          );
          const byIndex = new Map(repairedResults.map((item) => [item.index, item]));
          finalItems = finalItems.map((item) => {
            const replacement = byIndex.get(item.index);
            if (!replacement || !replacement.ok) return item;
            return {
              ...replacement,
              verdictComment: replacement.verdictComment
                ? `자동 수정 후 재검증: ${replacement.verdictComment}`
                : "자동 수정 후 재검증 완료",
            };
          });
        }
      }
    }
  }

  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "SUCCEEDED",
      result: attachTestedDistinctions(
        finalItems.map((item) => item.ok && item.question.type === "mcq"
          ? { ...item, question: shuffleMcqChoices(item.question) as ImportQuestion }
          : item),
        blueprints,
      ) as unknown as Prisma.InputJsonValue,
      verifyWarning: [blueprintWarning, verifyWarning].filter(Boolean).join(" ") || null,
      finishedAt: new Date(),
    },
  });
}

async function failJob(
  jobId: number,
  message: string,
  rawOutput: string | null,
): Promise<void> {
  await prisma.generationJob.update({
    where: { id: jobId },
    data: {
      status: "FAILED",
      errorMessage: message,
      rawOutput,
      finishedAt: new Date(),
    },
  });
}

function jobItems(job: GenerationJob): GenerationItemDto[] {
  return (job.result as unknown as GenerationItemDto[] | null) ?? [];
}

export async function createItemRevision(input: {
  jobId: number;
  itemIndex: number;
  engine: GenerationEngineDto;
  instructions: string;
}): Promise<GenerationJobDto> {
  const job = await prisma.generationJob.findUnique({
    where: { id: input.jobId },
    include: { topic: true },
  });
  if (!job) throw new ServiceError("JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다", 404);
  if (job.kind !== "QUESTION" || job.status !== "SUCCEEDED" || job.approvedAt) {
    throw new ServiceError("JOB_NOT_REVISIONABLE", "저장 전 완료된 문제 생성 작업만 재검증할 수 있습니다", 409);
  }
  const item = jobItems(job).find((candidate) => candidate.index === input.itemIndex);
  if (!item || !item.ok) {
    throw new ServiceError("ITEM_NOT_FOUND", "재검증할 문제를 찾을 수 없습니다", 404);
  }
  const existing = await prisma.generationItemRevision.findUnique({
    where: { generationJobId_itemIndex: { generationJobId: job.id, itemIndex: input.itemIndex } },
  });
  if (existing?.status === "RUNNING") {
    throw new ServiceError("REVISION_RUNNING", "이 문제의 AI 재검증이 진행 중입니다", 409);
  }
  const sourceQuestion = (existing?.appliedQuestion as unknown as ImportQuestion | null) ?? item.question as ImportQuestion;
  const revision = await prisma.generationItemRevision.upsert({
    where: { generationJobId_itemIndex: { generationJobId: job.id, itemIndex: input.itemIndex } },
    create: { generationJobId: job.id, itemIndex: input.itemIndex, engine: input.engine, instructions: input.instructions },
    update: {
      engine: input.engine, instructions: input.instructions, status: "RUNNING", verdict: null,
      comment: null, proposedQuestion: Prisma.JsonNull, errorMessage: null, rawOutput: null, finishedAt: null,
    },
  });
  const references = await resolveReferenceFiles(
    job.topic.referenceDir,
    (job.referenceFiles as unknown as string[] | null) ?? [],
  );
  void runItemRevision(revision.id, job.id, job.topic.name, sourceQuestion, references, jobQuestionShape(job)).catch((error) => {
    console.error(`generation item revision ${revision.id} failed unexpectedly`, error);
  });
  return getJob(job.id);
}

async function runItemRevision(
  revisionId: number,
  jobId: number,
  topicName: string,
  question: ImportQuestion,
  referenceFiles: string[],
  shape?: GenerationQuestionShape,
): Promise<void> {
  const revision = await prisma.generationItemRevision.findUnique({ where: { id: revisionId } });
  if (!revision || revision.status !== "RUNNING") return;
  const dir = path.join(jobOutputDir(jobId), "revisions", String(revision.itemIndex));
  const resultPath = path.join(dir, "result.json");
  const prompt = buildCliRevisionPrompt(
    topicName,
    question,
    revision.instructions,
    resultPath,
    referenceFiles,
    undefined,
    shape,
  );
  const run = await runTrackedEngine({ generationJobId: jobId, stage: "MANUAL_ITEM_REVISION", itemIndex: revision.itemIndex, engine: revision.engine, prompt, dir });
  if (!run.ok) {
    await prisma.generationItemRevision.update({ where: { id: revisionId }, data: { status: "FAILED", errorMessage: run.failureReason, finishedAt: new Date() } });
    return;
  }
  const parsed = parseRevisionJson(extractJsonObject(run.resultText));
  if (!parsed.ok) {
    await failTrackedRun(run.runLogId, parsed.fatal);
    await prisma.generationItemRevision.update({ where: { id: revisionId }, data: { status: "FAILED", errorMessage: parsed.fatal, rawOutput: run.resultText, finishedAt: new Date() } });
    return;
  }
  const validated = shape ? validateGeneratedQuestions([parsed.question], shape)[0] : null;
  if (validated && !validated.ok) {
    await failTrackedRun(run.runLogId, validated.errors.join(" "));
    await prisma.generationItemRevision.update({
      where: { id: revisionId },
      data: { status: "FAILED", errorMessage: validated.errors.join(" "), rawOutput: run.resultText, finishedAt: new Date() },
    });
    return;
  }
  await completeTrackedRun(run.runLogId);
  await prisma.generationItemRevision.update({
    where: { id: revisionId },
    data: { status: "SUCCEEDED", verdict: parsed.verdict === "pass" ? "PASS" : "FAIL", comment: parsed.comment, proposedQuestion: parsed.question as unknown as Prisma.InputJsonValue, rawOutput: run.resultText, finishedAt: new Date() },
  });
}

export async function setItemRevisionUsage(jobId: number, itemIndex: number, useRevision: boolean): Promise<GenerationJobDto> {
  const job = await prisma.generationJob.findUnique({ where: { id: jobId } });
  if (!job) throw new ServiceError("JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다", 404);
  if (job.approvedAt) throw new ServiceError("JOB_APPROVED", "저장된 작업의 수정본은 바꿀 수 없습니다", 409);
  const revision = await prisma.generationItemRevision.findUnique({ where: { generationJobId_itemIndex: { generationJobId: jobId, itemIndex } } });
  if (!revision || revision.status !== "SUCCEEDED" || !revision.proposedQuestion) {
    throw new ServiceError("REVISION_NOT_READY", "적용할 AI 수정본이 없습니다", 409);
  }
  await prisma.generationItemRevision.update({ where: { id: revision.id }, data: { appliedQuestion: useRevision ? revision.proposedQuestion : Prisma.JsonNull } });
  return getJob(jobId);
}

export async function getJob(id: number): Promise<GenerationJobDto> {
  const job = await prisma.generationJob.findUnique({ where: { id }, include: { itemRevisions: true } });
  if (!job) {
    throw new ServiceError("JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다", 404);
  }

  // 생성·검증 단계가 각각 타임아웃을 가지므로 고아 판정 기준은 2배 + 유예.
  const orphanAfterMs = 2 * generationTimeoutMs() + ORPHAN_GRACE_MS;
  const isStale = Date.now() - job.createdAt.getTime() > orphanAfterMs;

  if (job.status === "RUNNING" && isStale) {
    await prisma.generationRunLog.updateMany({
      where: { generationJobId: id, status: "RUNNING" },
      data: { status: "FAILED", errorMessage: "시간 초과 또는 서버 재시작으로 실행 기록이 중단되었습니다.", finishedAt: new Date() },
    });
    const updated = await prisma.generationJob.update({
      where: { id },
      data: {
        status: "FAILED",
        errorMessage: "시간 초과 또는 서버 재시작으로 중단되었습니다",
        finishedAt: new Date(),
      },
    });
    return getJob(updated.id);
  }

  if (job.status === "VERIFYING" && isStale) {
    await prisma.generationRunLog.updateMany({
      where: { generationJobId: id, status: "RUNNING" },
      data: { status: "FAILED", errorMessage: "시간 초과 또는 서버 재시작으로 실행 기록이 중단되었습니다.", finishedAt: new Date() },
    });
    // 생성 결과(전 항목 unverified)는 VERIFYING 전환 시점에 이미 저장돼 있다.
    const updated = await prisma.generationJob.update({
      where: { id },
      data: {
        status: "SUCCEEDED",
        verifyWarning: "시간 초과 또는 서버 재시작으로 검증이 중단되었습니다",
        finishedAt: new Date(),
      },
    });
    return getJob(updated.id);
  }

  return toDto(job, job.itemRevisions);
}

export async function approveJob(
  id: number,
  indices: number[],
): Promise<{ savedCount: number; job: GenerationJobDto }> {
  const job = await prisma.generationJob.findUnique({ where: { id } });
  if (!job) {
    throw new ServiceError("JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다", 404);
  }
  if (job.status !== "SUCCEEDED") {
    throw new ServiceError(
      "JOB_NOT_APPROVABLE",
      "완료된 작업만 저장할 수 있습니다",
      409,
    );
  }

  if (job.kind === "KEYWORD_TAG") {
    const items = (job.result as unknown as KeywordTagItemDto[] | null) ?? [];
    const byId = new Map(items.map((item) => [item.id, item]));
    const picked: KeywordTagItemDto[] = [];
    for (const id of indices) {
      const item = byId.get(id);
      if (!item) {
        throw new ServiceError(
          "INVALID_ITEMS",
          "저장할 수 없는 항목이 포함되어 있습니다",
          400,
        );
      }
      picked.push(item);
    }
    if (picked.length === 0) {
      throw new ServiceError("INVALID_ITEMS", "저장할 항목이 없습니다", 400);
    }

    // 잡 실행 후 삭제된 문제는 건너뛴다.
    const existingIds = new Set(
      (
        await prisma.question.findMany({
          where: { id: { in: picked.map((item) => item.id) } },
          select: { id: true },
        })
      ).map((question) => question.id),
    );
    let applied = 0;
    await prisma.$transaction(async (tx) => {
      for (const item of picked) {
        if (!existingIds.has(item.id)) continue;
        await attachKeywords(tx, item.id, item.keywords);
        applied += 1;
      }
    });

    const updated = await prisma.generationJob.update({
      where: { id },
      data: { approvedAt: new Date(), savedCount: { increment: applied } },
    });
    return { savedCount: applied, job: toDto(updated) };
  }

  const items = job.result as unknown as GenerationItemDto[] | null;
  const byIndex = new Map(items?.map((item) => [item.index, item]) ?? []);
  const revisions = await prisma.generationItemRevision.findMany({
    where: { generationJobId: id, appliedQuestion: { not: Prisma.JsonNull } },
  });
  const appliedByIndex = new Map(revisions.map((revision) => [revision.itemIndex, revision.appliedQuestion]));
  const questions: ImportQuestionInput[] = [];
  for (const index of indices) {
    const item = byIndex.get(index);
    const appliedQuestion = appliedByIndex.get(index);
    if (!item || !item.ok || (item.verdict === "fail" && !appliedQuestion)) {
      throw new ServiceError(
        "INVALID_ITEMS",
        "저장할 수 없는 항목이 포함되어 있습니다",
        400,
      );
    }
    questions.push({
      question: (appliedQuestion ?? item.question) as unknown as ImportQuestion,
      testedDistinction: item.testedDistinction ?? null,
    });
  }
  if (questions.length === 0) {
    throw new ServiceError("INVALID_ITEMS", "저장할 항목이 없습니다", 400);
  }

  const savedCount = await importQuestions(job.topicId, questions);
  const updated = await prisma.generationJob.update({
    where: { id },
    data: { approvedAt: new Date(), savedCount: { increment: savedCount } },
  });
  return { savedCount, job: toDto(updated) };
}

export async function deleteJob(id: number): Promise<void> {
  const job = await prisma.generationJob.findUnique({ where: { id } });
  if (!job) {
    throw new ServiceError("JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다", 404);
  }
  if (job.status === "RUNNING" || job.status === "VERIFYING") {
    throw new ServiceError(
      "JOB_RUNNING",
      "진행 중인 작업은 삭제할 수 없습니다",
      409,
    );
  }

  await prisma.generationJob.delete({ where: { id } });
  await rm(jobOutputDir(id), { recursive: true, force: true }).catch(() => {
    // 출력 디렉터리 정리는 best-effort로 처리한다.
  });
}

export async function listJobs(): Promise<GenerationJobSummaryDto[]> {
  const jobs = await prisma.generationJob.findMany({
    where: { approvedAt: null },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { topic: { select: { name: true } } },
  });
  return jobs.map(toSummaryDto);
}
