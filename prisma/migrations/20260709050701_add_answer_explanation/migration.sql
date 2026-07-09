-- CreateTable
CREATE TABLE `answer_explanation` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `question_id` INTEGER NOT NULL,
    `engine` ENUM('CLAUDE', 'CODEX', 'ANTIGRAVITY') NOT NULL,
    `content` TEXT NOT NULL,
    `created_at` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `answer_explanation_question_id_engine_key`(`question_id`, `engine`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `answer_explanation` ADD CONSTRAINT `answer_explanation_question_id_fkey` FOREIGN KEY (`question_id`) REFERENCES `question`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
