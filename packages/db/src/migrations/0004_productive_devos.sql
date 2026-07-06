ALTER TABLE `agent_run` ADD `worker_role` text DEFAULT 'code_review' NOT NULL;--> statement-breakpoint
ALTER TABLE `agent_run` ADD `worker_display_name` text;--> statement-breakpoint
CREATE INDEX `agent_run_workerRole_idx` ON `agent_run` (`worker_role`);