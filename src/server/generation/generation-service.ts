import { rm } from "node:fs/promises";
import path from "node:path";
import { Prisma, type GenerationEngine } from "@prisma/client";
import { parseImportJson, type ImportQuestion, validateGeneratedQuestions } from "@/core/import-schema";
import { attachTestedDistinctions, prepareGeneratedItems } from "@/core/generation-result";
import { extractJsonObject } from "@/core/json-extract";
import { shuffleMcqChoices } from "@/core/random";
import { parseKeywordTagJson } from "@/core/keyword-tag-schema";
import {
  buildCliGenerationFromBlueprintPrompt,
  buildCliItemRepairPrompt,
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
  GenerationJobSummaryDto,
  GenerationItemRevisionDto,
  JobDtoBase,
  KeywordTagItemDto,
  ChoiceCountDto,
  CorrectAnswerCountDto,
} from "@/lib/api-types";
import { prisma } from "../db";
import { ServiceError } from "../errors";
import type { ImportQuestionInput } from "../import-service";
import { toJobDtoBase } from "../job-dto";
import { recoverStaleJobs, runClaimedJob } from "../job-runner";
import { createPendingJob, retryJob } from "../job-service";
import { attachKeywords } from "../keyword-service";
import { requiredReferenceFiles, resolveReferenceFiles } from "./reference";
import { jobOutputDir } from "./run-engine";
import { completeTrackedRun, failTrackedRun, runTrackedEngine } from "./tracked-run";

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

const generationJobInclude = {
  questionGenerationData: true,
  keywordTaggingData: true,
  childJobs: {
    where: { type: "GENERATION_ITEM_REVISION" as const },
    include: { generationItemRevisionData: true },
    orderBy: { id: "asc" as const },
  },
} satisfies Prisma.JobInclude;

type GenerationJobRecord = Prisma.JobGetPayload<{
  include: typeof generationJobInclude;
}>;
type RevisionJobRecord = GenerationJobRecord["childJobs"][number];

function jobQuestionShape(job: Pick<GenerationJobRecord, "questionGenerationData">): GenerationQuestionShape | undefined {
  const detail = job.questionGenerationData;
  if (!detail?.correctAnswerCount || !detail.choiceCount) return undefined;
  return {
    correctAnswerCount: detail.correctAnswerCount as CorrectAnswerCountDto,
    choiceCount: detail.choiceCount as ChoiceCountDto,
  };
}

function toRevisionDto(revision: RevisionJobRecord): GenerationItemRevisionDto {
  const detail = revision.generationItemRevisionData;
  if (!detail) throw new Error("Generation item revision detail is missing");
  return {
    id: revision.id,
    status: revision.status,
    engine: revision.engine,
    verdict: detail.verdict === "PASS" ? "pass" : detail.verdict === "FAIL" ? "fail" : null,
    comment: detail.comment,
    proposedQuestion: detail.proposedQuestion,
    selectedAt: detail.selectedAt?.toISOString() ?? null,
    errorMessage: revision.errorMessage,
  };
}

function revisionsForIndex(job: GenerationJobRecord, itemIndex: number): RevisionJobRecord[] {
  return job.childJobs.filter(
    (revision) => revision.generationItemRevisionData?.itemIndex === itemIndex,
  );
}

function toDto(job: GenerationJobRecord): GenerationJobDto {
  if (!job.topicId || (job.type !== "QUESTION_GENERATION" && job.type !== "KEYWORD_TAGGING")) {
    throw new Error("Invalid generation job target or type");
  }
  const questionData = job.questionGenerationData;
  const keywordData = job.keywordTaggingData;
  const storedItems = job.type === "QUESTION_GENERATION" && job.status === "SUCCEEDED"
    ? (questionData?.items as unknown as Array<Exclude<GenerationItemDto, { index: number; ok: false; errors: string[] }>> | null)
    : null;
  return {
    ...toJobDtoBase(job),
    type: job.type,
    topicId: job.topicId,
    questionId: null,
    parentJobId: null,
    verifyEngine: questionData?.verifyEngine ?? job.engine,
    instructions: questionData?.instructions ?? "",
    referenceFiles: normalizeStringArray(questionData?.referenceFiles ?? null),
    correctAnswerCount: questionData?.correctAnswerCount as CorrectAnswerCountDto | null ?? null,
    choiceCount: questionData?.choiceCount as ChoiceCountDto | null ?? null,
    stage: questionData?.stage ?? null,
    items: storedItems?.map((item) => {
      const revisions = revisionsForIndex(job, item.index);
      const selected = revisions
        .filter((revision) => revision.status === "SUCCEEDED" && revision.generationItemRevisionData?.selectedAt)
        .at(-1) ?? null;
      return {
        ...item,
        revision: revisions.length ? toRevisionDto(revisions.at(-1) as RevisionJobRecord) : null,
        selectedRevision: selected ? toRevisionDto(selected) : null,
      };
    }) ?? null,
    keywordItems:
      job.type === "KEYWORD_TAGGING" && job.status === "SUCCEEDED"
        ? (keywordData?.items as unknown as KeywordTagItemDto[] | null) ?? []
        : null,
    verifyWarning: questionData?.verifyWarning ?? null,
    approvedAt: (questionData?.approvedAt ?? keywordData?.approvedAt)?.toISOString() ?? null,
    savedCount: questionData?.savedCount ?? keywordData?.savedCount ?? 0,
    sourceQuestionIds: (questionData?.sourceQuestionIds as unknown as number[] | null) ?? null,
  };
}

