-- Denormalize the repository full name onto synced issue comments so the store's
-- board/detail reads can scope by (organization, full name) instead of the
-- per-installation `github_repository` row id. A repo installed under both the
-- reviewer and Coder GitHub Apps has two `github_repository` rows sharing one full
-- name; a comment (keyed by its unique GitHub comment id) is pinned to whichever
-- app delivered first, so a repo-row-id scoped read misses comments on the other
-- record. See packages/api/src/issues/sync.ts.
--
-- SQLite cannot add a NOT NULL column to a non-empty table without a default, so
-- the column lands with a `''` default; the backfill then fills real values from
-- the linked repository row (the FK cascade guarantees it exists). Every write
-- path stamps the full name explicitly, so the default is never used going
-- forward and matches the NOT NULL schema.
ALTER TABLE `github_issue_comment` ADD `repository_full_name` text NOT NULL DEFAULT '';--> statement-breakpoint
UPDATE `github_issue_comment`
SET `repository_full_name` = COALESCE(
  (
    SELECT `github_repository`.`full_name`
    FROM `github_repository`
    WHERE `github_repository`.`id` = `github_issue_comment`.`github_repository_id`
  ),
  ''
)
WHERE `repository_full_name` = '';--> statement-breakpoint
CREATE INDEX `github_issue_comment_repositoryFullName_idx` ON `github_issue_comment` (`repository_full_name`);
