CREATE TABLE `agent_run` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider_credential_id` text,
	`coworker_slug` text NOT NULL,
	`run_type` text NOT NULL,
	`source_provider` text NOT NULL,
	`source_delivery_id` text,
	`github_installation_id` text,
	`github_repository_id` text,
	`repository_owner` text,
	`repository_name` text,
	`repository_url` text,
	`branch` text,
	`base_branch` text,
	`pull_request_number` integer,
	`pull_request_base_ref` text,
	`pull_request_base_sha` text,
	`pull_request_head_ref` text,
	`pull_request_head_sha` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`flue_run_id` text,
	`sandbox_provider` text,
	`sandbox_id` text,
	`current_stage` text,
	`last_heartbeat_at` integer,
	`summary` text,
	`findings_json` text,
	`error_message` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`provider_credential_id`) REFERENCES `agent_provider_credential`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`github_installation_id`) REFERENCES `github_installation`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`github_repository_id`) REFERENCES `github_repository`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `agent_run_organizationId_idx` ON `agent_run` (`organization_id`);--> statement-breakpoint
CREATE INDEX `agent_run_userId_idx` ON `agent_run` (`user_id`);--> statement-breakpoint
CREATE INDEX `agent_run_providerCredentialId_idx` ON `agent_run` (`provider_credential_id`);--> statement-breakpoint
CREATE INDEX `agent_run_coworkerSlug_idx` ON `agent_run` (`coworker_slug`);--> statement-breakpoint
CREATE INDEX `agent_run_runType_idx` ON `agent_run` (`run_type`);--> statement-breakpoint
CREATE INDEX `agent_run_status_idx` ON `agent_run` (`status`);--> statement-breakpoint
CREATE INDEX `agent_run_flueRunId_idx` ON `agent_run` (`flue_run_id`);--> statement-breakpoint
CREATE INDEX `agent_run_sandboxId_idx` ON `agent_run` (`sandbox_id`);--> statement-breakpoint
CREATE INDEX `agent_run_sourceDeliveryId_idx` ON `agent_run` (`source_delivery_id`);--> statement-breakpoint
CREATE INDEX `agent_run_githubInstallationId_idx` ON `agent_run` (`github_installation_id`);--> statement-breakpoint
CREATE INDEX `agent_run_githubRepositoryId_idx` ON `agent_run` (`github_repository_id`);--> statement-breakpoint
CREATE TABLE `agent_run_artifact` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`name` text NOT NULL,
	`content_type` text NOT NULL,
	`content` text,
	`payload_json` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_run_artifact_runId_idx` ON `agent_run_artifact` (`run_id`);--> statement-breakpoint
CREATE INDEX `agent_run_artifact_name_idx` ON `agent_run_artifact` (`name`);--> statement-breakpoint
CREATE TABLE `agent_run_event` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`category` text NOT NULL,
	`type` text NOT NULL,
	`stage` text,
	`message` text NOT NULL,
	`payload_json` text,
	`flue_event_index` integer,
	`flue_event_type` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_run_event_runId_idx` ON `agent_run_event` (`run_id`);--> statement-breakpoint
CREATE INDEX `agent_run_event_runSequence_idx` ON `agent_run_event` (`run_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `agent_run_event_type_idx` ON `agent_run_event` (`type`);--> statement-breakpoint
CREATE INDEX `agent_run_event_category_idx` ON `agent_run_event` (`category`);--> statement-breakpoint
CREATE INDEX `agent_run_event_flueEventIndex_idx` ON `agent_run_event` (`flue_event_index`);--> statement-breakpoint
CREATE TABLE `agent_run_sandbox` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`provider` text NOT NULL,
	`sandbox_id` text NOT NULL,
	`status` text NOT NULL,
	`labels_json` text,
	`error_message` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_run`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_run_sandbox_runId_idx` ON `agent_run_sandbox` (`run_id`);--> statement-breakpoint
CREATE INDEX `agent_run_sandbox_sandboxId_idx` ON `agent_run_sandbox` (`sandbox_id`);--> statement-breakpoint
CREATE INDEX `agent_run_sandbox_status_idx` ON `agent_run_sandbox` (`status`);--> statement-breakpoint
ALTER TABLE `github_webhook_delivery` ADD `agent_run_id` text;--> statement-breakpoint
CREATE INDEX `github_webhook_delivery_agentRunId_idx` ON `github_webhook_delivery` (`agent_run_id`);