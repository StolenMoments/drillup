ALTER TABLE `generation_run_log`
  ADD COLUMN `warning_message` TEXT NULL AFTER `error_message`;
