-- CreateTable
CREATE TABLE `generation_item_revision` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `generation_job_id` INTEGER NOT NULL,
    `item_index` INTEGER NOT NULL,
    `engine` ENUM('CLAUDE', 'CODEX', 'ANTIGRAVITY') NOT NULL,
    `instructions` TEXT NOT NULL,
    `status` ENUM('RUNNING', 'SUCCEEDED', 'FAILED') NOT NULL DEFAULT 'RUNNING',
    `verdict` ENUM('PASS', 'FAIL') NULL,
    `comment` TEXT NULL,
    `proposed_question` JSON NULL,
    `applied_question` JSON NULL,
    `error_message` TEXT NULL,
    `raw_output` MEDIUMTEXT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `finished_at` DATETIME(3) NULL,

    UNIQUE INDEX `generation_item_revision_generation_job_id_item_index_key`(`generation_job_id`, `item_index`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `generation_item_revision` ADD CONSTRAINT `generation_item_revision_generation_job_id_fkey` FOREIGN KEY (`generation_job_id`) REFERENCES `generation_job`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
