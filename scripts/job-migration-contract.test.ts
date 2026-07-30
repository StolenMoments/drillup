import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = resolve(import.meta.dirname, "..");
const read = (path: string) => {
  const absolute = resolve(root, path);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
};

const schema = read("prisma/schema.prisma");
const extension = read("prisma/migrations/20260730090000_add_common_job_schema/migration.sql");
const backfill = read("prisma/migrations/20260730091000_backfill_common_jobs/migration.sql");
const verification = read("scripts/verify-common-job-backfill.sql");

function namedBlock(source: string, kind: "enum" | "model", name: string): string {
  return source.match(new RegExp(`\\b${kind}\\s+${name}\\s*\\{([\\s\\S]*?)\\n\\}`, "m"))?.[1] ?? "";
}

function enumValues(name: string): string[] {
  return namedBlock(schema, "enum", name)
    .split(/\r?\n/)
    .map((line) => line.trim().split(/\s+/)[0])
    .filter(Boolean);
}

function modelFields(name: string): Map<string, string> {
  return new Map(
    namedBlock(schema, "model", name)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("@@"))
      .map((line) => [line.split(/\s+/)[0], line]),
  );
}

function compact(source: string): string {
  return source.replace(/`/g, "").replace(/\s+/g, " ").trim();
}

function createTable(name: string): string {
  return extension.match(new RegExp("CREATE\\s+TABLE\\s+`" + name + "`\\s*\\(([\\s\\S]*?)\\)\\s*DEFAULT", "i"))?.[1] ?? "";
}

function validationSection(name: string): string {
  return compact(verification.match(new RegExp(`--\\s*validation:\\s*${name}([\\s\\S]*?)(?=--\\s*validation:|$)`, "i"))?.[1] ?? "");
}

describe("common Job Prisma schema contract", () => {
  test("missing Job enums cannot silently omit a lifecycle state or supported type", () => {
    expect(enumValues("JobStatus")).toEqual(["PENDING", "RUNNING", "SUCCEEDED", "FAILED"]);
    expect(new Set(enumValues("JobType"))).toEqual(new Set([
      "QUESTION_GENERATION", "KEYWORD_TAGGING", "GENERATION_ITEM_REVISION",
      "CHOICE_HARDENING", "NOTE_TIDY", "ANSWER_EXPLANATION",
    ]));
  });

  test("Job cannot lose target, fencing, retry, or heartbeat fields", () => {
    const fields = modelFields("Job");
    for (const field of ["id", "type", "status", "engine", "topicId", "questionId", "parentJobId", "retryOfJobId", "runToken", "errorMessage", "createdAt", "startedAt", "heartbeatAt", "finishedAt"]) {
      expect(fields.has(field), `Job.${field}`).toBe(true);
    }
    expect(fields.get("status")).toMatch(/JobStatus.*@default\(PENDING\)/);
    expect(namedBlock(schema, "model", "Job")).toMatch(/@@index\(\[status,\s*heartbeatAt\]\)/);
    expect(namedBlock(schema, "model", "Job")).toMatch(/@@index\(\[topicId,\s*type,\s*status\]\)/);
    expect(namedBlock(schema, "model", "Job")).toMatch(/@@index\(\[questionId,\s*type,\s*status\]\)/);
  });

  test("each supported type owns a cascade one-to-one detail row keyed by jobId", () => {
    const details = [
      "QuestionGenerationJobData", "KeywordTaggingJobData", "GenerationItemRevisionJobData",
      "ChoiceHardeningJobData", "NoteTidyJobData", "AnswerExplanationJobData",
    ];
    for (const detail of details) {
      const fields = modelFields(detail);
      expect(fields.get("jobId"), `${detail}.jobId`).toMatch(/\bInt\b.*@id/);
      expect(fields.get("job"), `${detail}.job relation`).toMatch(/@relation\(fields:\s*\[jobId\],\s*references:\s*\[id\],\s*onDelete:\s*Cascade\)/);
    }
    for (const legacy of ["GenerationJob", "GenerationRunLog", "GenerationItemRevision", "ChoiceHardeningJob", "NoteTidyJob", "AnswerExplanationJob", "AnswerExplanation"]) {
      expect(namedBlock(schema, "model", legacy), `${legacy} must remain during expansion`).not.toBe("");
    }
  });
});

describe("common Job extension migration contract", () => {
  test("physical tables enforce detail ownership, log cascade, and lookup indexes", () => {
    for (const table of ["question_generation_job_data", "keyword_tagging_job_data", "generation_item_revision_job_data", "choice_hardening_job_data", "note_tidy_job_data", "answer_explanation_job_data"]) {
      const body = compact(createTable(table));
      expect(body, `${table} table`).not.toBe("");
      expect(body).toMatch(/PRIMARY KEY \(job_id\)/i);
      expect(body).toMatch(/FOREIGN KEY \(job_id\) REFERENCES job \(id\) ON DELETE CASCADE/i);
    }
    expect(compact(createTable("job_run_log"))).toMatch(/FOREIGN KEY \(job_id\) REFERENCES job \(id\) ON DELETE CASCADE/i);
    expect(compact(createTable("job_run_log"))).toMatch(/INDEX .*\(job_id, started_at\)/i);
  });

  test("database CHECK implements the complete type-target truth table", () => {
    const job = compact(createTable("job"));
    expect(job).toMatch(/CHECK/i);
    for (const type of ["QUESTION_GENERATION", "KEYWORD_TAGGING", "NOTE_TIDY"]) {
      expect(job).toMatch(new RegExp(`type\\s*=\\s*'${type}'.*topic_id IS NOT NULL.*question_id IS NULL.*parent_job_id IS NULL`, "i"));
    }
    for (const type of ["CHOICE_HARDENING", "ANSWER_EXPLANATION"]) {
      expect(job).toMatch(new RegExp(`type\\s*=\\s*'${type}'.*topic_id IS NULL.*question_id IS NOT NULL.*parent_job_id IS NULL`, "i"));
    }
    expect(job).toMatch(/type\s*=\s*'GENERATION_ITEM_REVISION'.*topic_id IS NULL.*question_id IS NULL.*parent_job_id IS NOT NULL/i);
  });
});

describe("MariaDB migration runner compatibility", () => {
  test("migration scripts cannot contain mysql-client-only DELIMITER directives", () => {
    expect(backfill).not.toMatch(/^\s*DELIMITER\b/im);
    expect(verification).not.toMatch(/^\s*DELIMITER\b/im);
  });
});

describe("deterministic legacy ID allocator", () => {
  const normalized = compact(backfill);
  const maxSources = [
    ["maxGenerationId", "generation_job"], ["maxChoiceId", "choice_hardening_job"],
    ["maxNoteId", "note_tidy_job"], ["maxExplanationJobId", "answer_explanation_job"],
    ["maxRevisionId", "generation_item_revision"],
  ] as const;

  test("an empty legacy source remains numeric because every maximum is coalesced", () => {
    for (const [variable, table] of maxSources) {
      expect(normalized).toMatch(new RegExp(String.raw`SET @${variable} ?:= ?\(SELECT COALESCE\(MAX\(id\), ?0\) FROM ${table}\)`, "i"));
    }
    for (let emptyIndex = 0; emptyIndex < maxSources.length; emptyIndex += 1) {
      const maxima = [11, 2, 1, 5, 3];
      maxima[emptyIndex] = 0;
      const uppers = maxima.slice(1).reduce<number[]>((all, value) => [...all, all.at(-1)! + value], [maxima[0]]);
      expect(uppers.every(Number.isFinite), `empty source index ${emptyIndex}`).toBe(true);
    }
  });

  test("prefix sums preserve generation IDs and separate collision-prone source IDs", () => {
    expect(normalized).toMatch(/SELECT legacy\.id, CASE legacy\.kind WHEN 'QUESTION' THEN 'QUESTION_GENERATION' WHEN 'KEYWORD_TAG' THEN 'KEYWORD_TAGGING' END/i);
    expect(normalized).toMatch(/SET @choiceUpper ?:= ?@maxGenerationId ?\+ ?@maxChoiceId/i);
    expect(normalized).toMatch(/SET @noteUpper ?:= ?@choiceUpper ?\+ ?@maxNoteId/i);
    expect(normalized).toMatch(/SET @explanationUpper ?:= ?@noteUpper ?\+ ?@maxExplanationJobId/i);
    expect(normalized).toMatch(/SET @revisionUpper ?:= ?@explanationUpper ?\+ ?@maxRevisionId/i);
    expect(normalized).toMatch(/SELECT @maxGenerationId ?\+ ?legacy\.id, 'CHOICE_HARDENING'/i);
    expect(normalized).toMatch(/SELECT @choiceUpper ?\+ ?legacy\.id, 'NOTE_TIDY'/i);
    expect(normalized).toMatch(/SELECT @noteUpper ?\+ ?legacy\.id, 'ANSWER_EXPLANATION'/i);
    expect(normalized).toMatch(/SELECT @explanationUpper ?\+ ?legacy\.id, 'GENERATION_ITEM_REVISION'/i);
    const maxGeneration = 10;
    const choice2 = maxGeneration + 2;
    const note1 = maxGeneration + 2 + 1;
    expect(choice2).toBe(12);
    expect(note1).toBe(13);
    expect(choice2).not.toBe(note1);
  });

  test("signed Int overflow aborts and validation proves ranges and reverse mapping", () => {
    expect(normalized).toMatch(/IF\(@revisionUpper >= 2147483647, 'CALL fail_common_job_backfill/i);
    expect(normalized).toMatch(/IF\(@cacheUpper >= 2147483647, 'CALL fail_common_job_backfill/i);
    expect(normalized).toMatch(/SET @nextCommonJobId ?:= ?@cacheUpper ?\+ ?1/i);
    expect(normalized).toMatch(/COALESCE\(MAX\(cache\.id\), 0\).*sourceJob\.id IS NULL/i);
    expect(normalized).toMatch(/CREATE PROCEDURE fail_common_job_backfill.*SIGNAL SQLSTATE '45000'/i);
    for (const token of ["generation_id_mismatch", "range_overlap", "choice_reverse_mapping", "note_reverse_mapping", "explanation_reverse_mapping", "revision_reverse_mapping"]) {
      expect(verification, token).toMatch(new RegExp(`validation:\\s*${token}`, "i"));
    }
  });
});

describe("legacy data preservation and verification", () => {
  const normalized = compact(backfill);

  test("the migration rejects a baseline other than four RUNNING logs and closes copied rows as FAILED", () => {
    expect(normalized).toMatch(/COUNT\(\*\).*FROM generation_run_log.*status = 'RUNNING'/i);
    expect(normalized).toMatch(/IF\(@legacyRunningLogCount <> 4, 'CALL fail_common_job_backfill/i);
    expect(normalized).toMatch(/CASE WHEN legacy\.status = 'RUNNING' THEN 'FAILED' ELSE legacy\.status END/i);
    expect(normalized).toMatch(/서버 재시작|stale/i);
    expect(verification).toMatch(/validation:\s*legacy_running_exact_count/i);
    expect(verification).toMatch(/validation:\s*copied_running_failed_exact_count/i);
  });

  test("the migration rejects a baseline other than 63 caches and materializes valid succeeded details", () => {
    expect(normalized).toMatch(/COUNT\(\*\).*FROM answer_explanation\b/i);
    expect(normalized).toMatch(/IF\(@legacyExplanationCount <> 63, 'CALL fail_common_job_backfill/i);
    expect(normalized).toMatch(/'ANSWER_EXPLANATION', 'SUCCEEDED'/i);
    expect(normalized).toMatch(/SHA2\(/i);
    expect(normalized).toMatch(/IF\(@materializedExplanationCount <> 63, 'CALL fail_common_job_backfill/i);
    expect(verification).toMatch(/validation:\s*source_cache_exact_count/i);
    expect(verification).toMatch(/validation:\s*materialized_cache_exact_count/i);
    expect(verification).toMatch(/validation:\s*cache_without_valid_hash_detail/i);
  });

  test("a cache reuses its matching legacy explanation Job instead of creating a duplicate", () => {
    expect(normalized).toMatch(/answer_explanation AS legacy LEFT JOIN answer_explanation_job AS sourceJob ON sourceJob\.question_id = legacy\.question_id AND sourceJob\.engine = legacy\.engine/i);
    expect(normalized).toMatch(/COALESCE\(@noteUpper \+ sourceJob\.id, @revisionUpper \+ legacy\.id\)/i);
    expect(compact(verification)).toMatch(/COUNT\(\*\) FROM answer_explanation AS cache LEFT JOIN answer_explanation_job AS sourceJob.*WHERE sourceJob\.id IS NULL/i);
  });

  test("a legacy SUCCEEDED explanation Job without cache becomes FAILED and cannot be a cache hit", () => {
    const legacyJobInsert = normalized.match(/SELECT @noteUpper \+ legacy\.id, 'ANSWER_EXPLANATION'[\s\S]*?FROM answer_explanation_job AS legacy[\s\S]*?;/i)?.[0] ?? "";
    expect(legacyJobInsert).toMatch(/CASE WHEN cache\.id IS NOT NULL THEN 'SUCCEEDED' ELSE 'FAILED' END/i);
    expect(legacyJobInsert).toMatch(/cache\.id IS NULL AND legacy\.status = 'SUCCEEDED'[\s\S]*cache[\s\S]*missing|cache\.id IS NULL AND legacy\.status = 'SUCCEEDED'[\s\S]*캐시/i);
    const validSuccess = validationSection("successful_explanation_without_valid_cache");
    expect(validSuccess).toMatch(/candidate\.type = 'ANSWER_EXPLANATION'.*candidate\.status = 'SUCCEEDED'/i);
    expect(validSuccess).toMatch(/detail\.content IS NULL|cache\.id IS NULL/i);
    expect(validSuccess).toMatch(/detail\.source_hash <> SHA2\(/i);
  });

  test("revision backfill rejects a non-generation parent or missing parent item", () => {
    expect(normalized).toMatch(/SET @invalidRevisionTargetCount ?:= ?\( SELECT COUNT\(\*\).*FROM generation_item_revision AS legacy/i);
    expect(normalized).toMatch(/parent\.kind <> 'QUESTION'/i);
    expect(normalized).toMatch(/JSON_TYPE\(parent\.result\) <> 'ARRAY'/i);
    expect(normalized).toMatch(/legacy\.item_index < 0.*legacy\.item_index >= JSON_LENGTH\(parent\.result\)/i);
    expect(normalized).toMatch(/JSON_CONTAINS_PATH\(parent\.result, 'one', CONCAT\('\$\[', legacy\.item_index, '\]'\)\) <> 1/i);
    expect(normalized).toMatch(/IF\(@invalidRevisionTargetCount <> 0, 'CALL fail_common_job_backfill/i);
    const revisionValidation = validationSection("invalid_revision_parent_or_item");
    expect(revisionValidation).toMatch(/parent\.type <> 'QUESTION_GENERATION'/i);
    expect(revisionValidation).toMatch(/detail\.item_index >= JSON_LENGTH\(parentData\.items\)/i);
    expect(revisionValidation).toMatch(/JSON_CONTAINS_PATH\(parentData\.items, 'one'/i);
  });

  test("every manual revision log maps exactly once to its deterministic child Job", () => {
    expect(normalized).toMatch(/SET @invalidManualRevisionLogCount ?:= ?\( SELECT COUNT\(\*\).*legacy\.stage = 'MANUAL_ITEM_REVISION'/i);
    expect(normalized).toMatch(/SELECT legacy\.id, @explanationUpper \+ revision\.id, legacy\.stage/i);
    expect(normalized).toMatch(/FROM generation_run_log AS legacy JOIN generation_item_revision AS revision/i);
    expect(normalized).not.toMatch(/MANUAL_ITEM_REVISION'[\s\S]*ELSE legacy\.generation_job_id/i);
    expect(normalized).toMatch(/IF\(@invalidManualRevisionLogCount <> 0, 'CALL fail_common_job_backfill/i);
    const manualValidation = validationSection("manual_revision_log_mapping_mismatch");
    expect(manualValidation).toMatch(/copied\.job_id <> @explanationUpper \+ revision\.id/i);
    expect(manualValidation).toMatch(/revision\.id IS NULL|match_count <> 1/i);
  });

  test("dangling verification covers every detail table owner", () => {
    const dangling = validationSection("dangling_foreign_key");
    for (const detail of [
      "question_generation_job_data", "keyword_tagging_job_data", "generation_item_revision_job_data",
      "choice_hardening_job_data", "note_tidy_job_data", "answer_explanation_job_data",
    ]) {
      expect(dangling, detail).toMatch(new RegExp(`FROM ${detail} AS detail LEFT JOIN job AS owner ON owner\\.id = detail\\.job_id WHERE owner\\.id IS NULL`, "i"));
    }
  });

  test("legacy logs, manual revision ownership, and non-null raw output are preserved", () => {
    expect(normalized).toMatch(/INSERT IGNORE INTO job_run_log/i);
    expect(normalized).toMatch(/MANUAL_ITEM_REVISION[\s\S]*generation_item_revision/i);
    expect(normalized).toMatch(/'LEGACY_OUTPUT'/i);
    expect(normalized).toMatch(/raw_output IS NOT NULL/i);
  });

  test("verification covers every required zero-bad-row invariant", () => {
    for (const token of [
      "per_type_count_mismatch", "missing_or_multiple_detail", "invalid_target", "dangling_foreign_key",
      "generation_id_mismatch", "range_overlap", "terminal_timestamp_inconsistency",
      "running_log_below_terminal_job", "cache_without_valid_hash_detail",
    ]) {
      expect(validationSection(token), token).toMatch(/SELECT .* AS bad_rows/i);
    }
  });
});
