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
// (`decideBabysitReview`, unit-tested directly). A human push or comment arrives on
// a different installation's copy than the one the claim is bound to, so those
// yields match the claim across installations by (org, repo full name, PR/branch)
// via `findCoderClaimedIssueByRepositoryName`, then set the same stop flag through
// `recordBabysitStopped`. The query + write helpers keep the round counter and the
// stop flag as data on the claim, so the board's Failed / Blocked lane and every
// later event agree on when the Coder has yielded.

// The maximum number of review-driven fix rounds the Coder is dispatched on one
// pull request before the issue is parked as Failed / Blocked. Three rounds.
export const BABYSIT_ROUND_CAP = 3;

// Why babysitting stopped, recorded on the claim. `round_cap_reached` — the Coder
// exhausted its fix rounds. `human_in_the_loop` — a human acted on the pull
// request, so the Coder yields (humans always win). Either value moves the issue
// to Failed / Blocked and makes every later review a no-op.
export const BABYSIT_STOP_ROUND_CAP = "round_cap_reached";
export const BABYSIT_STOP_HUMAN = "human_in_the_loop";

// A drizzle handle scoped to what the babysit helpers need — the production db and
// a webhook transaction both satisfy it, so the query + writes run inside the
// admission transaction alongside the delivery-ledger claim.
type BabysitDatabase = Pick<typeof productionDb, "select" | "update">;

// What the decision needs to know about a Coder-claimed issue's babysit state.
export type BabysitClaim = {
  issueId: string;
  number: number;
  babysitRound: number;
  babysitBlockedReason: string | null;
};

// The outcome the transport acts on for one `pull_request_review.submitted`:
//   * `babysit`  — enqueue one fix run on the same branch; persist `round`.
//   * `blocked`  — the round cap is reached: no run, park the issue Failed /
//                  Blocked, and post the Coder's explanation comment.
//   * `yield`    — a human acted on the pull request: no run, stop babysitting.
//   * `noop`     — nothing to do (an approval C7 owns, an already-stopped PR, or a
//                  review state that does not drive a fix round).
export type BabysitReviewDecision =
  | { action: "babysit"; round: number }
  | { action: "blocked"; reason: typeof BABYSIT_STOP_ROUND_CAP }
  | { action: "yield"; reason: typeof BABYSIT_STOP_HUMAN }
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
//   1. An `approved` review is the approval path C7 owns — do nothing here, even
//      once babysitting has stopped, so C7 can still merge an approved PR.
//   2. A stopped PR (cap reached or human-held) never resumes.
//   3. Any human review ends babysitting (humans always win), regardless of state.
//   4. Only a bot's `changes_requested` drives a fix round; below the cap it
//      babysits, at the cap it blocks.
export function decideBabysitReview(input: BabysitReviewInput): BabysitReviewDecision {
  const cap = input.cap ?? BABYSIT_ROUND_CAP;

  if (input.reviewState === "approved") {
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

// The claim columns the babysit decision reads, shared by both finders.
const babysitClaimColumns = {
  issueId: githubIssue.id,
  number: githubIssue.number,
  babysitRound: githubIssue.babysitRound,
  babysitBlockedReason: githubIssue.babysitBlockedReason,
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

// Find the Coder-claimed issue a pull-request review belongs to, scoped to the
// installation's own repository row. A review is babysat only when its pull request
// is one the Coder owns: the issue must be claimed for the implementation role AND
// match the PR (see `pullRequestOrBranchMatch`). Returns null when no Coder-claimed
// issue matches, so a review on a human's PR (or an unclaimed issue's PR) is never
// babysat. Used by the `pull_request_review` path, which resolves the repository
// under the Coder app's own installation (the one the claim is bound to).
export async function findCoderClaimedIssueForBabysit(
  database: BabysitDatabase,
  params: {
    githubRepositoryId: string;
    pullRequestNumber: number;
    branchIssueNumber: number | null;
  },
): Promise<BabysitClaim | null> {
  const [row] = await database
    .select(babysitClaimColumns)
    .from(githubIssue)
    .where(
      and(
        eq(githubIssue.githubRepositoryId, params.githubRepositoryId),
        eq(githubIssue.claimedByWorkerRole, IMPLEMENTATION_WORKER_ROLE),
        pullRequestOrBranchMatch(params.pullRequestNumber, params.branchIssueNumber),
      ),
    )
    .limit(1);

  return row ?? null;
}

// Find the Coder-claimed issue a pull request belongs to WITHOUT a repository-row
// id — matched by (organization, repository full name) instead. Humans-always-win
// yields for a push (`pull_request.synchronize`) or a pull-request comment arrive
// on the Reviewer app's installation, whose `github_repository` row is a different
// id than the Coder app's (each installation has its own repo row), so those paths
// cannot reuse the repo-id finder above. The claim only ever lives on the Coder
// app's row, and both installations share the org + full name, so scoping by those
// (plus the implementation-role filter) finds the one claimed row across apps.
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

// Record that babysitting has stopped for good (round cap reached, or a human took
// over). Sets the stop reason — which drives the board's Failed / Blocked lane and
// makes every later review a no-op — without disturbing the round counter, the
// claim, or the linked PR.
export async function recordBabysitStopped(
  database: BabysitDatabase,
  params: { issueId: string; reason: typeof BABYSIT_STOP_ROUND_CAP | typeof BABYSIT_STOP_HUMAN },
): Promise<void> {
  await database
    .update(githubIssue)
    .set({ babysitBlockedReason: params.reason, updatedAt: new Date() })
    .where(eq(githubIssue.id, params.issueId));
}
