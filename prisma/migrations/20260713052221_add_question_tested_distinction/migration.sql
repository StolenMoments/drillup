-- DropForeignKey
ALTER TABLE `generation_run_log` DROP FOREIGN KEY `generation_run_log_generation_job_id_fkey`;

-- AlterTable
ALTER TABLE `question` ADD COLUMN `tested_distinction` TEXT NULL;

-- AddForeignKey
ALTER TABLE `generation_run_log` ADD CONSTRAINT `generation_run_log_generation_job_id_fkey` FOREIGN KEY (`generation_job_id`) REFERENCES `generation_job`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
