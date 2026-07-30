-- Read-only integrity proof for the common Job backfill. Every validation query returns 0.
SET @maxGenerationId := (SELECT COALESCE(MAX(id), 0) FROM `generation_job`);
SET @maxChoiceId := (SELECT COALESCE(MAX(id), 0) FROM `choice_hardening_job`);
SET @maxNoteId := (SELECT COALESCE(MAX(id), 0) FROM `note_tidy_job`);
SET @maxExplanationJobId := (SELECT COALESCE(MAX(id), 0) FROM `answer_explanation_job`);
SET @maxRevisionId := (SELECT COALESCE(MAX(id), 0) FROM `generation_item_revision`);
SET @maxExplanationCacheId := (
    SELECT COALESCE(MAX(cache.id), 0)
    FROM `answer_explanation` AS cache
    LEFT JOIN `answer_explanation_job` AS sourceJob
      ON sourceJob.question_id = cache.question_id AND sourceJob.engine = cache.engine
    WHERE sourceJob.id IS NULL
);
SET @choiceUpper := @maxGenerationId + @maxChoiceId;
SET @noteUpper := @choiceUpper + @maxNoteId;
SET @explanationUpper := @noteUpper + @maxExplanationJobId;
SET @revisionUpper := @explanationUpper + @maxRevisionId;
SET @cacheUpper := @revisionUpper + @maxExplanationCacheId;

-- validation: per_type_count_mismatch
SELECT SUM(mismatch) AS bad_rows
FROM (
    SELECT ABS((SELECT COUNT(*) FROM `job` WHERE `type` = 'QUESTION_GENERATION') -
               (SELECT COUNT(*) FROM `generation_job` WHERE `kind` = 'QUESTION')) AS mismatch
    UNION ALL
    SELECT ABS((SELECT COUNT(*) FROM `job` WHERE `type` = 'KEYWORD_TAGGING') -
               (SELECT COUNT(*) FROM `generation_job` WHERE `kind` = 'KEYWORD_TAG'))
    UNION ALL
    SELECT ABS((SELECT COUNT(*) FROM `job` WHERE `type` = 'CHOICE_HARDENING') -
               (SELECT COUNT(*) FROM `choice_hardening_job`))
    UNION ALL
    SELECT ABS((SELECT COUNT(*) FROM `job` WHERE `type` = 'NOTE_TIDY') -
               (SELECT COUNT(*) FROM `note_tidy_job`))
    UNION ALL
    SELECT ABS((SELECT COUNT(*) FROM `job` WHERE `type` = 'GENERATION_ITEM_REVISION') -
               (SELECT COUNT(*) FROM `generation_item_revision`))
    UNION ALL
    SELECT ABS((SELECT COUNT(*) FROM `job` WHERE `type` = 'ANSWER_EXPLANATION') -
               ((SELECT COUNT(*) FROM `answer_explanation_job`) +
                (SELECT COUNT(*) FROM `answer_explanation` AS cache
                 LEFT JOIN `answer_explanation_job` AS sourceJob
                   ON sourceJob.question_id = cache.question_id AND sourceJob.engine = cache.engine
                 WHERE sourceJob.id IS NULL)))
) AS per_type;

-- validation: missing_or_multiple_detail
SELECT COUNT(*) AS bad_rows
FROM `job` AS candidate
WHERE
    (candidate.type = 'QUESTION_GENERATION') <> (SELECT COUNT(*) FROM `question_generation_job_data` WHERE job_id = candidate.id) OR
    (candidate.type = 'KEYWORD_TAGGING') <> (SELECT COUNT(*) FROM `keyword_tagging_job_data` WHERE job_id = candidate.id) OR
    (candidate.type = 'GENERATION_ITEM_REVISION') <> (SELECT COUNT(*) FROM `generation_item_revision_job_data` WHERE job_id = candidate.id) OR
    (candidate.type = 'CHOICE_HARDENING') <> (SELECT COUNT(*) FROM `choice_hardening_job_data` WHERE job_id = candidate.id) OR
    (candidate.type = 'NOTE_TIDY') <> (SELECT COUNT(*) FROM `note_tidy_job_data` WHERE job_id = candidate.id) OR
    (candidate.type = 'ANSWER_EXPLANATION') <> (SELECT COUNT(*) FROM `answer_explanation_job_data` WHERE job_id = candidate.id);

