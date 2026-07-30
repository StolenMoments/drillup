-- CreateTable
CREATE TABLE `factual_review_job` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `question_id` INTEGER NOT NULL,
    `engine` ENUM('CLAUDE', 'CODEX', 'ANTIGRAVITY') NOT NULL,
    `concern` TEXT NOT NULL,
    `status` ENUM('RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'RUNNING',
    `verdict` VARCHAR(191) NULL,
    `comment` TEXT NULL,
    `evidence_url` VARCHAR(191) NULL,
    `payload` JSON NULL,
    `error_message` TEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `started_at` DATETIME(3) NULL,
    `finished_at` DATETIME(3) NULL,

    INDEX `factual_review_job_status_started_at_idx`(`status`, `started_at`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `factual_review_job` ADD CONSTRAINT `factual_review_job_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `question`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
