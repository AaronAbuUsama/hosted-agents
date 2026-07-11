import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { organization } from "@hosted-agents/db/schema/auth";
import { githubInstallation, githubRepository } from "@hosted-agents/db/schema/github";

// Local sync of a GitHub issue (see issue #19). The board reads from these rows,
// not from a live GitHub call on every render; webhooks keep them current. Scoped
// by Organization + repository. The board stage is DERIVED (see packages/api
// issues/stage.ts) from labels + claim + linked-PR state, never stored as truth.
export const githubIssue = sqliteTable(
  "github_issue",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    githubInstallationId: text("github_installation_id").references(() => githubInstallation.id, {
      onDelete: "set null",
    }),
    githubRepositoryId: text("github_repository_id")
      .notNull()
      .references(() => githubRepository.id, { onDelete: "cascade" }),
    repositoryFullName: text("repository_full_name").notNull(),
    number: integer("number").notNull(),
    githubIssueId: text("github_issue_id"),
    nodeId: text("node_id"),
    title: text("title").notNull(),
    body: text("body"),
    state: text("state").default("open").notNull(),
    authorLogin: text("author_login"),
    authorAvatarUrl: text("author_avatar_url"),
    // JSON string[] of label names; the gating labels live here.
    labelsJson: text("labels_json").default("[]").notNull(),
    htmlUrl: text("html_url"),
    commentCount: integer("comment_count").default(0).notNull(),
    // Linked pull request, when the issue has reached one.
    linkedPullRequestNumber: integer("linked_pull_request_number"),
    linkedPullRequestState: text("linked_pull_request_state"),
    linkedPullRequestMerged: integer("linked_pull_request_merged", { mode: "boolean" }),
    closedByMerge: integer("closed_by_merge", { mode: "boolean" }).default(false).notNull(),
    // Claim bookkeeping — enforces no double-claim; set when a worker Run claims it.
    claimedByWorkerRole: text("claimed_by_worker_role"),
    claimedByRunId: text("claimed_by_run_id"),
    claimedAt: integer("claimed_at", { mode: "timestamp_ms" }),
    // Babysit bookkeeping (spec #21 stories 7–9, C6). `babysitRound` counts the
    // review-driven fix rounds the Coder has been dispatched on this issue's pull
    // request; a `changes_requested` review enqueues a fix run only while it is
    // below the cap. `babysitBlockedReason` is non-null once babysitting has
    // stopped for good — the round cap was reached (`round_cap_reached`), a human
    // took over the pull request (`human_in_the_loop`, humans always win), or a
    // human approved it (`human_approved`). Any non-null reason makes every later
    // review a no-op, so the Coder never resumes a yielded PR. The first two drive
    // the board's Failed / Blocked lane; `human_approved` does not — the PR is good
    // and stays mergeable (the board overlay excludes that reason from Blocked).
    babysitRound: integer("babysit_round").default(0).notNull(),
    babysitBlockedReason: text("babysit_blocked_reason"),
    githubCreatedAt: integer("github_created_at", { mode: "timestamp_ms" }),
    githubUpdatedAt: integer("github_updated_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("github_issue_repo_number_idx").on(table.githubRepositoryId, table.number),
    index("github_issue_organizationId_idx").on(table.organizationId),
    index("github_issue_repositoryFullName_idx").on(table.repositoryFullName),
    index("github_issue_state_idx").on(table.state),
    index("github_issue_claimedByRunId_idx").on(table.claimedByRunId),
  ],
);

// Local sync of a comment on a synced issue. Author identity is recorded as data
// (see CONTEXT.md "Worker"): a member's comment is `user`, an agent's is `worker`
// with its role, everything synced from GitHub is `external`.
export const githubIssueComment = sqliteTable(
  "github_issue_comment",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    githubRepositoryId: text("github_repository_id")
      .notNull()
      .references(() => githubRepository.id, { onDelete: "cascade" }),
    // Nullable: a comment can arrive (or be posted) before the issue row is synced.
    issueId: text("issue_id").references(() => githubIssue.id, { onDelete: "cascade" }),
    issueNumber: integer("issue_number").notNull(),
    githubCommentId: text("github_comment_id"),
    authorLogin: text("author_login"),
    authorAvatarUrl: text("author_avatar_url"),
    authorKind: text("author_kind").default("external").notNull(),
    authorWorkerRole: text("author_worker_role"),
    authorUserId: text("author_user_id"),
    body: text("body").notNull(),
    htmlUrl: text("html_url"),
    githubCreatedAt: integer("github_created_at", { mode: "timestamp_ms" }),
    githubUpdatedAt: integer("github_updated_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("github_issue_comment_githubCommentId_idx").on(table.githubCommentId),
    index("github_issue_comment_issueId_idx").on(table.issueId),
    index("github_issue_comment_repo_issue_idx").on(table.githubRepositoryId, table.issueNumber),
    index("github_issue_comment_organizationId_idx").on(table.organizationId),
  ],
);

export const githubIssueRelations = relations(githubIssue, ({ one, many }) => ({
  organization: one(organization, {
    fields: [githubIssue.organizationId],
    references: [organization.id],
  }),
  repository: one(githubRepository, {
    fields: [githubIssue.githubRepositoryId],
    references: [githubRepository.id],
  }),
  comments: many(githubIssueComment),
}));

export const githubIssueCommentRelations = relations(githubIssueComment, ({ one }) => ({
  issue: one(githubIssue, {
    fields: [githubIssueComment.issueId],
    references: [githubIssue.id],
  }),
  repository: one(githubRepository, {
    fields: [githubIssueComment.githubRepositoryId],
    references: [githubRepository.id],
  }),
}));
