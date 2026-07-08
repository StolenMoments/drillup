-- CreateTable
CREATE TABLE `generation_job` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `topic_id` INTEGER NOT NULL,
    `engine` ENUM('CLAUDE', 'CODEX', 'ANTIGRAVITY') NOT NULL,
    `instructions` TEXT NOT NULL,
    `status` ENUM('RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'RUNNING',
    `result` JSON NULL,
    `error_message` TEXT NULL,
    `raw_output` MEDIUMTEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `generation_job` ADD CONSTRAINT `generation_job_topic_id_fkey` FOREIGN KEY (`topic_id`) REFERENCES `topic`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
