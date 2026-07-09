CREATE TABLE `github_issue` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`github_installation_id` text,
	`github_repository_id` text NOT NULL,
	`repository_full_name` text NOT NULL,
	`number` integer NOT NULL,
	`github_issue_id` text,
	`node_id` text,
	`title` text NOT NULL,
	`body` text,
	`state` text DEFAULT 'open' NOT NULL,
	`author_login` text,
	`author_avatar_url` text,
	`labels_json` text DEFAULT '[]' NOT NULL,
	`html_url` text,
	`comment_count` integer DEFAULT 0 NOT NULL,
	`linked_pull_request_number` integer,
	`linked_pull_request_state` text,
	`linked_pull_request_merged` integer,
	`closed_by_merge` integer DEFAULT false NOT NULL,
	`claimed_by_worker_role` text,
	`claimed_by_run_id` text,
	`claimed_at` integer,
	`github_created_at` integer,
	`github_updated_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`github_installation_id`) REFERENCES `github_installation`(`id`) ON UPDATE no action ON DELETE set null,
	FOREIGN KEY (`github_repository_id`) REFERENCES `github_repository`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_issue_repo_number_idx` ON `github_issue` (`github_repository_id`,`number`);--> statement-breakpoint
CREATE INDEX `github_issue_organizationId_idx` ON `github_issue` (`organization_id`);--> statement-breakpoint
CREATE INDEX `github_issue_repositoryFullName_idx` ON `github_issue` (`repository_full_name`);--> statement-breakpoint
CREATE INDEX `github_issue_state_idx` ON `github_issue` (`state`);--> statement-breakpoint
CREATE INDEX `github_issue_claimedByRunId_idx` ON `github_issue` (`claimed_by_run_id`);--> statement-breakpoint
CREATE TABLE `github_issue_comment` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`github_repository_id` text NOT NULL,
	`issue_id` text,
	`issue_number` integer NOT NULL,
	`github_comment_id` text,
	`author_login` text,
	`author_avatar_url` text,
	`author_kind` text DEFAULT 'external' NOT NULL,
	`author_worker_role` text,
	`author_user_id` text,
	`body` text NOT NULL,
	`html_url` text,
	`github_created_at` integer,
	`github_updated_at` integer,
	`created_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	`updated_at` integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organization`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`github_repository_id`) REFERENCES `github_repository`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`issue_id`) REFERENCES `github_issue`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `github_issue_comment_githubCommentId_idx` ON `github_issue_comment` (`github_comment_id`);--> statement-breakpoint
CREATE INDEX `github_issue_comment_issueId_idx` ON `github_issue_comment` (`issue_id`);--> statement-breakpoint
CREATE INDEX `github_issue_comment_repo_issue_idx` ON `github_issue_comment` (`github_repository_id`,`issue_number`);--> statement-breakpoint
CREATE INDEX `github_issue_comment_organizationId_idx` ON `github_issue_comment` (`organization_id`);