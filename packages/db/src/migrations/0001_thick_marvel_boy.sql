ALTER TABLE `review_run` ADD `sandbox_provider` text;--> statement-breakpoint
ALTER TABLE `review_run` ADD `sandbox_id` text;--> statement-breakpoint
ALTER TABLE `review_run` ADD `sandbox_started_at` integer;--> statement-breakpoint
ALTER TABLE `review_run` ADD `sandbox_completed_at` integer;--> statement-breakpoint
ALTER TABLE `review_run` ADD `artifacts_json` text;--> statement-breakpoint
ALTER TABLE `review_run` ADD `execution_logs` text;--> statement-breakpoint
CREATE INDEX `review_run_sandboxId_idx` ON `review_run` (`sandbox_id`);