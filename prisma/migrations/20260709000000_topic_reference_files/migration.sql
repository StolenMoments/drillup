-- AlterTable
ALTER TABLE `topic` ADD COLUMN `reference_dir` VARCHAR(200) NULL;

-- AlterTable
ALTER TABLE `generation_job` ADD COLUMN `reference_files` JSON NULL;