-- validation: invalid_target
SELECT COUNT(*) AS bad_rows
FROM `job`
WHERE NOT (
    (`type` IN ('QUESTION_GENERATION', 'KEYWORD_TAGGING', 'NOTE_TIDY') AND `topic_id` IS NOT NULL AND `question_id` IS NULL AND `parent_job_id` IS NULL) OR
    (`type` IN ('CHOICE_HARDENING', 'ANSWER_EXPLANATION') AND `topic_id` IS NULL AND `question_id` IS NOT NULL AND `parent_job_id` IS NULL) OR
    (`type` = 'GENERATION_ITEM_REVISION' AND `topic_id` IS NULL AND `question_id` IS NULL AND `parent_job_id` IS NOT NULL)
);

-- validation: dangling_foreign_key
SELECT SUM(bad) AS bad_rows
FROM (
    SELECT COUNT(*) AS bad FROM `job` AS child LEFT JOIN `topic` AS target ON target.id = child.topic_id WHERE child.topic_id IS NOT NULL AND target.id IS NULL
    UNION ALL
    SELECT COUNT(*) FROM `job` AS child LEFT JOIN `question` AS target ON target.id = child.question_id WHERE child.question_id IS NOT NULL AND target.id IS NULL
    UNION ALL
    SELECT COUNT(*) FROM `job` AS child LEFT JOIN `job` AS parent ON parent.id = child.parent_job_id WHERE child.parent_job_id IS NOT NULL AND parent.id IS NULL
    UNION ALL
    SELECT COUNT(*) FROM `job` AS child LEFT JOIN `job` AS original ON original.id = child.retry_of_job_id WHERE child.retry_of_job_id IS NOT NULL AND original.id IS NULL
    UNION ALL
    SELECT COUNT(*) FROM `job_run_log` AS log LEFT JOIN `job` AS owner ON owner.id = log.job_id WHERE owner.id IS NULL
    UNION ALL
    SELECT COUNT(*) FROM `question_generation_job_data` AS detail LEFT JOIN `job` AS owner ON owner.id = detail.job_id WHERE owner.id IS NULL
    UNION ALL
    SELECT COUNT(*) FROM `keyword_tagging_job_data` AS detail LEFT JOIN `job` AS owner ON owner.id = detail.job_id WHERE owner.id IS NULL
    UNION ALL
    SELECT COUNT(*) FROM `generation_item_revision_job_data` AS detail LEFT JOIN `job` AS owner ON owner.id = detail.job_id WHERE owner.id IS NULL
    UNION ALL
    SELECT COUNT(*) FROM `choice_hardening_job_data` AS detail LEFT JOIN `job` AS owner ON owner.id = detail.job_id WHERE owner.id IS NULL
    UNION ALL
    SELECT COUNT(*) FROM `note_tidy_job_data` AS detail LEFT JOIN `job` AS owner ON owner.id = detail.job_id WHERE owner.id IS NULL
    UNION ALL
    SELECT COUNT(*) FROM `answer_explanation_job_data` AS detail LEFT JOIN `job` AS owner ON owner.id = detail.job_id WHERE owner.id IS NULL
) AS dangling;

-- validation: generation_id_mismatch
SELECT COUNT(*) AS bad_rows
FROM `generation_job` AS legacy
LEFT JOIN `job` AS common ON common.id = legacy.id
WHERE common.id IS NULL OR common.type <> CASE legacy.kind WHEN 'QUESTION' THEN 'QUESTION_GENERATION' ELSE 'KEYWORD_TAGGING' END;

