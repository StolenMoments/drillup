-- Expand the schema without removing any legacy table or enum.
CREATE TABLE `job` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `type` ENUM('QUESTION_GENERATION', 'KEYWORD_TAGGING', 'GENERATION_ITEM_REVISION', 'CHOICE_HARDENING', 'NOTE_TIDY', 'ANSWER_EXPLANATION') NOT NULL,
    `status` ENUM('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'PENDING',
    `engine` ENUM('CLAUDE', 'CODEX', 'ANTIGRAVITY') NOT NULL,
    `topic_id` INTEGER NULL,
    `question_id` INTEGER NULL,
    `parent_job_id` INTEGER NULL,
    `retry_of_job_id` INTEGER NULL,
    `run_token` CHAR(36) NULL,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `started_at` DATETIME(3) NULL,
    `heartbeat_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,

    INDEX `job_status_heartbeat_at_idx` (`status`, `heartbeat_at`),
    INDEX `job_topic_id_type_status_idx` (`topic_id`, `type`, `status`),
    INDEX `job_question_id_type_status_idx` (`question_id`, `type`, `status`),
    INDEX `job_parent_job_id_idx` (`parent_job_id`),
    INDEX `job_retry_of_job_id_idx` (`retry_of_job_id`),
    CONSTRAINT `job_type_target_check` CHECK (
        (`type` = 'QUESTION_GENERATION' AND `topic_id` IS NOT NULL AND `question_id` IS NULL AND `parent_job_id` IS NULL) OR
        (`type` = 'KEYWORD_TAGGING' AND `topic_id` IS NOT NULL AND `question_id` IS NULL AND `parent_job_id` IS NULL) OR
        (`type` = 'NOTE_TIDY' AND `topic_id` IS NOT NULL AND `question_id` IS NULL AND `parent_job_id` IS NULL) OR
        (`type` = 'CHOICE_HARDENING' AND `topic_id` IS NULL AND `question_id` IS NOT NULL AND `parent_job_id` IS NULL) OR
        (`type` = 'ANSWER_EXPLANATION' AND `topic_id` IS NULL AND `question_id` IS NOT NULL AND `parent_job_id` IS NULL) OR
        (`type` = 'GENERATION_ITEM_REVISION' AND `topic_id` IS NULL AND `question_id` IS NULL AND `parent_job_id` IS NOT NULL)
    ),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

ALTER TABLE `job` ADD CONSTRAINT `job_topic_id_fkey` FOREIGN KEY (`topic_id`) REFERENCES `topic` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `job` ADD CONSTRAINT `job_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `question` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `job` ADD CONSTRAINT `job_parent_job_id_fkey` FOREIGN KEY (`parent_job_id`) REFERENCES `job` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE `job` ADD CONSTRAINT `job_retry_of_job_id_fkey` FOREIGN KEY (`retry_of_job_id`) REFERENCES `job` (`id`) ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE `question_generation_job_data` (
    `job_id` INTEGER NOT NULL,
    `verify_engine` ENUM('CLAUDE', 'CODEX', 'ANTIGRAVITY') NOT NULL,
    `instructions` TEXT NOT NULL,
    `reference_files` JSON NULL,
    `correct_answer_count` INTEGER NULL,
    `choice_count` INTEGER NULL,
    `source_question_ids` JSON NULL,
    `stage` ENUM('RUNNING', 'VERIFYING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'RUNNING',
    `items` JSON NULL,
    `verify_warning` TEXT NULL,
    `approved_at` DATETIME(3) NULL,
    `saved_count` INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (`job_id`),
    CONSTRAINT `question_generation_job_data_job_id_fkey` FOREIGN KEY (`job_id`) REFERENCES `job` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `keyword_tagging_job_data` (
    `job_id` INTEGER NOT NULL,
    `targets` JSON NULL,
    `items` JSON NULL,
    `approved_at` DATETIME(3) NULL,
    `saved_count` INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (`job_id`),
    CONSTRAINT `keyword_tagging_job_data_job_id_fkey` FOREIGN KEY (`job_id`) REFERENCES `job` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `generation_item_revision_job_data` (
    `job_id` INTEGER NOT NULL,
    `item_index` INTEGER NOT NULL,
    `instructions` TEXT NOT NULL,
    `verdict` ENUM('PASS', 'FAIL') NULL,
    `comment` TEXT NULL,
    `proposed_question` JSON NULL,
    `selected_at` DATETIME(3) NULL,
    PRIMARY KEY (`job_id`),
    CONSTRAINT `generation_item_revision_job_data_job_id_fkey` FOREIGN KEY (`job_id`) REFERENCES `job` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `choice_hardening_job_data` (
    `job_id` INTEGER NOT NULL,
    `source_hash` CHAR(64) NOT NULL,
    `source_payload` JSON NOT NULL,
    `verify_engine` ENUM('CLAUDE', 'CODEX', 'ANTIGRAVITY') NOT NULL,
    `preview` JSON NULL,
    `applied_at` DATETIME(3) NULL,
    `auto_applied` BOOLEAN NOT NULL DEFAULT false,
    `dismissed_at` DATETIME(3) NULL,
    PRIMARY KEY (`job_id`),
    CONSTRAINT `choice_hardening_job_data_job_id_fkey` FOREIGN KEY (`job_id`) REFERENCES `job` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `note_tidy_job_data` (
    `job_id` INTEGER NOT NULL,
    `source_hash` CHAR(64) NOT NULL,
    `preview` MEDIUMTEXT NULL,
    `applied_at` DATETIME(3) NULL,
    `dismissed_at` DATETIME(3) NULL,
    PRIMARY KEY (`job_id`),
    CONSTRAINT `note_tidy_job_data_job_id_fkey` FOREIGN KEY (`job_id`) REFERENCES `job` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `answer_explanation_job_data` (
    `job_id` INTEGER NOT NULL,
    `source_hash` CHAR(64) NOT NULL,
    `content` TEXT NULL,
    `choice_explanations` JSON NULL,
    `factual_concern` TEXT NULL,
    `invalidated_at` DATETIME(3) NULL,
    PRIMARY KEY (`job_id`),
    CONSTRAINT `answer_explanation_job_data_job_id_fkey` FOREIGN KEY (`job_id`) REFERENCES `job` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

CREATE TABLE `job_run_log` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `job_id` INTEGER NOT NULL,
    `stage` ENUM('BLUEPRINT', 'BLUEPRINT_REPAIR', 'GENERATION', 'VERIFY', 'ITEM_REPAIR', 'REPAIR_VERIFY', 'MANUAL_ITEM_REVISION', 'KEYWORD_TAG', 'CHOICE_HARDENING', 'NOTE_TIDY', 'ANSWER_EXPLANATION', 'LEGACY_OUTPUT') NOT NULL,
    `item_index` INTEGER NULL,
    `attempt` INTEGER NOT NULL DEFAULT 1,
    `engine` ENUM('CLAUDE', 'CODEX', 'ANTIGRAVITY') NOT NULL,
    `model` VARCHAR(100) NULL,
    `status` ENUM('RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'RUNNING',
    `prompt` MEDIUMTEXT NOT NULL,
    `response` MEDIUMTEXT NULL,
    `stdout_tail` TEXT NULL,
    `stderr_tail` TEXT NULL,
    `error_message` TEXT NULL,
    `exit_code` INTEGER NULL,
    `timed_out` BOOLEAN NOT NULL DEFAULT false,
    `started_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,
    `duration_ms` INTEGER NULL,
    INDEX `job_run_log_job_id_started_at_idx` (`job_id`, `started_at`),
    PRIMARY KEY (`id`),
    CONSTRAINT `job_run_log_job_id_fkey` FOREIGN KEY (`job_id`) REFERENCES `job` (`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
