import { and, eq, inArray, or } from "drizzle-orm";

import type { db as productionDb } from "@hosted-agents/db";
import {
  GITHUB_ISSUE_IMPLEMENTATION_RUN_TYPE,
  IMPLEMENTATION_WORKER_ROLE,
  agentRun,
} from "@hosted-agents/db/schema/agent-runs";
import { githubIssue } from "@hosted-agents/db/schema/issues";

// The babysit half of the issues deep module (see issue #19, spec #21 stories
// 7–9, C6). When the Reviewer requests changes on a Coder-owned pull request, the
// signed webhook wakes the Coder for a fresh fix round on the same branch — up to
// a hard cap — then stops. Humans always win (spec #21 story 8): a human review, a
// human push (`pull_request.synchronize`), or a human pull-request comment ends
// babysitting immediately — no further fix rounds, the issue drops to
// human-in-the-loop handling.
//
// The transport (the signed webhook) resolves the installation + repository and
// the actor/state, then asks this module which issue the event belongs to and what
// should happen. A `pull_request_review` runs through the pure decision
// (`decideBabysitReview`, unit-tested directly). Every event that has to find the
// claim — the review, a human push (`pull_request.synchronize`), and a human
// pull-request comment — matches it across installations by (org, repo full name,
// PR/branch) via `findCoderClaimedIssueByRepositoryName`: the claim is stamped on
// whichever `github_repository` row the board project is linked through (which may
// be the Reviewer app's row), while a review/push/comment can arrive on a different
// app's copy with its own repo row, so a repo-row-id scoped lookup would silently
// miss the claim. Yields then set the stop flag through `recordBabysitStopped`. The
// query + write helpers keep the round counter and the stop flag as data on the
// claim, so the board's Failed / Blocked lane and every later event agree on when
// the Coder has yielded.

// The maximum number of review-driven fix rounds the Coder is dispatched on one
// pull request before the issue is parked as Failed / Blocked. Three rounds.
export const BABYSIT_ROUND_CAP = 3;

// Why babysitting stopped, recorded on the claim. `round_cap_reached` — the Coder
// exhausted its fix rounds. `human_in_the_loop` — a human took over the pull
// request (a review requesting changes, a push, or a comment), so the Coder yields
// (humans always win). Both move the issue to Failed / Blocked and make every later
// review a no-op. `human_approved` — a human APPROVED the pull request: it likewise
// stops the Coder (no more bot fix rounds), but the PR is good, so it stays
// mergeable (C7 owns the merge) and does NOT drop to Failed / Blocked — the board
// overlay excludes this reason from the blocked lane while still treating the claim
// as stopped.
export const BABYSIT_STOP_ROUND_CAP = "round_cap_reached";
export const BABYSIT_STOP_HUMAN = "human_in_the_loop";
export const BABYSIT_STOP_HUMAN_APPROVED = "human_approved";

// The stop reasons that park the issue in the board's Failed / Blocked lane. A
// human approval stops babysitting without blocking (the PR is mergeable), so it is
// deliberately absent here — `overlayFromRow` (issues/sync) uses this to keep an
// approved PR out of Failed / Blocked while still honoring the stop.
export const BABYSIT_BLOCKED_LANE_REASONS: readonly string[] = [
  BABYSIT_STOP_ROUND_CAP,
  BABYSIT_STOP_HUMAN,
];

// A drizzle handle scoped to what the babysit helpers need — the production db and
// a webhook transaction both satisfy it, so the query + writes run inside the
// admission transaction alongside the delivery-ledger claim.
type BabysitDatabase = Pick<typeof productionDb, "select" | "update">;

// What the decision needs to know about a Coder-claimed issue's babysit state.
// `linkedPullRequestMerged` is read only by C7's auto-merge idempotency guard (a
// redelivered approval after the merge already landed is a no-op); the babysit
// decision itself ignores it.
export type BabysitClaim = {
  issueId: string;
  number: number;
  babysitRound: number;
  babysitBlockedReason: string | null;
  linkedPullRequestMerged: boolean | null;
};

