CREATE INDEX `ch_job_pending_list_idx`
    ON `choice_hardening_job`(`status`, `applied_at`, `dismissed_at`, `finished_at`);

CREATE INDEX `ch_job_failed_list_idx`
    ON `choice_hardening_job`(`status`, `dismissed_at`, `finished_at`);

CREATE INDEX `ch_job_running_list_idx`
    ON `choice_hardening_job`(`status`, `created_at`);

CREATE INDEX `ch_job_applied_list_idx`
    ON `choice_hardening_job`(`applied_at`);
