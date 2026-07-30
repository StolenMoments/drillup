-- Deterministic source ranges. Every source MAX is numeric even when empty.
SET @maxGenerationId := (SELECT COALESCE(MAX(id), 0) FROM `generation_job`);
SET @maxChoiceId := (SELECT COALESCE(MAX(id), 0) FROM `choice_hardening_job`);
SET @maxNoteId := (SELECT COALESCE(MAX(id), 0) FROM `note_tidy_job`);
SET @maxExplanationJobId := (SELECT COALESCE(MAX(id), 0) FROM `answer_explanation_job`);
SET @maxRevisionId := (SELECT COALESCE(MAX(id), 0) FROM `generation_item_revision`);
SET @maxExplanationCacheId := (SELECT COALESCE(MAX(id), 0) FROM `answer_explanation`);

SET @choiceUpper := @maxGenerationId + @maxChoiceId;
SET @noteUpper := @choiceUpper + @maxNoteId;
SET @explanationUpper := @noteUpper + @maxExplanationJobId;
SET @revisionUpper := @explanationUpper + @maxRevisionId;
SET @cacheUpper := @revisionUpper + @maxExplanationCacheId;

SET @legacyRunningLogCount := (
    SELECT COUNT(*) FROM `generation_run_log` WHERE `status` = 'RUNNING'
);
SET @legacyExplanationCount := (SELECT COUNT(*) FROM `answer_explanation`);

DROP PROCEDURE IF EXISTS `fail_common_job_backfill`;
CREATE PROCEDURE `fail_common_job_backfill`(IN assertionMessage VARCHAR(255))
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = assertionMessage;

SET @assertionSql := IF(@revisionUpper > 2147483647,
    'CALL fail_common_job_backfill(''common Job deterministic ID range exceeds signed Int'')', 'DO 0');
PREPARE common_job_assertion FROM @assertionSql;
EXECUTE common_job_assertion;
DEALLOCATE PREPARE common_job_assertion;

SET @assertionSql := IF(@cacheUpper > 2147483647,
    'CALL fail_common_job_backfill(''materialized explanation Job ID range exceeds signed Int'')', 'DO 0');
PREPARE common_job_assertion FROM @assertionSql;
EXECUTE common_job_assertion;
DEALLOCATE PREPARE common_job_assertion;

SET @assertionSql := IF(@legacyRunningLogCount <> 4,
    'CALL fail_common_job_backfill(''expected exactly 4 legacy RUNNING GenerationRunLog rows'')', 'DO 0');
PREPARE common_job_assertion FROM @assertionSql;
EXECUTE common_job_assertion;
DEALLOCATE PREPARE common_job_assertion;

SET @assertionSql := IF(@legacyExplanationCount <> 63,
    'CALL fail_common_job_backfill(''expected exactly 63 legacy AnswerExplanation rows'')', 'DO 0');
PREPARE common_job_assertion FROM @assertionSql;
EXECUTE common_job_assertion;
DEALLOCATE PREPARE common_job_assertion;

START TRANSACTION;

-- GenerationJob IDs are the public global IDs and therefore remain unchanged.
INSERT IGNORE INTO `job`
    (`id`, `type`, `status`, `engine`, `topic_id`, `error_message`, `created_at`, `started_at`, `finished_at`)
SELECT legacy.id,
       CASE legacy.kind WHEN 'QUESTION' THEN 'QUESTION_GENERATION' WHEN 'KEYWORD_TAG' THEN 'KEYWORD_TAGGING' END,
       CASE WHEN legacy.status = 'SUCCEEDED' THEN 'SUCCEEDED' ELSE 'FAILED' END,
       legacy.engine,
       legacy.topic_id,
       CASE
           WHEN legacy.status IN ('RUNNING', 'VERIFYING') THEN COALESCE(legacy.error_message, '레거시 실행이 배포 시점에 중단되어 FAILED로 이관되었습니다')
           ELSE legacy.error_message
       END,
       legacy.created_at,
       CASE WHEN legacy.status IN ('RUNNING', 'VERIFYING') THEN legacy.created_at ELSE NULL END,
       CASE WHEN legacy.status IN ('RUNNING', 'VERIFYING') THEN COALESCE(legacy.finished_at, CURRENT_TIMESTAMP(3)) ELSE COALESCE(legacy.finished_at, legacy.created_at) END
FROM `generation_job` AS legacy;

