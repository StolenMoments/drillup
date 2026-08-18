ALTER TABLE `factual_review_job`
    ADD COLUMN `source_hash` CHAR(64) NULL,
    ADD COLUMN `source_snapshot` JSON NULL,
    ADD COLUMN `attempt` INTEGER NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX `fr_job_source_attempt_key`
    ON `factual_review_job`(`question_id`, `kind`, `source_hash`, `engine`, `attempt`);

CREATE INDEX `fr_job_cache_lookup_idx`
    ON `factual_review_job`(`question_id`, `kind`, `source_hash`, `engine`, `status`, `attempt`);
