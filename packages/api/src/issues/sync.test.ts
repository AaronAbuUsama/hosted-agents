import { describe, expect, test } from "bun:test";
import { drizzle } from "drizzle-orm/libsql";

import { IMPLEMENTATION_WORKER_ROLE } from "@hosted-agents/db/schema/agent-runs";
import * as schema from "@hosted-agents/db/schema/index";

import {
  loadIssueOverlay,
  loadIssueOverlays,
  loadRepositoryIssuesRevision,
  upsertSyncedIssueComment,
} from "./sync";

// Finding A (PR #50 review): a repository installed under BOTH GitHub Apps has two
// `github_repository` rows sharing one `owner/name` but differing by installation.
// Webhook deliveries + kick-off stamp issue/comment rows onto whichever record the
// transport resolved, so a claim or comment can land on the Coder-app record while
// the board loads through the reviewer-app record. These tests pin data to record A
// and read it back through record B; the reads must be topology-independent.

const REVIEWER_REPOSITORY_ID = "repository-record-reviewer";
const CODER_REPOSITORY_ID = "repository-record-coder";
const REPOSITORY_FULL_NAME = "octo-org/widgets";
const ORGANIZATION_ID = "org-1";

const CREATE_TABLES = `
  CREATE TABLE "organization" (
    "id" text PRIMARY KEY,
    "name" text NOT NULL,
    "slug" text NOT NULL UNIQUE,
    "logo" text,
    "metadata" text,
    "created_at" integer DEFAULT 0 NOT NULL
  );

  CREATE TABLE "github_installation" (
    "id" text PRIMARY KEY,
    "organization_id" text NOT NULL,
    "installation_id" text NOT NULL UNIQUE,
    "app_slug" text NOT NULL,
    "account_id" text,
    "account_login" text,
    "account_type" text,
    "repository_selection" text,
    "status" text DEFAULT 'connected' NOT NULL,
    "setup_action" text,
    "installed_by_user_id" text,
    "suspended_at" integer,
    "created_at" integer DEFAULT 0 NOT NULL,
    "updated_at" integer DEFAULT 0 NOT NULL
  );

  CREATE TABLE "github_repository" (
    "id" text PRIMARY KEY,
    "installation_id" text NOT NULL,
    "github_repository_id" text NOT NULL,
    "owner" text NOT NULL,
    "name" text NOT NULL,
    "full_name" text NOT NULL,
    "html_url" text,
    "default_branch" text,
    "private" integer DEFAULT 0 NOT NULL,
    "selected" integer DEFAULT 1 NOT NULL,
    "created_at" integer DEFAULT 0 NOT NULL,
    "updated_at" integer DEFAULT 0 NOT NULL,
    UNIQUE ("installation_id", "github_repository_id")
  );

  CREATE TABLE "github_issue" (
    "id" text PRIMARY KEY,
    "organization_id" text NOT NULL,
    "github_installation_id" text,
    "github_repository_id" text NOT NULL,
    "repository_full_name" text NOT NULL,
    "number" integer NOT NULL,
    "github_issue_id" text,
    "node_id" text,
    "title" text NOT NULL,
    "body" text,
    "state" text DEFAULT 'open' NOT NULL,
    "author_login" text,
    "author_avatar_url" text,
    "labels_json" text DEFAULT '[]' NOT NULL,
    "html_url" text,
    "comment_count" integer DEFAULT 0 NOT NULL,
    "linked_pull_request_number" integer,
    "linked_pull_request_state" text,
    "linked_pull_request_merged" integer,
    "closed_by_merge" integer DEFAULT 0 NOT NULL,
    "claimed_by_worker_role" text,
    "claimed_by_run_id" text,
    "claimed_at" integer,
    "babysit_round" integer DEFAULT 0 NOT NULL,
    "babysit_blocked_reason" text,
    "github_created_at" integer,
    "github_updated_at" integer,
    "created_at" integer DEFAULT 0 NOT NULL,
    "updated_at" integer DEFAULT 0 NOT NULL
  );
  CREATE UNIQUE INDEX "github_issue_repo_number_idx" ON "github_issue" ("github_repository_id","number");

  CREATE TABLE "github_issue_comment" (
    "id" text PRIMARY KEY,
    "organization_id" text NOT NULL,
    "github_repository_id" text NOT NULL,
    "repository_full_name" text NOT NULL,
    "issue_id" text,
    "issue_number" integer NOT NULL,
    "github_comment_id" text,
    "author_login" text,
    "author_avatar_url" text,
    "author_kind" text DEFAULT 'external' NOT NULL,
    "author_worker_role" text,
    "author_user_id" text,
    "body" text NOT NULL,
    "html_url" text,
    "github_created_at" integer,
    "github_updated_at" integer,
    "created_at" integer DEFAULT 0 NOT NULL,
    "updated_at" integer DEFAULT 0 NOT NULL
  );
  CREATE UNIQUE INDEX "github_issue_comment_githubCommentId_idx" ON "github_issue_comment" ("github_comment_id");
  CREATE INDEX "github_issue_comment_repositoryFullName_idx" ON "github_issue_comment" ("repository_full_name");
`;

type TestClient = { executeMultiple(sql: string): Promise<void> };

