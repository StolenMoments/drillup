ALTER TABLE `choice_hardening_job`
    ADD COLUMN `auto_applied` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `dismissed_at` DATETIME(3) NULL;
