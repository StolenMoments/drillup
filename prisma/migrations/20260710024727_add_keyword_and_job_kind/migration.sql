-- AlterTable
ALTER TABLE `generation_job` ADD COLUMN `kind` ENUM('QUESTION', 'KEYWORD_TAG') NOT NULL DEFAULT 'QUESTION',
    ADD COLUMN `source_question_ids` JSON NULL;

-- CreateTable
CREATE TABLE `keyword` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(50) NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `keyword_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `question_keyword` (
    `question_id` INTEGER NOT NULL,
    `keyword_id` INTEGER NOT NULL,

    PRIMARY KEY (`question_id`, `keyword_id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `question_keyword` ADD CONSTRAINT `question_keyword_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `question`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `question_keyword` ADD CONSTRAINT `question_keyword_keyword_id_fkey` FOREIGN KEY (`keyword_id`) REFERENCES `keyword`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