// The outcome the transport acts on for one `pull_request_review.submitted`:
//   * `babysit`  — enqueue one fix run on the same branch; persist `round`.
//   * `blocked`  — the round cap is reached: no run, park the issue Failed /
//                  Blocked, and post the Coder's explanation comment.
//   * `yield`    — a human acted on the pull request: no run, stop babysitting. The
//                  reason distinguishes a takeover (`human_in_the_loop`, → Failed /
//                  Blocked) from an approval (`human_approved`, stays mergeable).
//   * `noop`     — nothing to do (a bot/already-stopped approval C7 owns, an
//                  already-stopped PR, or a review state that does not drive a fix
//                  round).
export type BabysitReviewDecision =
  | { action: "babysit"; round: number }
  | { action: "blocked"; reason: typeof BABYSIT_STOP_ROUND_CAP }
  | { action: "yield"; reason: typeof BABYSIT_STOP_HUMAN | typeof BABYSIT_STOP_HUMAN_APPROVED }
  | { action: "noop"; reason: string };

export type BabysitReviewInput = {
  // The submitted review's state ("changes_requested" | "approved" | "commented"
  // | "dismissed").
  reviewState: string;
  // The delivery sender is a human (`sender.type === "User"`), not the Reviewer or
  // Coder GitHub App (both `Bot`). Humans always win.
  senderIsHuman: boolean;
  // Rounds already dispatched on this pull request (the claim's counter).
  babysitRound: number;
  // Babysitting has already stopped (cap reached earlier, or a human took over).
  alreadyStopped: boolean;
  cap?: number;
};

// Pure decision: given the review's state + actor and the claim's babysit
// bookkeeping, decide what the Coder does. Ordering is deliberate:
//   1. An `approved` review is the approval path C7 owns — C6 does not enqueue a
//      fix round. But humans always win: a HUMAN approval on a still-running loop
//      also stops babysitting so no later bot `changes_requested` can dispatch the
//      Coder onto a PR a human has acted on. That stop is `human_approved` — it
//      keeps the PR mergeable (C7 still merges it) rather than parking it Failed /
//      Blocked. A bot approval, or any approval once babysitting already stopped,
//      stays a pure no-op handed to C7.
//   2. A stopped PR (cap reached or human-held) never resumes.
//   3. Any other human review ends babysitting (humans always win) — a takeover
//      that drops the issue to Failed / Blocked.
//   4. Only a bot's `changes_requested` drives a fix round; below the cap it
//      babysits, at the cap it blocks.
export function decideBabysitReview(input: BabysitReviewInput): BabysitReviewDecision {
  const cap = input.cap ?? BABYSIT_ROUND_CAP;

  if (input.reviewState === "approved") {
    if (input.senderIsHuman && !input.alreadyStopped) {
      // Humans always win: end the loop, but the PR is approved — keep it mergeable.
      return { action: "yield", reason: BABYSIT_STOP_HUMAN_APPROVED };
    }
    // C7 (auto-merge) owns the approval path; C6 deliberately does nothing.
    return { action: "noop", reason: "approved_review" };
  }
  if (input.alreadyStopped) {
    return { action: "noop", reason: "babysit_already_stopped" };
  }
  if (input.senderIsHuman) {
    return { action: "yield", reason: BABYSIT_STOP_HUMAN };
  }
  if (input.reviewState !== "changes_requested") {
    return { action: "noop", reason: "review_state_not_actionable" };
  }
  if (input.babysitRound >= cap) {
    return { action: "blocked", reason: BABYSIT_STOP_ROUND_CAP };
  }
  return { action: "babysit", round: input.babysitRound + 1 };
}

// The claim columns the babysit decision reads (plus `linkedPullRequestMerged`,
// which only C7's auto-merge idempotency guard consults).
const babysitClaimColumns = {
  issueId: githubIssue.id,
  number: githubIssue.number,
  babysitRound: githubIssue.babysitRound,
  babysitBlockedReason: githubIssue.babysitBlockedReason,
  linkedPullRequestMerged: githubIssue.linkedPullRequestMerged,
};

