import { and, eq } from "drizzle-orm";

import type { db as productionDb } from "@hosted-agents/db";
import { githubIssue, githubIssueComment } from "@hosted-agents/db/schema/issues";

import type { IssueOverlay } from "./service";

// The store-sync half of the issues deep module (see issue #19). The signed
// webhook transport resolves an installation + repository, then hands the parsed
// GitHub fields here to be upserted into `github_issue` / `github_issue_comment`.
// The oRPC board transport reads the claim + linked-PR overlays back out. Keeping
// both directions in one module means the webhook and the board agree on how a
// synced row maps to a board overlay, and the mapping is unit-testable.

// A drizzle handle scoped to what sync needs — the production db and a webhook
// transaction both satisfy it, so the same functions run inside or outside a tx.
type SyncDatabase = Pick<typeof productionDb, "insert" | "select" | "update" | "delete">;

// The GitHub-sourced fields of an issue, already parsed off the webhook payload by
// the transport. Deliberately excludes our own claim / linked-PR bookkeeping: an
// upsert must never clobber a claim recorded by the (future) coding worker.
export type SyncedIssueInput = {
  organizationId: string;
  githubInstallationId: string | null;
  githubRepositoryId: string;
  repositoryFullName: string;
  number: number;
  githubIssueId: string | null;
  nodeId: string | null;
  title: string;
  body: string | null;
  state: "open" | "closed";
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  labels: string[];
  htmlUrl: string | null;
  commentCount: number;
  githubCreatedAt: Date | null;
  githubUpdatedAt: Date | null;
};

// Upsert a synced issue keyed by (repository, number). On conflict we refresh only
// the GitHub-sourced columns — title, body, state, labels, author, counts — and
// leave the claim / linked-PR columns untouched, so a later `issues.edited`
// redelivery does not wipe a claim or a linked pull request our own code recorded.
export async function upsertSyncedIssue(
  database: SyncDatabase,
  input: SyncedIssueInput,
): Promise<{ issueId: string }> {
  const id = crypto.randomUUID();
  const labelsJson = JSON.stringify(input.labels);

  const rows = await database
    .insert(githubIssue)
    .values({
      id,
      organizationId: input.organizationId,
      githubInstallationId: input.githubInstallationId,
      githubRepositoryId: input.githubRepositoryId,
      repositoryFullName: input.repositoryFullName,
      number: input.number,
      githubIssueId: input.githubIssueId,
      nodeId: input.nodeId,
      title: input.title,
      body: input.body,
      state: input.state,
      authorLogin: input.authorLogin,
      authorAvatarUrl: input.authorAvatarUrl,
      labelsJson,
      htmlUrl: input.htmlUrl,
      commentCount: input.commentCount,
      githubCreatedAt: input.githubCreatedAt,
      githubUpdatedAt: input.githubUpdatedAt,
    })
    .onConflictDoUpdate({
      target: [githubIssue.githubRepositoryId, githubIssue.number],
      set: {
        githubInstallationId: input.githubInstallationId,
        githubIssueId: input.githubIssueId,
        nodeId: input.nodeId,
        title: input.title,
        body: input.body,
        state: input.state,
        authorLogin: input.authorLogin,
        authorAvatarUrl: input.authorAvatarUrl,
        labelsJson,
        htmlUrl: input.htmlUrl,
        commentCount: input.commentCount,
        githubCreatedAt: input.githubCreatedAt,
        githubUpdatedAt: input.githubUpdatedAt,
        updatedAt: new Date(),
      },
    })
    .returning({ id: githubIssue.id });

  return { issueId: rows[0]?.id ?? id };
}

// The GitHub-sourced fields of an issue comment. Author identity is recorded as
// `external` (synced from GitHub); a member's or worker's own posts set their kind
// through the oRPC / agent-tool transports, not here.
export type SyncedIssueCommentInput = {
  organizationId: string;
  githubRepositoryId: string;
  issueNumber: number;
  githubCommentId: string;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  body: string;
  htmlUrl: string | null;
  githubCreatedAt: Date | null;
  githubUpdatedAt: Date | null;
};