INSERT IGNORE INTO `question_generation_job_data`
    (`job_id`, `verify_engine`, `instructions`, `reference_files`, `correct_answer_count`, `choice_count`, `source_question_ids`, `stage`, `items`, `verify_warning`, `approved_at`, `saved_count`)
SELECT legacy.id, legacy.verify_engine, legacy.instructions, legacy.reference_files,
       legacy.correct_answer_count, legacy.choice_count, legacy.source_question_ids,
       legacy.status, legacy.result, legacy.verify_warning, legacy.approved_at, legacy.saved_count
FROM `generation_job` AS legacy
WHERE legacy.kind = 'QUESTION';

INSERT IGNORE INTO `keyword_tagging_job_data`
    (`job_id`, `targets`, `items`, `approved_at`, `saved_count`)
SELECT legacy.id, legacy.source_question_ids, legacy.result, legacy.approved_at, legacy.saved_count
FROM `generation_job` AS legacy
WHERE legacy.kind = 'KEYWORD_TAG';

INSERT IGNORE INTO `job`
    (`id`, `type`, `status`, `engine`, `question_id`, `error_message`, `created_at`, `started_at`, `finished_at`)
SELECT @maxGenerationId + legacy.id, 'CHOICE_HARDENING',
       CASE WHEN legacy.status = 'SUCCEEDED' THEN 'SUCCEEDED' ELSE 'FAILED' END,
       legacy.engine, legacy.question_id,
       CASE WHEN legacy.status = 'RUNNING' THEN COALESCE(legacy.error_message, '레거시 실행이 배포 시점에 중단되어 FAILED로 이관되었습니다') ELSE legacy.error_message END,
       legacy.created_at, legacy.started_at,
       CASE WHEN legacy.status = 'RUNNING' THEN COALESCE(legacy.finished_at, CURRENT_TIMESTAMP(3)) ELSE COALESCE(legacy.finished_at, legacy.created_at) END
FROM `choice_hardening_job` AS legacy;

INSERT IGNORE INTO `choice_hardening_job_data`
    (`job_id`, `source_hash`, `source_payload`, `verify_engine`, `preview`, `applied_at`, `auto_applied`, `dismissed_at`)
SELECT @maxGenerationId + legacy.id, legacy.source_hash, legacy.source_payload,
       legacy.verify_engine, legacy.preview, legacy.applied_at, legacy.auto_applied, legacy.dismissed_at
FROM `choice_hardening_job` AS legacy;

INSERT IGNORE INTO `job`
    (`id`, `type`, `status`, `engine`, `topic_id`, `error_message`, `created_at`, `started_at`, `finished_at`)
SELECT @choiceUpper + legacy.id, 'NOTE_TIDY',
       CASE WHEN legacy.status = 'SUCCEEDED' THEN 'SUCCEEDED' ELSE 'FAILED' END,
       legacy.engine, legacy.topic_id,
       CASE WHEN legacy.status = 'RUNNING' THEN COALESCE(legacy.error_message, '레거시 실행이 배포 시점에 중단되어 FAILED로 이관되었습니다') ELSE legacy.error_message END,
       legacy.created_at, legacy.started_at,
       CASE WHEN legacy.status = 'RUNNING' THEN COALESCE(legacy.finished_at, CURRENT_TIMESTAMP(3)) ELSE COALESCE(legacy.finished_at, legacy.created_at) END
FROM `note_tidy_job` AS legacy;

INSERT IGNORE INTO `note_tidy_job_data`
    (`job_id`, `source_hash`, `preview`, `applied_at`, `dismissed_at`)
SELECT @choiceUpper + legacy.id, legacy.source_hash, legacy.preview, legacy.applied_at, legacy.dismissed_at
FROM `note_tidy_job` AS legacy;

INSERT IGNORE INTO `job`
    (`id`, `type`, `status`, `engine`, `question_id`, `error_message`, `created_at`, `started_at`, `finished_at`)
SELECT @noteUpper + legacy.id, 'ANSWER_EXPLANATION',
       CASE WHEN cache.id IS NOT NULL OR legacy.status = 'SUCCEEDED' THEN 'SUCCEEDED' ELSE 'FAILED' END,
       legacy.engine, legacy.question_id,
       CASE WHEN cache.id IS NOT NULL THEN NULL WHEN legacy.status = 'RUNNING' THEN COALESCE(legacy.error_message, '레거시 실행이 배포 시점에 중단되어 FAILED로 이관되었습니다') ELSE legacy.error_message END,
       legacy.created_at, COALESCE(legacy.started_at, cache.created_at),
       CASE WHEN cache.id IS NOT NULL THEN cache.created_at WHEN legacy.status = 'RUNNING' THEN COALESCE(legacy.finished_at, CURRENT_TIMESTAMP(3)) ELSE COALESCE(legacy.finished_at, legacy.created_at) END