// A pull request is the Coder's iff its issue carries the PR as its linked PR
// (stamped when the Coder opened it) OR is the issue the Coder branch is named for
// (`coder/issue-<n>-*`, parsed by the transport into `branchIssueNumber`). The
// branch match is what lets a push/review match before the linked-PR stamp lands.
function pullRequestOrBranchMatch(pullRequestNumber: number, branchIssueNumber: number | null) {
  const pullRequestMatch = eq(githubIssue.linkedPullRequestNumber, pullRequestNumber);
  return branchIssueNumber == null
    ? pullRequestMatch
    : or(pullRequestMatch, eq(githubIssue.number, branchIssueNumber));
}

// Find the Coder-claimed issue a pull request belongs to, matched by (organization,
// repository full name) — never a single repository-row id. The claim is stamped by
// kick-off on whichever `github_repository` row the board project is linked through
// (which may be the Reviewer app's row, not the Coder app's), while the events that
// have to find it — a `pull_request_review`, a human push (`pull_request.synchronize`),
// a human pull-request comment — can each arrive on a different app's installation
// with its own repo row. github_repository rows are per-installation, so a repo-row-id
// lookup would silently miss the claim whenever the review app's row differs from the
// claim's row. Scoping by (org, repo full name) plus the implementation-role filter
// and the PR/branch match (see `pullRequestOrBranchMatch`) finds the one claimed row
// across apps, and returns null when no Coder-claimed issue owns the PR (so a review /
// push / comment on a human's PR is never babysat).
export async function findCoderClaimedIssueByRepositoryName(
  database: BabysitDatabase,
  params: {
    organizationId: string;
    repositoryFullName: string;
    pullRequestNumber: number;
    branchIssueNumber: number | null;
  },
): Promise<BabysitClaim | null> {
  const [row] = await database
    .select(babysitClaimColumns)
    .from(githubIssue)
    .where(
      and(
        eq(githubIssue.organizationId, params.organizationId),
        eq(githubIssue.repositoryFullName, params.repositoryFullName),
        eq(githubIssue.claimedByWorkerRole, IMPLEMENTATION_WORKER_ROLE),
        pullRequestOrBranchMatch(params.pullRequestNumber, params.branchIssueNumber),
      ),
    )
    .limit(1);

  return row ?? null;
}

// True when a Coder fix run for this issue's pull request is already queued or
// running. Idempotency guard: two distinct `pull_request_review.submitted`
// deliveries for the same round (both apps' copies, a manual redelivery with a
// fresh delivery id, or a re-review before the last fix landed) must not stack a
// second babysit run or double-spend a round.
export async function hasActiveBabysitRun(
  database: BabysitDatabase,
  params: { githubRepositoryId: string; issueNumber: number; pullRequestNumber: number },
): Promise<boolean> {
  const [row] = await database
    .select({ id: agentRun.id })
    .from(agentRun)
    .where(
      and(
        eq(agentRun.githubRepositoryId, params.githubRepositoryId),
        eq(agentRun.runType, GITHUB_ISSUE_IMPLEMENTATION_RUN_TYPE),
        eq(agentRun.issueNumber, params.issueNumber),
        eq(agentRun.pullRequestNumber, params.pullRequestNumber),
        inArray(agentRun.status, ["queued", "running"]),
      ),
    )
    .limit(1);

  return Boolean(row);
}

// Persist the round a babysit run was enqueued for. Keyed by the issue row id so it
// never touches another issue; updates only the counter.
export async function recordBabysitRoundEnqueued(
  database: BabysitDatabase,
  params: { issueId: string; round: number },
): Promise<void> {
  await database
    .update(githubIssue)
    .set({ babysitRound: params.round, updatedAt: new Date() })
    .where(eq(githubIssue.id, params.issueId));
}

// Record that babysitting has stopped for good (round cap reached, a human took
// over, or a human approved). Sets the stop reason — which makes every later review
// a no-op, and (except for `human_approved`) drives the board's Failed / Blocked
// lane — without disturbing the round counter, the claim, or the linked PR.
export async function recordBabysitStopped(
  database: BabysitDatabase,
  params: {
    issueId: string;
    reason:
      | typeof BABYSIT_STOP_ROUND_CAP
      | typeof BABYSIT_STOP_HUMAN
      | typeof BABYSIT_STOP_HUMAN_APPROVED;
  },
): Promise<void> {
  await database
    .update(githubIssue)
    .set({ babysitBlockedReason: params.reason, updatedAt: new Date() })
    .where(eq(githubIssue.id, params.issueId));
}