// Upsert a synced comment keyed by its GitHub comment id (so a redelivery or an
// `issue_comment.edited` updates in place rather than duplicating). Links to the
// issue row when that issue is already synced; a comment can otherwise arrive
// before its issue, so `issueId` stays nullable and is backfilled on the next
// touch once the issue exists.
export async function upsertSyncedIssueComment(
  database: SyncDatabase,
  input: SyncedIssueCommentInput,
): Promise<void> {
  const [issueRow] = await database
    .select({ id: githubIssue.id })
    .from(githubIssue)
    .where(
      and(
        eq(githubIssue.githubRepositoryId, input.githubRepositoryId),
        eq(githubIssue.number, input.issueNumber),
      ),
    )
    .limit(1);
  const issueId = issueRow?.id ?? null;

  await database
    .insert(githubIssueComment)
    .values({
      id: crypto.randomUUID(),
      organizationId: input.organizationId,
      githubRepositoryId: input.githubRepositoryId,
      issueId,
      issueNumber: input.issueNumber,
      githubCommentId: input.githubCommentId,
      authorLogin: input.authorLogin,
      authorAvatarUrl: input.authorAvatarUrl,
      authorKind: "external",
      body: input.body,
      htmlUrl: input.htmlUrl,
      githubCreatedAt: input.githubCreatedAt,
      githubUpdatedAt: input.githubUpdatedAt,
    })
    .onConflictDoUpdate({
      target: githubIssueComment.githubCommentId,
      set: {
        // Only relink when we found the issue, so a later touch never nulls an
        // already-linked comment.
        ...(issueId ? { issueId } : {}),
        authorLogin: input.authorLogin,
        authorAvatarUrl: input.authorAvatarUrl,
        body: input.body,
        htmlUrl: input.htmlUrl,
        githubUpdatedAt: input.githubUpdatedAt,
        updatedAt: new Date(),
      },
    });
}

// Remove a synced comment for an `issue_comment.deleted` delivery. Idempotent — a
// redelivery of the delete simply matches no row.
export async function deleteSyncedIssueComment(
  database: SyncDatabase,
  githubCommentId: string,
): Promise<void> {
  await database
    .delete(githubIssueComment)
    .where(eq(githubIssueComment.githubCommentId, githubCommentId));
}

// The columns the board's stage overlay is derived from.
type IssueOverlayRow = {
  number: number;
  linkedPullRequestState: string | null;
  linkedPullRequestMerged: boolean | null;
  closedByMerge: boolean;
  claimedByRunId: string | null;
  claimedByWorkerRole: string | null;
};

// Turn a stored issue row into the board's claim / linked-PR overlay. Labels and
// issue state stay live (the board reads them from GitHub); the overlay carries
// only what our store owns: whether a worker has claimed it and the linked pull
// request's state. That is what lets Executing / In PR / Merged populate.
function overlayFromRow(row: IssueOverlayRow): IssueOverlay {
  const linkedPullRequest = row.linkedPullRequestState
    ? {
        state: row.linkedPullRequestState === "closed" ? ("closed" as const) : ("open" as const),
        merged: Boolean(row.linkedPullRequestMerged),
      }
    : null;

  return {
    claimed: Boolean(row.claimedByRunId ?? row.claimedByWorkerRole),
    linkedPullRequest,
    closedByMerge: row.closedByMerge,
  };
}

const OVERLAY_COLUMNS = {
  number: githubIssue.number,
  linkedPullRequestState: githubIssue.linkedPullRequestState,
  linkedPullRequestMerged: githubIssue.linkedPullRequestMerged,
  closedByMerge: githubIssue.closedByMerge,
  claimedByRunId: githubIssue.claimedByRunId,
  claimedByWorkerRole: githubIssue.claimedByWorkerRole,
} as const;

// Load every stored issue's overlay for a repository, keyed by issue number, ready
// to hand to `buildBoard`. Issues with no stored row simply have no overlay and
// fall through to their live label-derived stage.
export async function loadIssueOverlays(
  database: SyncDatabase,
  githubRepositoryId: string,
): Promise<Map<number, IssueOverlay>> {
  const rows = await database
    .select(OVERLAY_COLUMNS)
    .from(githubIssue)
    .where(eq(githubIssue.githubRepositoryId, githubRepositoryId));

  const overlays = new Map<number, IssueOverlay>();
  for (const row of rows) {
    overlays.set(row.number, overlayFromRow(row));
  }
  return overlays;
}

// The single-issue overlay for the detail transport; `undefined` when the issue
// has no stored row yet (its stage then derives from live state + labels only).
export async function loadIssueOverlay(
  database: SyncDatabase,
  githubRepositoryId: string,
  issueNumber: number,
): Promise<IssueOverlay | undefined> {
  const [row] = await database
    .select(OVERLAY_COLUMNS)
    .from(githubIssue)
    .where(
      and(
        eq(githubIssue.githubRepositoryId, githubRepositoryId),
        eq(githubIssue.number, issueNumber),
      ),
    )
    .limit(1);

  return row ? overlayFromRow(row) : undefined;
}
