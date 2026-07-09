-- AlterTable
ALTER TABLE `generation_job` ADD COLUMN `approved_at` DATETIME(3) NULL,
    ADD COLUMN `saved_count` INTEGER NOT NULL DEFAULT 0;
