import { and, count, eq, max } from "drizzle-orm";

import type { db as productionDb } from "@hosted-agents/db";
import { githubInstallation, githubRepository } from "@hosted-agents/db/schema/github";
import { githubIssue, githubIssueComment } from "@hosted-agents/db/schema/issues";

import { BABYSIT_BLOCKED_LANE_REASONS } from "./babysit";
import type { IssueOverlay } from "./service";

// The store-sync half of the issues deep module (see issue #19). The signed
// webhook transport resolves an installation + repository, then hands the parsed
// GitHub fields here to be upserted into `github_issue` / `github_issue_comment`.
// The oRPC board transport reads the claim + linked-PR overlays back out. Keeping
// both directions in one module means the webhook and the board agree on how a
// synced row maps to a board overlay, and the mapping is unit-testable.
//
// Reads are topology-independent (mirrors issues/babysit.ts). A repository can be
// installed under two GitHub Apps (reviewer + Coder), producing two
// `github_repository` rows that share one `owner/name` but differ by
// `installation_id`; per-app webhook deliveries upsert into whichever row they
// resolved, so an issue's claim or a comment can land on either record. The write
// paths keep stamping the transport's record — but the reads below scope by
// (organization, repository full name), never a single repo-row id, so the board
// and detail see every synced row for the repo no matter which app's record it was
// pinned to. Where two records both carry a row for one issue number, the overlays
// are merged so a claim / linked PR on either record surfaces.

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
  repositoryFullName: string;
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
      repositoryFullName: input.repositoryFullName,
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

// Stamp the linked pull request onto a synced issue row so the board's In PR (and
// later Merged) lane populates the moment the Coder opens its PR — before the
// `pull_request` webhook round-trips. Keyed by (repository, number); updates only
// the linked-PR columns, so it never disturbs the claim or the GitHub-sourced
// fields. Idempotent: a webhook redelivery of the same PR state is a no-op write.
export async function stampLinkedPullRequest(
  // Only needs `update`; typed narrowly so the implementation worker's database
  // handle (which has no `delete`) can call it without widening SyncDatabase.
  database: Pick<SyncDatabase, "update">,
  input: {
    githubRepositoryId: string;
    issueNumber: number;
    pullRequestNumber: number;
    pullRequestState: "open" | "closed";
    merged?: boolean;
  },
): Promise<void> {
  await database
    .update(githubIssue)
    .set({
      linkedPullRequestNumber: input.pullRequestNumber,
      linkedPullRequestState: input.pullRequestState,
      linkedPullRequestMerged: input.merged ?? false,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(githubIssue.githubRepositoryId, input.githubRepositoryId),
        eq(githubIssue.number, input.issueNumber),
      ),
    );
}

// Stamp a Coder-claimed issue's linked PR as merged (C7 auto-merge). Keyed by the
// claim's own issue row id — never (repo, number) — because the claim is stamped on
// whichever `github_repository` row the board project is linked through (possibly the
// Reviewer app's row), which the auto-merge transport resolves the claim across
// installations by name. The Merged lane reads `linkedPullRequestMerged` off this
// exact row. Idempotent: a redelivery re-sets the same merged state.
export async function markLinkedPullRequestMerged(
  database: Pick<SyncDatabase, "update">,
  input: { issueId: string; pullRequestNumber: number },
): Promise<void> {
  await database
    .update(githubIssue)
    .set({
      linkedPullRequestNumber: input.pullRequestNumber,
      linkedPullRequestState: "closed",
      linkedPullRequestMerged: true,
      updatedAt: new Date(),
    })
    .where(eq(githubIssue.id, input.issueId));
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
  babysitBlockedReason: string | null;
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
    // Babysitting stopped by the round cap or a human takeover parks the issue in
    // Failed / Blocked — `deriveStage` reads `blocked` first. A `human_approved`
    // stop is deliberately excluded: it halts the Coder but the PR is approved and
    // mergeable, so the issue stays In PR / Merged rather than dropping to Blocked.
    blocked:
      row.babysitBlockedReason != null &&
      BABYSIT_BLOCKED_LANE_REASONS.includes(row.babysitBlockedReason),
  };
}