function toSummaryDto(
  job: GenerationJobRecord & { topic: { name: string } | null },
): GenerationJobSummaryDto {
  const dto = toDto(job);
  if (!job.topic) throw new Error("Generation job topic is missing");
  return {
    ...toJobDtoBase(job),
    type: dto.type,
    topicId: dto.topicId,
    questionId: null,
    parentJobId: null,
    topicName: job.topic.name,
    verifyEngine: dto.verifyEngine,
    correctAnswerCount: dto.correctAnswerCount,
    choiceCount: dto.choiceCount,
    stage: dto.stage,
    itemCount: dto.type === "QUESTION_GENERATION"
      ? dto.items?.length ?? null
      : dto.keywordItems?.length ?? null,
    savedCount: dto.savedCount,
    approvedAt: dto.approvedAt,
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

type CreateQuestionGenerationInput = {
  topicId: number;
  engine: GenerationEngineDto;
  verifyEngine: GenerationEngineDto;
  instructions: string;
  correctAnswerCount: CorrectAnswerCountDto;
  choiceCount: ChoiceCountDto;
  referenceFiles: string[];
  sourceQuestionIds?: number[];
  retryOfJobId?: number;
};

async function rejectActiveGenerationJob(
  tx: Prisma.TransactionClient,
  topicId: number,
): Promise<null> {
  const active = await tx.job.findFirst({
    where: {
      topicId,
      type: { in: ["QUESTION_GENERATION", "KEYWORD_TAGGING"] },
      status: { in: ["PENDING", "RUNNING"] },
    },
  });
  if (active) {
    throw new ServiceError(
      "JOB_ALREADY_RUNNING",
      "이미 생성 중인 작업이 있습니다",
      409,
    );
  }
  return null;
}

function pendingQuestionDto(
  job: JobDtoBase,
  input: CreateQuestionGenerationInput,
  referenceFiles: string[],
  sourceQuestionIds: number[] | undefined,
): GenerationJobDto {
  return {
    ...job,
    type: "QUESTION_GENERATION",
    topicId: input.topicId,
    questionId: null,
    parentJobId: null,
    verifyEngine: input.verifyEngine,
    instructions: input.instructions,
    referenceFiles,
    correctAnswerCount: input.correctAnswerCount,
    choiceCount: input.choiceCount,
    stage: "RUNNING",
    items: null,
    keywordItems: null,
    verifyWarning: null,
    approvedAt: null,
    savedCount: 0,
    sourceQuestionIds: sourceQuestionIds ?? null,
  };
}

export async function createJob(
  input: CreateQuestionGenerationInput,
): Promise<GenerationJobDto> {
  const topic = await prisma.topic.findUnique({ where: { id: input.topicId } });
  if (!topic) {
    throw new ServiceError("TOPIC_NOT_FOUND", "주제를 찾을 수 없습니다", 404);
  }

  await resolveReferenceFiles(
    topic.referenceDir,
    input.referenceFiles,
  );

  const sourceQuestionIds = input.sourceQuestionIds?.slice(0, VARIANT_SOURCE_LIMIT);
  if (sourceQuestionIds && sourceQuestionIds.length > 0) {
    const sourceQuestions = await prisma.question.findMany({
      where: { id: { in: sourceQuestionIds } },
    });
    if (sourceQuestions.length !== new Set(sourceQuestionIds).size) {
      throw new ServiceError("NOT_FOUND", "원본 문제를 찾을 수 없습니다", 404);
    }
  }

  const storedReferenceFiles = [
    ...new Set([
      ...requiredReferenceFiles(topic.referenceDir),
      ...input.referenceFiles,
    ]),
  ];
  const pendingInput = {
    type: "QUESTION_GENERATION" as const,
    engine: input.engine,
    target: { topicId: input.topicId },
    detail: {
      type: "QUESTION_GENERATION" as const,
      data: {
        verifyEngine: input.verifyEngine,
        instructions: input.instructions,
        correctAnswerCount: input.correctAnswerCount,
        choiceCount: input.choiceCount,
        referenceFiles: storedReferenceFiles,
        sourceQuestionIds: sourceQuestionIds?.length
          ? sourceQuestionIds
          : undefined,
      },
    },
  };
  const job = input.retryOfJobId
    ? await retryJob(input.retryOfJobId, pendingInput, {
        resolveExisting: (tx) => rejectActiveGenerationJob(tx, input.topicId),
      })
    : await createPendingJob(pendingInput, {
        resolveExisting: (tx) => rejectActiveGenerationJob(tx, input.topicId),
      });

  return pendingQuestionDto(job, input, storedReferenceFiles, sourceQuestionIds);
}

export async function createKeywordTagJob(input: {
  topicId: number;
  engine: GenerationEngineDto;
}): Promise<GenerationJobDto> {
  const topic = await prisma.topic.findUnique({ where: { id: input.topicId } });
  if (!topic) {
    throw new ServiceError("TOPIC_NOT_FOUND", "주제를 찾을 수 없습니다", 404);
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

  const job = await createPendingJob(
    {
      type: "KEYWORD_TAGGING",
      engine: input.engine,
      target: { topicId: input.topicId },
      detail: {
        type: "KEYWORD_TAGGING",
        data: { targets: targets as unknown as Prisma.InputJsonValue },
      },
    },
    { resolveExisting: (tx) => rejectActiveGenerationJob(tx, input.topicId) },
  );

  return {
    ...job,
    type: "KEYWORD_TAGGING",
    topicId: input.topicId,
    questionId: null,
    parentJobId: null,
    verifyEngine: input.engine,
    instructions: "",
    referenceFiles: [],
    correctAnswerCount: null,
    choiceCount: null,
    stage: null,
    items: null,
    keywordItems: null,
    verifyWarning: null,
    approvedAt: null,
    savedCount: 0,
    sourceQuestionIds: null,
  };
}

type GenerationExecutionJob = Prisma.JobGetPayload<{
  include: {
    topic: true;
    questionGenerationData: true;
    keywordTaggingData: true;
  };
}>;

async function executeKeywordTagJob(
  job: GenerationExecutionJob,
): Promise<{ type: "KEYWORD_TAGGING"; items: KeywordTagItemDto[] }> {
  if (!job.topic || !job.keywordTaggingData) {
    throw new Error("Keyword tagging job data is missing");
  }
  const targets = (job.keywordTaggingData.targets as unknown as Array<{
    id: number;
    summary: string;
  }> | null) ?? [];
  const existingKeywords = await loadExistingKeywords(job.topic.id);
  const dir = jobOutputDir(job.id);
  const resultPath = path.join(dir, "result.json");
  const prompt = buildCliKeywordTagPrompt(
    job.topic.name,
    targets,
    existingKeywords,
    resultPath,
  );

  const run = await runTrackedEngine({ jobId: job.id, stage: "KEYWORD_TAG", engine: job.engine, prompt, dir });
  if (!run.ok) {
    throw new Error(run.failureReason);
  }

  const parsed = parseKeywordTagJson(extractJsonObject(run.resultText));
  if (!parsed.ok) {
    await failTrackedRun(run.runLogId, parsed.fatal);
    throw new Error(
      `${parsed.fatal}; 원문 앞 300자: ${run.resultText.slice(0, 300)}`,
    );
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

  return { type: "KEYWORD_TAGGING", items };
}

type BlueprintAssessment = { blueprint: QuestionBlueprint; assessment: DifficultyAssessment };

function summarizeGateViolations(items: BlueprintAssessment[]): string {
  return items.map((item) => formatDifficultyViolations(item.blueprint.id, item.assessment.violations)).join("\n");
}

// 난이도 게이트에 걸린 설계표만 골라 최대 BLUEPRINT_REPAIR_ATTEMPTS회 수선한다.
// 위반 코드·메시지·선택지 id를 그대로 전달해야 수선 모델이 무엇을 고칠지 알 수 있다 (job #50 재발 방지).
export async function repairGateFailures(input: {
  jobId: number;
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
    const repairRun = await runTrackedEngine({ jobId: input.jobId, stage: "BLUEPRINT_REPAIR", attempt, engine: input.engine, prompt, dir: input.dir, filePrefix: `blueprint-repair-${attempt}-` });
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

type QuestionExecutionResult = {
  type: "QUESTION_GENERATION";
  items: GenerationItemDto[];
  verifyWarning: string | null;
};

async function executeQuestionJob(
  job: GenerationExecutionJob,
): Promise<QuestionExecutionResult> {
  const detail = job.questionGenerationData;
  if (!job.topic || !detail) {
    throw new Error("Question generation job data is missing");
  }
  const shape = jobQuestionShape(job);
  if (!shape) throw new Error("Question generation shape is missing");
  const sourceQuestionIds = (detail.sourceQuestionIds as unknown as number[] | null) ?? [];
  const sourceQuestions = sourceQuestionIds.length
    ? await prisma.question.findMany({ where: { id: { in: sourceQuestionIds } } })
    : [];
  const variantSources: VariantSource[] = sourceQuestions.map((question) => ({
    question: JSON.stringify({
      type: question.type === "MCQ" ? "mcq" : "cloze",
      ...(question.payload as Record<string, unknown>),
      ...(question.explanation ? { explanation: question.explanation } : {}),
    }),
  }));
  const topicName = job.topic.name;
  const existing = await loadExistingQuestions(job.topic.id);
  const referenceAbsPaths = await resolveReferenceFiles(
    job.topic.referenceDir,
    normalizeStringArray(detail.referenceFiles),
  );
  const existingKeywords = await loadExistingKeywords(job.topic.id);
  const dir = jobOutputDir(job.id);

  const blueprintPath = path.join(dir, "blueprint-result.json");
  const blueprintPrompt = buildCliQuestionBlueprintPrompt(topicName, detail.instructions, blueprintPath, existing, referenceAbsPaths, existingKeywords, variantSources, shape);
  const blueprintRun = await runTrackedEngine({ jobId: job.id, stage: "BLUEPRINT", engine: job.engine, prompt: blueprintPrompt, dir, filePrefix: "blueprint-" });
  if (!blueprintRun.ok) {
    throw new Error(blueprintRun.failureReason);
  }
  const blueprintParsed = parseQuestionBlueprintJson(extractJsonObject(blueprintRun.resultText));
  if (!blueprintParsed.ok) {
    await failTrackedRun(blueprintRun.runLogId, blueprintParsed.fatal);
    throw new Error(blueprintParsed.fatal);
  }
  const gate = await repairGateFailures({ jobId: job.id, engine: job.engine, dir, shape, blueprints: blueprintParsed.blueprints, blueprintRunLogId: blueprintRun.runLogId });
  const blueprints = gate.passed;
  if (!blueprints.length) {
    throw new Error(`난이도 게이트를 통과한 설계표가 없습니다 (수선 ${BLUEPRINT_REPAIR_ATTEMPTS}회 시도).\n${gate.violationSummary}`);
  }
  const blueprintWarning = gate.excludedCount ? `${gate.excludedCount} blueprint(s) were excluded after ${BLUEPRINT_REPAIR_ATTEMPTS} repair attempts.` : null;
  const resultPath = path.join(dir, "result.json");
  const prompt = buildCliGenerationFromBlueprintPrompt(topicName, blueprints, resultPath, referenceAbsPaths, shape);

  const run = await runTrackedEngine({ jobId: job.id, stage: "GENERATION", engine: job.engine, prompt, dir });
  if (!run.ok) {
    throw new Error(run.failureReason);
  }

  const parsed = parseImportJson(extractJsonObject(run.resultText));
  if (!parsed.ok) {
    await failTrackedRun(run.runLogId, parsed.fatal);
    throw new Error(
      `${parsed.fatal}; 원문 앞 300자: ${run.resultText.slice(0, 300)}`,
    );
  }

  // 이 시점의 verdict는 전부 unverified — 검증이 끝나면 덮어쓴다.
  if (parsed.items.length !== blueprints.length) {
    const countMismatch = `Generated question count (${parsed.items.length}) does not match blueprint count (${blueprints.length}).`;
    await failTrackedRun(run.runLogId, countMismatch);
    throw new Error(countMismatch);
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
    await prisma.questionGenerationJobData.update({
      where: { jobId: job.id },
      data: {
        stage: "FAILED",
        items: attachTestedDistinctions(unverifiedItems, blueprints) as unknown as Prisma.InputJsonValue,
      },
    });
    throw new Error(failureMessage ?? "생성된 문항이 없습니다");
  }

  await prisma.questionGenerationJobData.update({
    where: { jobId: job.id },
    data: {
      stage: "VERIFYING",
      items: attachTestedDistinctions(unverifiedItems, blueprints) as unknown as Prisma.InputJsonValue,
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

  const verifyRun = await runTrackedEngine({ jobId: job.id, stage: "VERIFY", engine: detail.verifyEngine, prompt: verifyPrompt, dir, filePrefix: "verify-" });
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
      const blueprint = blueprints[item.index];
      if (!blueprint) continue;
      const repairPath = path.join(dir, `repair-${item.index}.json`);
      const repairPrompt = buildCliItemRepairPrompt(
        topicName,
        blueprint,
        item.verdictComment ?? "품질 기준 미충족",
        repairPath,
        referenceAbsPaths,
        shape,
      );
      const repairRun = await runTrackedEngine({ jobId: job.id, stage: "ITEM_REPAIR", itemIndex: item.index, engine: job.engine, prompt: repairPrompt, dir, filePrefix: `repair-${item.index}-` });
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
      const repairVerifyRun = await runTrackedEngine({ jobId: job.id, stage: "REPAIR_VERIFY", engine: detail.verifyEngine, prompt: repairVerifyPrompt, dir, filePrefix: "repair-verify-" });
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

  return {
    type: "QUESTION_GENERATION",
    items: attachTestedDistinctions(
        finalItems.map((item) => item.ok && item.question.type === "mcq"
          ? { ...item, question: shuffleMcqChoices(item.question) as ImportQuestion }
          : item),
        blueprints,
      ) as GenerationItemDto[],
    verifyWarning: [blueprintWarning, verifyWarning].filter(Boolean).join(" ") || null,
  };
}

type GenerationExecutionResult =
  | QuestionExecutionResult
  | { type: "KEYWORD_TAGGING"; items: KeywordTagItemDto[] };

export async function runGenerationJob(jobId: number): Promise<void> {
  const outcome = await runClaimedJob<GenerationExecutionResult>(jobId, {
    execute: async () => {
      const job = await prisma.job.findUnique({
        where: { id: jobId },
        include: {
          topic: true,
          questionGenerationData: true,
          keywordTaggingData: true,
        },
      });
      if (!job) throw new Error("Generation job not found after claim");
      if (job.type === "QUESTION_GENERATION") return executeQuestionJob(job);
      if (job.type === "KEYWORD_TAGGING") return executeKeywordTagJob(job);
      throw new Error("Unsupported generation job type");
    },
    persistResult: async (tx, result, identity) => {
      if (result.type === "QUESTION_GENERATION") {
        await tx.questionGenerationJobData.update({
          where: { jobId: identity.id },
          data: {
            stage: "SUCCEEDED",
            items: result.items as unknown as Prisma.InputJsonValue,
            verifyWarning: result.verifyWarning,
          },
        });
        return;
      }
      await tx.keywordTaggingJobData.update({
        where: { jobId: identity.id },
        data: { items: result.items as unknown as Prisma.InputJsonValue },
      });
    },
  });

  if (outcome === "FAILED") {
    await prisma.questionGenerationJobData.updateMany({
      where: { jobId, job: { status: "FAILED" } },
      data: { stage: "FAILED" },
    });
  }
}

function jobItems(job: GenerationJobRecord): GenerationItemDto[] {
  return (job.questionGenerationData?.items as unknown as GenerationItemDto[] | null) ?? [];
}

export async function createItemRevision(input: {
  jobId: number;
  itemIndex: number;
  engine: GenerationEngineDto;
  instructions: string;
}): Promise<{ job: GenerationJobDto; revisionJobId: number }> {
  const parent = await prisma.job.findFirst({
    where: { id: input.jobId, type: "QUESTION_GENERATION" },
    include: generationJobInclude,
  });
  if (!parent) throw new ServiceError("JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다", 404);
  if (parent.status !== "SUCCEEDED" || parent.questionGenerationData?.approvedAt) {
    throw new ServiceError("JOB_NOT_REVISIONABLE", "저장 전 완료된 문제 생성 작업만 재검증할 수 있습니다", 409);
  }
  const item = jobItems(parent).find((candidate) => candidate.index === input.itemIndex);
  if (!item || !item.ok) {
    throw new ServiceError("ITEM_NOT_FOUND", "재검증할 문제를 찾을 수 없습니다", 404);
  }
  const revision = await createPendingJob(
    {
      type: "GENERATION_ITEM_REVISION",
      engine: input.engine,
      target: { parentJobId: parent.id },
      detail: {
        type: "GENERATION_ITEM_REVISION",
        data: { itemIndex: input.itemIndex, instructions: input.instructions },
      },
    },
    {
      resolveExisting: async (tx) => {
        const lockedParent = await tx.job.findUnique({
          where: { id: parent.id },
          include: { questionGenerationData: true },
        });
        if (
          !lockedParent ||
          lockedParent.status !== "SUCCEEDED" ||
          lockedParent.questionGenerationData?.approvedAt
        ) {
          throw new ServiceError("JOB_NOT_REVISIONABLE", "저장 전 완료된 문제 생성 작업만 재검증할 수 있습니다", 409);
        }
        const active = await tx.job.findFirst({
          where: {
            parentJobId: parent.id,
            type: "GENERATION_ITEM_REVISION",
            status: { in: ["PENDING", "RUNNING"] },
            generationItemRevisionData: { is: { itemIndex: input.itemIndex } },
          },
        });
        if (active) {
          throw new ServiceError("REVISION_RUNNING", "이 문제의 AI 재검증이 진행 중입니다", 409);
        }
        return null;
      },
    },
  );
  return { job: await getJob(parent.id), revisionJobId: revision.id };
}

type ItemRevisionExecutionResult = {
  verdict: "PASS" | "FAIL";
  comment: string;
  proposedQuestion: ImportQuestion;
};

async function executeItemRevisionJob(jobId: number): Promise<ItemRevisionExecutionResult> {
  const revision = await prisma.job.findFirst({
    where: { id: jobId, type: "GENERATION_ITEM_REVISION" },
    include: {
      generationItemRevisionData: true,
      parentJob: {
        include: {
          topic: true,
          questionGenerationData: true,
          childJobs: {
            where: { type: "GENERATION_ITEM_REVISION" },
            include: { generationItemRevisionData: true },
            orderBy: { id: "asc" },
          },
        },
      },
    },
  });
  const detail = revision?.generationItemRevisionData;
  const parent = revision?.parentJob;
  if (!revision || !detail || !parent?.topic || !parent.questionGenerationData) {
    throw new Error("Generation item revision data is missing");
  }
  if (parent.questionGenerationData.approvedAt) {
    throw new Error("Approved generation jobs cannot be revised");
  }
  const item = ((parent.questionGenerationData.items as unknown as GenerationItemDto[] | null) ?? [])
    .find((candidate) => candidate.index === detail.itemIndex);
  if (!item?.ok) throw new Error("Revision source item is missing");
  const selected = parent.childJobs
    .filter((candidate) =>
      candidate.id !== revision.id &&
      candidate.status === "SUCCEEDED" &&
      candidate.generationItemRevisionData?.itemIndex === detail.itemIndex &&
      candidate.generationItemRevisionData.selectedAt,
    )
    .at(-1);
  const question = (selected?.generationItemRevisionData?.proposedQuestion ?? item.question) as ImportQuestion;
  const referenceFiles = await resolveReferenceFiles(
    parent.topic.referenceDir,
    normalizeStringArray(parent.questionGenerationData.referenceFiles),
  );
  const shape = jobQuestionShape(parent);
  const dir = jobOutputDir(revision.id);
  const resultPath = path.join(dir, "result.json");
  const prompt = buildCliRevisionPrompt(
    parent.topic.name,
    question,
    detail.instructions,
    resultPath,
    referenceFiles,
    undefined,
    shape,
    item.verdictComment,
  );
  const run = await runTrackedEngine({ jobId: revision.id, stage: "MANUAL_ITEM_REVISION", itemIndex: detail.itemIndex, engine: revision.engine, prompt, dir });
  if (!run.ok) {
    throw new Error(run.failureReason);
  }
  const parsed = parseRevisionJson(extractJsonObject(run.resultText));
  if (!parsed.ok) {
    await failTrackedRun(run.runLogId, parsed.fatal);
    throw new Error(parsed.fatal);
  }
  const validated = shape ? validateGeneratedQuestions([parsed.question], shape)[0] : null;
  if (validated && !validated.ok) {
    await failTrackedRun(run.runLogId, validated.errors.join(" "));
    throw new Error(validated.errors.join(" "));
  }
  await completeTrackedRun(run.runLogId);
  return {
    verdict: parsed.verdict === "pass" ? "PASS" : "FAIL",
    comment: parsed.comment,
    proposedQuestion: parsed.question,
  };
}

export async function runGenerationItemRevisionJob(jobId: number): Promise<void> {
  await runClaimedJob(jobId, {
    execute: async () => executeItemRevisionJob(jobId),
    persistResult: async (tx, result, identity) => {
      await tx.generationItemRevisionJobData.update({
        where: { jobId: identity.id },
        data: {
          verdict: result.verdict,
          comment: result.comment,
          proposedQuestion: result.proposedQuestion as unknown as Prisma.InputJsonValue,
        },
      });
    },
  });
}

export async function setItemRevisionUsage(jobId: number, itemIndex: number, useRevision: boolean): Promise<GenerationJobDto> {
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM job WHERE id = ${jobId} FOR UPDATE`;
    const job = await tx.job.findFirst({
      where: { id: jobId, type: "QUESTION_GENERATION" },
      include: { questionGenerationData: true },
    });
    if (!job) throw new ServiceError("JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다", 404);
    if (job.questionGenerationData?.approvedAt) {
      throw new ServiceError("JOB_APPROVED", "저장된 작업의 수정본은 바꿀 수 없습니다", 409);
    }
    await tx.generationItemRevisionJobData.updateMany({
      where: {
        itemIndex,
        job: { parentJobId: jobId, type: "GENERATION_ITEM_REVISION" },
      },
      data: { selectedAt: null },
    });
    if (!useRevision) return;
    const revision = await tx.job.findFirst({
      where: {
        parentJobId: jobId,
        type: "GENERATION_ITEM_REVISION",
        status: "SUCCEEDED",
        generationItemRevisionData: {
          is: { itemIndex, proposedQuestion: { not: Prisma.JsonNull } },
        },
      },
      include: { generationItemRevisionData: true },
      orderBy: { id: "desc" },
    });
    if (!revision?.generationItemRevisionData?.proposedQuestion) {
      throw new ServiceError("REVISION_NOT_READY", "적용할 AI 수정본이 없습니다", 409);
    }
    await tx.generationItemRevisionJobData.update({
      where: { jobId: revision.id },
      data: { selectedAt: new Date() },
    });
  });
  return getJob(jobId);
}

export async function getJob(id: number): Promise<GenerationJobDto> {
  await recoverStaleJobs();
  const job = await prisma.job.findFirst({
    where: { id, type: { in: ["QUESTION_GENERATION", "KEYWORD_TAGGING"] } },
    include: generationJobInclude,
  });
  if (!job) {
    throw new ServiceError("JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다", 404);
  }
  return toDto(job);
}

function questionPayload(question: ImportQuestion): Prisma.InputJsonValue {
  if (question.type === "mcq") {
    return {
      question: question.question,
      choices: question.choices,
      ...(question.answer_indices
        ? { answer_indices: question.answer_indices }
        : { answer_index: question.answer_index }),
      ...(question.choice_explanations
        ? { choice_explanations: question.choice_explanations }
        : {}),
    };
  }
  return {
    text: question.text,
    blanks: question.blanks,
    distractors: question.distractors,
  };
}

async function importQuestionsInTransaction(
  tx: Prisma.TransactionClient,
  topicId: number,
  items: ImportQuestionInput[],
): Promise<void> {
  for (const { question, testedDistinction } of items) {
    const created = await tx.question.create({
      data: {
        topicId,
        type: question.type === "mcq" ? "MCQ" : "CLOZE",
        payload: questionPayload(question),
        explanation: question.explanation?.trim() || null,
        testedDistinction: testedDistinction?.trim() || null,
      },
      select: { id: true },
    });
    await tx.srsState.create({ data: { questionId: created.id } });
    if (question.keywords?.length) {
      await attachKeywords(tx, created.id, question.keywords);
    }
  }
}

export async function approveJob(
  id: number,
  indices: number[],
): Promise<{ savedCount: number; job: GenerationJobDto }> {
  const savedCount = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM job WHERE id = ${id} FOR UPDATE`;
    const job = await tx.job.findFirst({
      where: { id, type: { in: ["QUESTION_GENERATION", "KEYWORD_TAGGING"] } },
      include: generationJobInclude,
    });
    if (!job) throw new ServiceError("JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다", 404);
    if (job.status !== "SUCCEEDED") {
      throw new ServiceError("JOB_NOT_APPROVABLE", "완료된 작업만 저장할 수 있습니다", 409);
    }
    const activeRevision = await tx.job.findFirst({
      where: {
        parentJobId: id,
        type: "GENERATION_ITEM_REVISION",
        status: { in: ["PENDING", "RUNNING"] },
      },
    });
    if (activeRevision) {
      throw new ServiceError("REVISION_RUNNING", "AI 재검증이 끝난 뒤 저장해 주세요", 409);
    }

    if (job.type === "KEYWORD_TAGGING") {
      const items = (job.keywordTaggingData?.items as unknown as KeywordTagItemDto[] | null) ?? [];
      const byId = new Map(items.map((item) => [item.id, item]));
      const picked = indices.map((itemId) => byId.get(itemId));
      if (picked.length === 0 || picked.some((item) => !item)) {
        throw new ServiceError("INVALID_ITEMS", "저장할 수 없는 항목이 포함되어 있습니다", 400);
      }
      const existingIds = new Set((await tx.question.findMany({
        where: { id: { in: indices } },
        select: { id: true },
      })).map((question) => question.id));
      let applied = 0;
      for (const item of picked) {
        if (!item || !existingIds.has(item.id)) continue;
        await attachKeywords(tx, item.id, item.keywords);
        applied += 1;
      }
      await tx.keywordTaggingJobData.update({
        where: { jobId: id },
        data: { approvedAt: new Date(), savedCount: { increment: applied } },
      });
      return applied;
    }

    const items = (job.questionGenerationData?.items as unknown as GenerationItemDto[] | null) ?? [];
    const byIndex = new Map(items.map((item) => [item.index, item]));
    const revisions = await tx.job.findMany({
      where: {
        parentJobId: id,
        type: "GENERATION_ITEM_REVISION",
        status: "SUCCEEDED",
        generationItemRevisionData: { is: { selectedAt: { not: null } } },
      },
      include: { generationItemRevisionData: true },
      orderBy: { id: "asc" },
    });
    const selectedByIndex = new Map<number, Prisma.JsonValue>();
    for (const revision of revisions) {
      const detail = revision.generationItemRevisionData;
      if (detail?.proposedQuestion) {
        selectedByIndex.set(detail.itemIndex, detail.proposedQuestion);
      }
    }
    const questions: ImportQuestionInput[] = [];
    for (const index of indices) {
      const item = byIndex.get(index);
      const selectedQuestion = selectedByIndex.get(index);
      if (!item?.ok || (item.verdict === "fail" && !selectedQuestion)) {
        throw new ServiceError("INVALID_ITEMS", "저장할 수 없는 항목이 포함되어 있습니다", 400);
      }
      questions.push({
        question: (selectedQuestion ?? item.question) as unknown as ImportQuestion,
        testedDistinction: item.testedDistinction ?? null,
      });
    }
    if (questions.length === 0) {
      throw new ServiceError("INVALID_ITEMS", "저장할 항목이 없습니다", 400);
    }
    await importQuestionsInTransaction(tx, job.topicId as number, questions);
    await tx.questionGenerationJobData.update({
      where: { jobId: id },
      data: { approvedAt: new Date(), savedCount: { increment: questions.length } },
    });
    return questions.length;
  });
  return { savedCount, job: await getJob(id) };
}

export async function deleteJob(id: number): Promise<void> {
  const job = await prisma.job.findFirst({
    where: { id, type: { in: ["QUESTION_GENERATION", "KEYWORD_TAGGING"] } },
  });
  if (!job) {
    throw new ServiceError("JOB_NOT_FOUND", "생성 작업을 찾을 수 없습니다", 404);
  }
  if (job.status === "PENDING" || job.status === "RUNNING") {
    throw new ServiceError(
      "JOB_RUNNING",
      "진행 중인 작업은 삭제할 수 없습니다",
      409,
    );
  }

  await prisma.job.delete({ where: { id } });
  await rm(jobOutputDir(id), { recursive: true, force: true }).catch(() => {
    // 출력 디렉터리 정리는 best-effort로 처리한다.
  });
}

export async function listJobs(): Promise<GenerationJobSummaryDto[]> {
  const jobs = await prisma.job.findMany({
    where: {
      OR: [
        { type: "QUESTION_GENERATION", questionGenerationData: { is: { approvedAt: null } } },
        { type: "KEYWORD_TAGGING", keywordTaggingData: { is: { approvedAt: null } } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { ...generationJobInclude, topic: { select: { name: true } } },
  });
  return jobs.map(toSummaryDto);
}
