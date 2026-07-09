CREATE TABLE IF NOT EXISTS `worker_config` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`worker_role` text NOT NULL,
	`display_name` text,
	`model` text,
	`instructions` text,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `worker_config_org_role_idx` ON `worker_config` (`organization_id`,`worker_role`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `worker_config_organizationId_idx` ON `worker_config` (`organization_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `worker_skill` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`worker_role` text NOT NULL,
	`name` text NOT NULL,
	`description` text,
	`enabled` integer DEFAULT true NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `worker_skill_org_role_name_idx` ON `worker_skill` (`organization_id`,`worker_role`,`name`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `worker_skill_organizationId_idx` ON `worker_skill` (`organization_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `worker_skill_file` (
	`id` text PRIMARY KEY NOT NULL,
	`skill_id` text NOT NULL,
	`path` text NOT NULL,
	`content` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`skill_id`) REFERENCES `worker_skill`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `worker_skill_file_skill_path_idx` ON `worker_skill_file` (`skill_id`,`path`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `worker_skill_file_skillId_idx` ON `worker_skill_file` (`skill_id`);--> statement-breakpoint
ALTER TABLE `agent_run` ADD `model` text;