FROM `answer_explanation_job` AS legacy
LEFT JOIN `answer_explanation` AS cache
  ON cache.question_id = legacy.question_id AND cache.engine = legacy.engine;

INSERT IGNORE INTO `answer_explanation_job_data`
    (`job_id`, `source_hash`, `content`, `choice_explanations`, `factual_concern`)
SELECT @noteUpper + legacy.id,
       SHA2(JSON_NORMALIZE(question.payload), 256),
       cache.content, cache.choice_explanations, cache.factual_concern
FROM `answer_explanation_job` AS legacy
JOIN `question` AS question ON question.id = legacy.question_id
LEFT JOIN `answer_explanation` AS cache
  ON cache.question_id = legacy.question_id AND cache.engine = legacy.engine;

INSERT IGNORE INTO `job`
    (`id`, `type`, `status`, `engine`, `parent_job_id`, `error_message`, `created_at`, `started_at`, `finished_at`)
SELECT @explanationUpper + legacy.id, 'GENERATION_ITEM_REVISION',
       CASE WHEN legacy.status = 'SUCCEEDED' THEN 'SUCCEEDED' ELSE 'FAILED' END,
       legacy.engine, legacy.generation_job_id,
       CASE WHEN legacy.status = 'RUNNING' THEN COALESCE(legacy.error_message, '레거시 실행이 배포 시점에 중단되어 FAILED로 이관되었습니다') ELSE legacy.error_message END,
       legacy.created_at,
       CASE WHEN legacy.status = 'RUNNING' THEN legacy.created_at ELSE NULL END,
       CASE WHEN legacy.status = 'RUNNING' THEN COALESCE(legacy.finished_at, CURRENT_TIMESTAMP(3)) ELSE COALESCE(legacy.finished_at, legacy.created_at) END
FROM `generation_item_revision` AS legacy;

INSERT IGNORE INTO `generation_item_revision_job_data`
    (`job_id`, `item_index`, `instructions`, `verdict`, `comment`, `proposed_question`, `selected_at`)
SELECT @explanationUpper + legacy.id, legacy.item_index, legacy.instructions,
       legacy.verdict, legacy.comment, legacy.proposed_question,
       CASE WHEN legacy.applied_question IS NOT NULL THEN COALESCE(legacy.finished_at, legacy.created_at) ELSE NULL END
FROM `generation_item_revision` AS legacy;

-- A cache without a matching legacy Job becomes its own real, pollable SUCCEEDED Job.
INSERT IGNORE INTO `job`
    (`id`, `type`, `status`, `engine`, `question_id`, `created_at`, `started_at`, `heartbeat_at`, `finished_at`)
SELECT @revisionUpper + legacy.id, 'ANSWER_EXPLANATION', 'SUCCEEDED', legacy.engine,
       legacy.question_id, legacy.created_at, legacy.created_at, legacy.created_at, legacy.created_at
FROM `answer_explanation` AS legacy
LEFT JOIN `answer_explanation_job` AS sourceJob
  ON sourceJob.question_id = legacy.question_id AND sourceJob.engine = legacy.engine
WHERE sourceJob.id IS NULL;

INSERT IGNORE INTO `answer_explanation_job_data`
    (`job_id`, `source_hash`, `content`, `choice_explanations`, `factual_concern`)
SELECT @revisionUpper + legacy.id,
       SHA2(JSON_NORMALIZE(question.payload), 256),
       legacy.content, legacy.choice_explanations, legacy.factual_concern
FROM `answer_explanation` AS legacy
JOIN `question` AS question ON question.id = legacy.question_id
LEFT JOIN `answer_explanation_job` AS sourceJob
  ON sourceJob.question_id = legacy.question_id AND sourceJob.engine = legacy.engine
WHERE sourceJob.id IS NULL;

-- Preserve old execution diagnostics. Manual revision runs belong to their child Job.
INSERT IGNORE INTO `job_run_log`
    (`id`, `job_id`, `stage`, `item_index`, `attempt`, `engine`, `model`, `status`, `prompt`, `response`, `stdout_tail`, `stderr_tail`, `error_message`, `exit_code`, `timed_out`, `started_at`, `finished_at`, `duration_ms`)