// Pick the more advanced of two linked-PR overlays when both records carry one for
// the same issue: merged beats not-merged, then closed beats open. Keeps the Merged
// / In PR lane correct when the Coder's record recorded the merge but the read came
// in through the reviewer's record (or vice versa).
function pickLinkedPullRequest(
  a: IssueOverlay["linkedPullRequest"],
  b: IssueOverlay["linkedPullRequest"],
): IssueOverlay["linkedPullRequest"] {
  if (!a) return b;
  if (!b) return a;
  if (Boolean(a.merged) !== Boolean(b.merged)) return a.merged ? a : b;
  if (a.state !== b.state) return a.state === "closed" ? a : b;
  return a;
}

// Fold two overlays for the same issue number into one. A repo installed under both
// apps has a row per record; a claim / linked-PR / blocked signal recorded on either
// must surface, so booleans are OR-ed and the linked PR takes the more advanced
// state. This is what makes the read topology-independent even when both records
// hold a row for the issue.
function mergeOverlays(base: IssueOverlay, next: IssueOverlay): IssueOverlay {
  return {
    claimed: Boolean(base.claimed) || Boolean(next.claimed),
    linkedPullRequest: pickLinkedPullRequest(base.linkedPullRequest, next.linkedPullRequest),
    closedByMerge: Boolean(base.closedByMerge) || Boolean(next.closedByMerge),
    blocked: Boolean(base.blocked) || Boolean(next.blocked),
  };
}

const OVERLAY_COLUMNS = {
  number: githubIssue.number,
  linkedPullRequestState: githubIssue.linkedPullRequestState,
  linkedPullRequestMerged: githubIssue.linkedPullRequestMerged,
  closedByMerge: githubIssue.closedByMerge,
  claimedByRunId: githubIssue.claimedByRunId,
  claimedByWorkerRole: githubIssue.claimedByWorkerRole,
  babysitBlockedReason: githubIssue.babysitBlockedReason,
} as const;

// The topology-independent scope of a board repository: its owning organization and
// its `owner/name`. A repo installed under two GitHub Apps has two
// `github_repository` rows sharing one full name; resolving the scope from the row
// the caller already authorized (via requireOrganizationRepository) lets the reads
// below match synced rows pinned to EITHER app's record. Returns null when the row
// is gone — the reads then report an empty store, exactly as an unknown repo-row id
// did before this change.
async function resolveRepositoryScope(
  database: SyncDatabase,
  githubRepositoryId: string,
): Promise<{ organizationId: string; repositoryFullName: string } | null> {
  const [row] = await database
    .select({
      organizationId: githubInstallation.organizationId,
      repositoryFullName: githubRepository.fullName,
    })
    .from(githubRepository)
    .innerJoin(githubInstallation, eq(githubRepository.installationId, githubInstallation.id))
    .where(eq(githubRepository.id, githubRepositoryId))
    .limit(1);

  return row ?? null;
}

// Load every stored issue's overlay for a repository, keyed by issue number, ready
// to hand to `buildBoard`. Scoped by (organization, repository full name) so a claim
// or linked PR recorded on the OTHER app's record still surfaces; overlays for the
// same issue number across records are merged. Issues with no stored row simply have
// no overlay and fall through to their live label-derived stage.
export async function loadIssueOverlays(
  database: SyncDatabase,
  githubRepositoryId: string,
): Promise<Map<number, IssueOverlay>> {
  const scope = await resolveRepositoryScope(database, githubRepositoryId);
  if (!scope) {
    return new Map();
  }

  const rows = await database
    .select(OVERLAY_COLUMNS)
    .from(githubIssue)
    .where(
      and(
        eq(githubIssue.organizationId, scope.organizationId),
        eq(githubIssue.repositoryFullName, scope.repositoryFullName),
      ),
    );

  const overlays = new Map<number, IssueOverlay>();
  for (const row of rows) {
    const overlay = overlayFromRow(row);
    const existing = overlays.get(row.number);
    overlays.set(row.number, existing ? mergeOverlays(existing, overlay) : overlay);
  }
  return overlays;
}

