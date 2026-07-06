CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_userId_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `invitation` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`inviter_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`role` text,
	`status` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`inviter_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `invitation_email_idx` ON `invitation` (`email`);--> statement-breakpoint
CREATE INDEX `invitation_organizationId_idx` ON `invitation` (`organization_id`);--> statement-breakpoint
CREATE TABLE `member` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`organization_id` text NOT NULL,
	`role` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `member_userId_idx` ON `member` (`user_id`);--> statement-breakpoint
CREATE INDEX `member_organizationId_idx` ON `member` (`organization_id`);--> statement-breakpoint
CREATE TABLE `organization` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`logo` text,
	`metadata` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `organization_slug_unique` ON `organization` (`slug`);--> statement-breakpoint
CREATE INDEX `organization_slug_idx` ON `organization` (`slug`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`active_organization_id` text,
	`active_team_id` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_userId_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`username` text,
	`display_username` text,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE UNIQUE INDEX `user_username_unique` ON `user` (`username`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `github_installation` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`installation_id` text NOT NULL,
	`app_slug` text NOT NULL,
	`account_id` text,
	`account_login` text,
	`account_type` text,
	`repository_selection` text,
	`status` text DEFAULT 'connected' NOT NULL,
	`setup_action` text,
	`installed_by_user_id` text,
	`suspended_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`installed_by_user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_installation_installationId_idx` ON `github_installation` (`installation_id`);--> statement-breakpoint
CREATE INDEX `github_installation_organizationId_idx` ON `github_installation` (`organization_id`);--> statement-breakpoint
CREATE INDEX `github_installation_accountLogin_idx` ON `github_installation` (`account_login`);--> statement-breakpoint
CREATE TABLE `github_repository` (
	`id` text PRIMARY KEY NOT NULL,
	`installation_id` text NOT NULL,
	`github_repository_id` text NOT NULL,
	`owner` text NOT NULL,
	`name` text NOT NULL,
	`full_name` text NOT NULL,
	`html_url` text,
	`default_branch` text,
	`private` integer DEFAULT false NOT NULL,
	`selected` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`installation_id`) REFERENCES `github_installation`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_repository_installation_repo_idx` ON `github_repository` (`installation_id`,`github_repository_id`);--> statement-breakpoint
CREATE INDEX `github_repository_installationId_idx` ON `github_repository` (`installation_id`);--> statement-breakpoint
CREATE INDEX `github_repository_fullName_idx` ON `github_repository` (`full_name`);--> statement-breakpoint
CREATE TABLE `github_webhook_delivery` (
	`id` text PRIMARY KEY NOT NULL,
	`event` text NOT NULL,
	`action` text,
	`installation_id` text,
	`repository_full_name` text,
	`pull_request_number` integer,
	`status` text DEFAULT 'claimed' NOT NULL,
	`review_run_id` text,
	`received_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `github_webhook_delivery_event_idx` ON `github_webhook_delivery` (`event`);--> statement-breakpoint
CREATE INDEX `github_webhook_delivery_installationId_idx` ON `github_webhook_delivery` (`installation_id`);--> statement-breakpoint
CREATE INDEX `github_webhook_delivery_status_idx` ON `github_webhook_delivery` (`status`);--> statement-breakpoint
CREATE INDEX `github_webhook_delivery_reviewRunId_idx` ON `github_webhook_delivery` (`review_run_id`);--> statement-breakpoint
CREATE TABLE `agent_provider_credential` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider` text NOT NULL,
	`credential_type` text NOT NULL,
	`encrypted_credential` text NOT NULL,
	`expires_at` integer,
	`status` text DEFAULT 'connected' NOT NULL,
	`last_error` text,
	`last_used_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `agent_provider_credential_organizationId_idx` ON `agent_provider_credential` (`organization_id`);--> statement-breakpoint
CREATE INDEX `agent_provider_credential_userId_idx` ON `agent_provider_credential` (`user_id`);--> statement-breakpoint
CREATE INDEX `agent_provider_credential_provider_idx` ON `agent_provider_credential` (`provider`);--> statement-breakpoint
CREATE INDEX `agent_provider_credential_status_idx` ON `agent_provider_credential` (`status`);--> statement-breakpoint
CREATE TABLE `review_run` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`user_id` text NOT NULL,
	`provider_credential_id` text,
	`agent_name` text DEFAULT 'code-review' NOT NULL,
	`repository_provider` text DEFAULT 'manual' NOT NULL,
	`repository_owner` text,
	`repository_name` text,
	`repository_url` text,
	`branch` text NOT NULL,
	`base_branch` text,
	`review_context` text,
	`github_delivery_id` text,
	`github_installation_id` text,
	`github_repository_id` text,
	`pull_request_number` integer,
	`pull_request_base_ref` text,
	`pull_request_base_sha` text,
	`pull_request_head_ref` text,
	`pull_request_head_sha` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`flue_run_id` text,
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
	FOREIGN KEY (`github_delivery_id`) REFERENCES `github_webhook_delivery`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`github_installation_id`) REFERENCES `github_installation`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`github_repository_id`) REFERENCES `github_repository`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `review_run_organizationId_idx` ON `review_run` (`organization_id`);--> statement-breakpoint
CREATE INDEX `review_run_userId_idx` ON `review_run` (`user_id`);--> statement-breakpoint
CREATE INDEX `review_run_providerCredentialId_idx` ON `review_run` (`provider_credential_id`);--> statement-breakpoint
CREATE INDEX `review_run_flueRunId_idx` ON `review_run` (`flue_run_id`);--> statement-breakpoint
CREATE INDEX `review_run_status_idx` ON `review_run` (`status`);--> statement-breakpoint
CREATE INDEX `review_run_githubDeliveryId_idx` ON `review_run` (`github_delivery_id`);--> statement-breakpoint
CREATE INDEX `review_run_githubInstallationId_idx` ON `review_run` (`github_installation_id`);--> statement-breakpoint
CREATE INDEX `review_run_githubRepositoryId_idx` ON `review_run` (`github_repository_id`);