-- validation: range_overlap
SELECT COUNT(*) AS bad_rows
FROM (
    SELECT mapped_id FROM (
        SELECT id AS mapped_id FROM `generation_job`
        UNION ALL SELECT @maxGenerationId + id FROM `choice_hardening_job`
        UNION ALL SELECT @choiceUpper + id FROM `note_tidy_job`
        UNION ALL SELECT @noteUpper + id FROM `answer_explanation_job`
        UNION ALL SELECT @explanationUpper + id FROM `generation_item_revision`
        UNION ALL
        SELECT @revisionUpper + cache.id
        FROM `answer_explanation` AS cache
        LEFT JOIN `answer_explanation_job` AS sourceJob
          ON sourceJob.question_id = cache.question_id AND sourceJob.engine = cache.engine
        WHERE sourceJob.id IS NULL
    ) AS allocated
    GROUP BY mapped_id
    HAVING COUNT(*) > 1
) AS collisions;

-- validation: choice_reverse_mapping
SELECT COUNT(*) AS bad_rows
FROM `choice_hardening_job` AS legacy
LEFT JOIN `job` AS common ON common.id = @maxGenerationId + legacy.id
WHERE common.id IS NULL OR common.id - @maxGenerationId <> legacy.id OR common.type <> 'CHOICE_HARDENING';

-- validation: note_reverse_mapping
SELECT COUNT(*) AS bad_rows
FROM `note_tidy_job` AS legacy
LEFT JOIN `job` AS common ON common.id = @choiceUpper + legacy.id
WHERE common.id IS NULL OR common.id - @choiceUpper <> legacy.id OR common.type <> 'NOTE_TIDY';

-- validation: explanation_reverse_mapping
SELECT COUNT(*) AS bad_rows
FROM `answer_explanation_job` AS legacy
LEFT JOIN `job` AS common ON common.id = @noteUpper + legacy.id
WHERE common.id IS NULL OR common.id - @noteUpper <> legacy.id OR common.type <> 'ANSWER_EXPLANATION';

-- validation: revision_reverse_mapping
SELECT COUNT(*) AS bad_rows
FROM `generation_item_revision` AS legacy
LEFT JOIN `job` AS common ON common.id = @explanationUpper + legacy.id
WHERE common.id IS NULL OR common.id - @explanationUpper <> legacy.id OR common.type <> 'GENERATION_ITEM_REVISION';

-- validation: terminal_timestamp_inconsistency
SELECT COUNT(*) AS bad_rows
FROM `job`
WHERE (`status` IN ('SUCCEEDED', 'FAILED') AND `finished_at` IS NULL)
   OR (`status` IN ('PENDING', 'RUNNING') AND `finished_at` IS NOT NULL)
   OR (`status` = 'PENDING' AND (`started_at` IS NOT NULL OR `heartbeat_at` IS NOT NULL));

-- validation: running_log_below_terminal_job
SELECT COUNT(*) AS bad_rows
FROM `job_run_log` AS log
JOIN `job` AS owner ON owner.id = log.job_id
WHERE owner.status IN ('SUCCEEDED', 'FAILED') AND log.status = 'RUNNING';

-- validation: cache_without_valid_hash_detail
SELECT COUNT(*) AS bad_rows
FROM `answer_explanation` AS legacy
LEFT JOIN `answer_explanation_job` AS sourceJob
  ON sourceJob.question_id = legacy.question_id AND sourceJob.engine = legacy.engine
LEFT JOIN `job` AS materialized ON materialized.id = COALESCE(@noteUpper + sourceJob.id, @revisionUpper + legacy.id)
LEFT JOIN `answer_explanation_job_data` AS detail ON detail.job_id = materialized.id
LEFT JOIN `question` AS question ON question.id = legacy.question_id
WHERE materialized.id IS NULL
   OR materialized.type <> 'ANSWER_EXPLANATION'
   OR materialized.status <> 'SUCCEEDED'
   OR materialized.question_id <> legacy.question_id
   OR materialized.engine <> legacy.engine
   OR detail.job_id IS NULL
   OR detail.source_hash IS NULL
   OR CHAR_LENGTH(detail.source_hash) <> 64
   OR detail.source_hash <> SHA2(JSON_NORMALIZE(question.payload), 256)
   OR detail.content <> legacy.content
   OR detail.invalidated_at IS NOT NULL;