// `max(updatedAt)` comes back as a Date, an epoch-ms number, a numeric string, or
// null depending on the driver's aggregate mapping; normalize to a stable number
// so the revision token is deterministic. `null` (no rows) collapses to 0.
function toEpochMillis(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : 0;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

// A coarse change-watermark for a repository's synced issues + comments, read only
// from our store — never from GitHub. The board and issue detail poll this on an
// interval and refetch their (GitHub-backed) view when it flips, so a webhook-
// synced change surfaces without a manual reload (issue #26) and without polling
// GitHub on a timer (issue #19 story 22). Pass `issueNumber` to scope the
// watermark to a single issue (the detail view); omit it for the whole board.
//
// Scoped by (organization, repository full name) so a change delivered to EITHER
// app's record moves the watermark — a webhook-synced claim/comment on the Coder's
// record must still refresh a board loaded through the reviewer's record. Rows on
// both records are counted (no dedup needed): the token only has to change on any
// synced change, and counting both records catches a change on either.
//
// The token combines row counts with the latest `updatedAt` across both tables,
// so it moves on an insert (count up), an in-place edit or a claim / linked-PR
// write (updatedAt up), and a comment delete (count down). Two changes that
// perfectly cancel a count and leave the max untouched within one poll window
// would be missed, but the next distinct change re-syncs the view.
export async function loadRepositoryIssuesRevision(
  database: SyncDatabase,
  githubRepositoryId: string,
  issueNumber?: number,
): Promise<string> {
  const scope = await resolveRepositoryScope(database, githubRepositoryId);
  if (!scope) {
    return "0:0:0:0";
  }

  const issueScope = and(
    eq(githubIssue.organizationId, scope.organizationId),
    eq(githubIssue.repositoryFullName, scope.repositoryFullName),
  );
  const commentScope = and(
    eq(githubIssueComment.organizationId, scope.organizationId),
    eq(githubIssueComment.repositoryFullName, scope.repositoryFullName),
  );
  const issueWhere =
    issueNumber === undefined ? issueScope : and(issueScope, eq(githubIssue.number, issueNumber));
  const commentWhere =
    issueNumber === undefined
      ? commentScope
      : and(commentScope, eq(githubIssueComment.issueNumber, issueNumber));

  const [issues] = await database
    .select({ total: count(), latest: max(githubIssue.updatedAt) })
    .from(githubIssue)
    .where(issueWhere);
  const [comments] = await database
    .select({ total: count(), latest: max(githubIssueComment.updatedAt) })
    .from(githubIssueComment)
    .where(commentWhere);

  return [
    issues?.total ?? 0,
    toEpochMillis(issues?.latest),
    comments?.total ?? 0,
    toEpochMillis(comments?.latest),
  ].join(":");
}

// The single-issue overlay for the detail transport; `undefined` when the issue
// has no stored row yet (its stage then derives from live state + labels only).
// Scoped by (organization, repository full name) and merged across records, so a
// claim / linked PR recorded on the OTHER app's record still shows on the detail.
export async function loadIssueOverlay(
  database: SyncDatabase,
  githubRepositoryId: string,
  issueNumber: number,
): Promise<IssueOverlay | undefined> {
  const scope = await resolveRepositoryScope(database, githubRepositoryId);
  if (!scope) {
    return undefined;
  }

  const rows = await database
    .select(OVERLAY_COLUMNS)
    .from(githubIssue)
    .where(
      and(
        eq(githubIssue.organizationId, scope.organizationId),
        eq(githubIssue.repositoryFullName, scope.repositoryFullName),
        eq(githubIssue.number, issueNumber),
      ),
    );

  let overlay: IssueOverlay | undefined;
  for (const row of rows) {
    const next = overlayFromRow(row);
    overlay = overlay ? mergeOverlays(overlay, next) : next;
  }
  return overlay;
}
