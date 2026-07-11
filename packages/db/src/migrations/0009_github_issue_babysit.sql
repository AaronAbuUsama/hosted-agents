ALTER TABLE `github_issue` ADD `babysit_round` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `github_issue` ADD `babysit_blocked_reason` text;