-- validation: successful_explanation_without_valid_cache
SELECT COUNT(*) AS bad_rows
FROM `job` AS candidate
LEFT JOIN `answer_explanation_job_data` AS detail ON detail.job_id = candidate.id
LEFT JOIN `question` AS question ON question.id = candidate.question_id
LEFT JOIN `answer_explanation` AS cache
  ON cache.question_id = candidate.question_id AND cache.engine = candidate.engine
WHERE candidate.type = 'ANSWER_EXPLANATION'
  AND candidate.status = 'SUCCEEDED'
  AND (
      detail.job_id IS NULL
      OR detail.content IS NULL
      OR cache.id IS NULL
      OR detail.content <> cache.content
      OR detail.source_hash IS NULL
      OR CHAR_LENGTH(detail.source_hash) <> 64
      OR detail.source_hash <> SHA2(JSON_NORMALIZE(question.payload), 256)
      OR detail.invalidated_at IS NOT NULL
  );

-- validation: invalid_revision_parent_or_item
SELECT COUNT(*) AS bad_rows
FROM `job` AS candidate
LEFT JOIN `generation_item_revision_job_data` AS detail ON detail.job_id = candidate.id
LEFT JOIN `job` AS parent ON parent.id = candidate.parent_job_id
LEFT JOIN `question_generation_job_data` AS parentData ON parentData.job_id = parent.id
WHERE candidate.type = 'GENERATION_ITEM_REVISION'
  AND (
      parent.id IS NULL
      OR parent.type <> 'QUESTION_GENERATION'
      OR detail.job_id IS NULL
      OR parentData.job_id IS NULL
      OR parentData.items IS NULL
      OR JSON_TYPE(parentData.items) <> 'ARRAY'
      OR detail.item_index < 0
      OR detail.item_index >= JSON_LENGTH(parentData.items)
      OR JSON_CONTAINS_PATH(parentData.items, 'one', CONCAT('$[', detail.item_index, ']')) <> 1
  );

-- validation: manual_revision_log_mapping_mismatch
SELECT COUNT(*) AS bad_rows
FROM `generation_run_log` AS legacy
LEFT JOIN `generation_item_revision` AS revision
  ON revision.generation_job_id = legacy.generation_job_id
 AND revision.item_index = legacy.item_index
LEFT JOIN `job_run_log` AS copied ON copied.id = legacy.id
WHERE legacy.stage = 'MANUAL_ITEM_REVISION'
  AND (
      revision.id IS NULL
      OR copied.id IS NULL
      OR copied.job_id <> @explanationUpper + revision.id
      OR (
          SELECT COUNT(*)
          FROM `generation_item_revision` AS matches
          WHERE matches.generation_job_id = legacy.generation_job_id
            AND matches.item_index = legacy.item_index
      ) <> 1
  );

-- validation: invalid_parent_or_retry
SELECT COUNT(*) AS bad_rows
FROM `job` AS candidate
LEFT JOIN `job` AS parent ON parent.id = candidate.parent_job_id
LEFT JOIN `job` AS original ON original.id = candidate.retry_of_job_id
WHERE (candidate.parent_job_id IS NOT NULL AND parent.type <> 'QUESTION_GENERATION')
   OR (candidate.retry_of_job_id IS NOT NULL AND (
       original.status NOT IN ('SUCCEEDED', 'FAILED') OR original.type <> candidate.type OR
       NOT (original.topic_id <=> candidate.topic_id) OR
       NOT (original.question_id <=> candidate.question_id) OR
       NOT (original.parent_job_id <=> candidate.parent_job_id)
   ));

