-- CreateTable
CREATE TABLE `choice_hardening_job` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `question_id` INTEGER NOT NULL,
    `source_hash` CHAR(64) NOT NULL,
    `source_payload` JSON NOT NULL,
    `engine` ENUM('CLAUDE', 'CODEX', 'ANTIGRAVITY') NOT NULL,
    `verify_engine` ENUM('CLAUDE', 'CODEX', 'ANTIGRAVITY') NOT NULL,
    `attempt` INTEGER NOT NULL DEFAULT 1,
    `status` ENUM('RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'RUNNING',
    `stage` ENUM('GENERATING', 'VERIFYING') NOT NULL DEFAULT 'GENERATING',
    `preview` JSON NULL,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,
    `applied_at` DATETIME(3) NULL,

    UNIQUE INDEX `ch_job_source_engine_key`(`question_id`, `source_hash`, `engine`, `verify_engine`),
    INDEX `choice_hardening_job_status_started_at_idx`(`status`, `started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `choice_hardening_job` ADD CONSTRAINT `choice_hardening_job_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `question`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