async function createDualRecordDatabase() {
  const database = drizzle({ connection: { url: ":memory:" }, schema }) as ReturnType<
    typeof drizzle
  > & { $client: TestClient };
  await database.$client.executeMultiple(CREATE_TABLES);

  await database.insert(schema.organization).values({
    id: ORGANIZATION_ID,
    name: "Octo Org",
    slug: "octo-org",
  });

  // The same repository linked through both apps: reviewer (record A the board reads
  // through) and Coder (record B webhook deliveries / kick-off stamp onto).
  await database.insert(schema.githubInstallation).values([
    {
      id: "installation-reviewer",
      organizationId: ORGANIZATION_ID,
      installationId: "111",
      appSlug: "reviewer-app",
      status: "connected",
    },
    {
      id: "installation-coder",
      organizationId: ORGANIZATION_ID,
      installationId: "222",
      appSlug: "coder-app",
      status: "connected",
    },
  ]);
  await database.insert(schema.githubRepository).values([
    {
      id: REVIEWER_REPOSITORY_ID,
      installationId: "installation-reviewer",
      githubRepositoryId: "1001",
      owner: "octo-org",
      name: "widgets",
      fullName: REPOSITORY_FULL_NAME,
      selected: true,
    },
    {
      id: CODER_REPOSITORY_ID,
      installationId: "installation-coder",
      githubRepositoryId: "2002",
      owner: "octo-org",
      name: "widgets",
      fullName: REPOSITORY_FULL_NAME,
      selected: true,
    },
  ]);

  return database;
}

async function seedIssue(
  database: Awaited<ReturnType<typeof createDualRecordDatabase>>,
  overrides: Partial<typeof schema.githubIssue.$inferInsert> & {
    githubRepositoryId: string;
    number: number;
  },
) {
  await database.insert(schema.githubIssue).values({
    id: `issue-${overrides.githubRepositoryId}-${overrides.number}`,
    organizationId: ORGANIZATION_ID,
    repositoryFullName: REPOSITORY_FULL_NAME,
    title: `Issue #${overrides.number}`,
    ...overrides,
  });
}

describe("issue-store reads are topology-independent across dual repo records", () => {
  test("board overlays read through the reviewer record surface a claim stamped on the Coder record", async () => {
    const database = await createDualRecordDatabase();

    // The board's reviewer-app record has the plain synced issue (no claim); the
    // claim was stamped on the Coder-app record (live-observed on issue #3).
    await seedIssue(database, { githubRepositoryId: REVIEWER_REPOSITORY_ID, number: 3 });
    await seedIssue(database, {
      githubRepositoryId: CODER_REPOSITORY_ID,
      number: 3,
      claimedByWorkerRole: IMPLEMENTATION_WORKER_ROLE,
      claimedByRunId: "run-coder-3",
      claimedAt: new Date(),
    });

    const overlays = await loadIssueOverlays(database, REVIEWER_REPOSITORY_ID);
    expect(overlays.get(3)?.claimed).toBe(true);

    // And the single-issue detail overlay agrees through the same reviewer record.
    const overlay = await loadIssueOverlay(database, REVIEWER_REPOSITORY_ID, 3);
    expect(overlay?.claimed).toBe(true);
  });

  test("overlays merge the more advanced linked PR across records (Merged lane stays correct)", async () => {
    const database = await createDualRecordDatabase();

    // Reviewer record sees the PR still open; the Coder record recorded the merge.
    await seedIssue(database, {
      githubRepositoryId: REVIEWER_REPOSITORY_ID,
      number: 5,
      linkedPullRequestNumber: 42,
      linkedPullRequestState: "open",
      linkedPullRequestMerged: false,
    });
    await seedIssue(database, {
      githubRepositoryId: CODER_REPOSITORY_ID,
      number: 5,
      linkedPullRequestNumber: 42,
      linkedPullRequestState: "closed",
      linkedPullRequestMerged: true,
    });

    const overlays = await loadIssueOverlays(database, REVIEWER_REPOSITORY_ID);
    expect(overlays.get(5)?.linkedPullRequest).toEqual({ state: "closed", merged: true });
  });

  test("the revision watermark read through the reviewer record reflects a comment pinned to the Coder record and bumps", async () => {
    const database = await createDualRecordDatabase();
    await seedIssue(database, { githubRepositoryId: REVIEWER_REPOSITORY_ID, number: 7 });

    const before = await loadRepositoryIssuesRevision(database, REVIEWER_REPOSITORY_ID);

    // A comment arrives on the Coder-app record (pinned there by delivery order).
    await upsertSyncedIssueComment(database, {
      organizationId: ORGANIZATION_ID,
      githubRepositoryId: CODER_REPOSITORY_ID,
      repositoryFullName: REPOSITORY_FULL_NAME,
      issueNumber: 7,
      githubCommentId: "comment-900",
      authorLogin: "octocat",
      authorAvatarUrl: null,
      body: "on the coder record",
      htmlUrl: null,
      githubCreatedAt: new Date(),
      githubUpdatedAt: new Date(),
    });

    // The board polling through the reviewer record must see the watermark move.
    const afterComment = await loadRepositoryIssuesRevision(database, REVIEWER_REPOSITORY_ID);
    expect(afterComment).not.toBe(before);

    // A second comment on the same (Coder) record bumps it again.
    await upsertSyncedIssueComment(database, {
      organizationId: ORGANIZATION_ID,
      githubRepositoryId: CODER_REPOSITORY_ID,
      repositoryFullName: REPOSITORY_FULL_NAME,
      issueNumber: 7,
      githubCommentId: "comment-901",
      authorLogin: "octocat",
      authorAvatarUrl: null,
      body: "another on the coder record",
      htmlUrl: null,
      githubCreatedAt: new Date(),
      githubUpdatedAt: new Date(),
    });
    const afterSecondComment = await loadRepositoryIssuesRevision(database, REVIEWER_REPOSITORY_ID);
    expect(afterSecondComment).not.toBe(afterComment);

    // The issue-scoped watermark (detail view) is likewise topology-independent.
    const scoped = await loadRepositoryIssuesRevision(database, REVIEWER_REPOSITORY_ID, 7);
    expect(scoped).not.toBe("0:0:0:0");
  });
});