-- validation: legacy_running_exact_count
SELECT ABS(COUNT(*) - 4) AS bad_rows
FROM `generation_run_log`
WHERE `status` = 'RUNNING';

-- validation: copied_running_failed_exact_count
SELECT ABS(COUNT(*) - 4) AS bad_rows
FROM `generation_run_log` AS legacy
JOIN `job_run_log` AS copied ON copied.id = legacy.id
WHERE legacy.status = 'RUNNING'
  AND copied.status = 'FAILED'
  AND copied.finished_at IS NOT NULL
  AND copied.error_message IS NOT NULL;

-- validation: source_cache_exact_count
SELECT ABS(COUNT(*) - 63) AS bad_rows
FROM `answer_explanation`;

-- validation: materialized_cache_exact_count
SELECT ABS(COUNT(*) - 63) AS bad_rows
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
  AND detail.invalidated_at IS NULL;

SET @sourceRunningCount := (SELECT COUNT(*) FROM `generation_run_log` WHERE `status` = 'RUNNING');
SET @copiedRunningFailedCount := (
    SELECT COUNT(*) FROM `generation_run_log` AS legacy
    JOIN `job_run_log` AS copied ON copied.id = legacy.id
    WHERE legacy.status = 'RUNNING' AND copied.status = 'FAILED'
      AND copied.finished_at IS NOT NULL AND copied.error_message IS NOT NULL
);
SET @sourceCacheCount := (SELECT COUNT(*) FROM `answer_explanation`);
SET @materializedCacheCount := (
    SELECT COUNT(*) FROM `answer_explanation` AS legacy
    LEFT JOIN `answer_explanation_job` AS sourceJob
      ON sourceJob.question_id = legacy.question_id AND sourceJob.engine = legacy.engine
    JOIN `job` AS materialized ON materialized.id = COALESCE(@noteUpper + sourceJob.id, @revisionUpper + legacy.id)
      AND materialized.type = 'ANSWER_EXPLANATION' AND materialized.status = 'SUCCEEDED'
    JOIN `answer_explanation_job_data` AS detail ON detail.job_id = materialized.id
      AND detail.source_hash IS NOT NULL AND CHAR_LENGTH(detail.source_hash) = 64
      AND detail.content = legacy.content AND detail.invalidated_at IS NULL
);

DROP PROCEDURE IF EXISTS `fail_common_job_verification`;
CREATE PROCEDURE `fail_common_job_verification`(IN assertionMessage VARCHAR(255))
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = assertionMessage;

SET @assertionSql := IF(@sourceRunningCount <> 4,
    'CALL fail_common_job_verification(''verification expected exactly 4 source RUNNING logs'')', 'DO 0');
PREPARE common_job_assertion FROM @assertionSql;
EXECUTE common_job_assertion;
DEALLOCATE PREPARE common_job_assertion;

SET @assertionSql := IF(@copiedRunningFailedCount <> 4,
    'CALL fail_common_job_verification(''verification expected exactly 4 copied FAILED logs'')', 'DO 0');
PREPARE common_job_assertion FROM @assertionSql;
EXECUTE common_job_assertion;
DEALLOCATE PREPARE common_job_assertion;

SET @assertionSql := IF(@sourceCacheCount <> 63,
    'CALL fail_common_job_verification(''verification expected exactly 63 source caches'')', 'DO 0');
PREPARE common_job_assertion FROM @assertionSql;
EXECUTE common_job_assertion;
DEALLOCATE PREPARE common_job_assertion;

SET @assertionSql := IF(@materializedCacheCount <> 63,
    'CALL fail_common_job_verification(''verification expected exactly 63 valid materialized caches'')', 'DO 0');
PREPARE common_job_assertion FROM @assertionSql;
EXECUTE common_job_assertion;
DEALLOCATE PREPARE common_job_assertion;

DROP PROCEDURE `fail_common_job_verification`;
