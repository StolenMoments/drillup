-- Mark jobs completed before approval tracking existed as already handled.
UPDATE `generation_job`
SET `approved_at` = COALESCE(`finished_at`, `created_at`)
WHERE `status` = 'SUCCEEDED'
  AND `approved_at` IS NULL
  AND `created_at` < '2026-07-09 04:10:53.000';