SELECT legacy.id,
       CASE
           WHEN legacy.stage = 'MANUAL_ITEM_REVISION' AND revision.id IS NOT NULL
               THEN @explanationUpper + revision.id
           ELSE legacy.generation_job_id
       END,
       legacy.stage, legacy.item_index, legacy.attempt, legacy.engine, legacy.model,
       CASE WHEN legacy.status = 'RUNNING' THEN 'FAILED' ELSE legacy.status END,
       legacy.prompt, legacy.response, legacy.stdout_tail, legacy.stderr_tail,
       CASE WHEN legacy.status = 'RUNNING' THEN COALESCE(legacy.error_message, 'stale legacy RUNNING log closed during common Job backfill') ELSE legacy.error_message END,
       legacy.exit_code, legacy.timed_out, legacy.started_at,
       CASE WHEN legacy.status = 'RUNNING' THEN COALESCE(legacy.finished_at, CURRENT_TIMESTAMP(3)) ELSE legacy.finished_at END,
       legacy.duration_ms
FROM `generation_run_log` AS legacy
LEFT JOIN `generation_item_revision` AS revision
  ON legacy.stage = 'MANUAL_ITEM_REVISION'
 AND revision.generation_job_id = legacy.generation_job_id
 AND revision.item_index = legacy.item_index;

INSERT INTO `job_run_log`
    (`job_id`, `stage`, `engine`, `status`, `prompt`, `response`, `started_at`, `finished_at`)
SELECT legacy.id, 'LEGACY_OUTPUT', legacy.engine,
       CASE WHEN legacy.status = 'SUCCEEDED' THEN 'SUCCEEDED' ELSE 'FAILED' END,
       '', legacy.raw_output, legacy.created_at, COALESCE(legacy.finished_at, legacy.created_at)
FROM `generation_job` AS legacy
WHERE legacy.raw_output IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM `job_run_log` AS existing
      WHERE existing.job_id = legacy.id AND existing.stage = 'LEGACY_OUTPUT'
  );

INSERT INTO `job_run_log`
    (`job_id`, `stage`, `item_index`, `engine`, `status`, `prompt`, `response`, `started_at`, `finished_at`)
SELECT @explanationUpper + legacy.id, 'LEGACY_OUTPUT', legacy.item_index, legacy.engine,
       CASE WHEN legacy.status = 'SUCCEEDED' THEN 'SUCCEEDED' ELSE 'FAILED' END,
       '', legacy.raw_output, legacy.created_at, COALESCE(legacy.finished_at, legacy.created_at)
FROM `generation_item_revision` AS legacy
WHERE legacy.raw_output IS NOT NULL
  AND NOT EXISTS (
      SELECT 1 FROM `job_run_log` AS existing
      WHERE existing.job_id = @explanationUpper + legacy.id AND existing.stage = 'LEGACY_OUTPUT'
  );

SET @materializedExplanationCount := (
    SELECT COUNT(*)
    FROM `answer_explanation` AS legacy
    LEFT JOIN `answer_explanation_job` AS sourceJob
      ON sourceJob.question_id = legacy.question_id AND sourceJob.engine = legacy.engine
    JOIN `job` AS materialized ON materialized.id = COALESCE(@noteUpper + sourceJob.id, @revisionUpper + legacy.id)
      AND materialized.type = 'ANSWER_EXPLANATION'
      AND materialized.status = 'SUCCEEDED'
      AND materialized.question_id = legacy.question_id
      AND materialized.engine = legacy.engine
    JOIN `answer_explanation_job_data` AS detail ON detail.job_id = materialized.id
      AND detail.source_hash IS NOT NULL
      AND CHAR_LENGTH(detail.source_hash) = 64
      AND detail.content = legacy.content
);

SET @assertionSql := IF(@materializedExplanationCount <> 63,
    'CALL fail_common_job_backfill(''expected exactly 63 valid materialized explanation Job/detail rows'')', 'DO 0');
PREPARE common_job_assertion FROM @assertionSql;
EXECUTE common_job_assertion;
DEALLOCATE PREPARE common_job_assertion;
COMMIT;
DROP PROCEDURE `fail_common_job_backfill`;

SET @nextCommonJobId := @cacheUpper + 1;
SET @setCommonJobAutoIncrement := CONCAT('ALTER TABLE `job` AUTO_INCREMENT = ', @nextCommonJobId);
PREPARE set_common_job_auto_increment FROM @setCommonJobAutoIncrement;
EXECUTE set_common_job_auto_increment;
DEALLOCATE PREPARE set_common_job_auto_increment;
