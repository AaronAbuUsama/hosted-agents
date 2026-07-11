import { BABYSIT_BLOCKED_LANE_REASONS } from "./babysit";

// C7 — auto-merge on approval, gated to an allow-list of repositories (spec #21
// story 10). By the time this module runs, C6's babysit admission has already
// matched the submitted review to a Coder-claimed issue's pull request (that match
// IS the "PR is Coder-owned" proof — the linked-PR stamp or the `coder/issue-<n>-*`
// branch) and classified the review through `decideBabysitReview`. On the approval
// branch the transport asks this module whether to squash-merge the pull request.
//
// The decision is PURE and total (unit-tested directly): it reads only the review
// state, whether the repository is on the allow-list, whether the pull request is
// still open, the claim's babysit stop reason, and whether the linked PR has already
// been stamped merged (redelivery idempotency). It never touches GitHub or the DB —
// the transport performs the merge, the Merged-lane stamp, and the Coder comment.
//
//   merge ⇔ review is `approved` ∧ repo ∈ allow-list ∧ PR is Coder-owned (upstream)
//           ∧ PR is open ∧ humans have not taken over (the claim is not parked in
//           Failed / Blocked) ∧ the PR is not already merged.
//
// A human approval on an allow-listed Coder PR SHOULD merge — that is the point of
// the loop — so `human_approved` is deliberately NOT a blocking stop reason (it is
// absent from `BABYSIT_BLOCKED_LANE_REASONS`). A human *takeover* (`human_in_the_loop`)
// or an exhausted loop (`round_cap_reached`) parks the issue Failed / Blocked and
// must never auto-merge.

// Parse `CODER_AUTOMERGE_REPOS` into a set of exact `owner/name` full names. Accepts
// a comma-, whitespace-, or newline-separated list; entries are trimmed and
// lowercased so the membership check is case-insensitive (GitHub owner/repo names
// compare case-insensitively). An unset or empty value yields an empty set —
// nothing auto-merges, the safe default.
export function parseAutomergeRepositories(raw: string | undefined | null): Set<string> {
  if (!raw) {
    return new Set();
  }
  return new Set(
    raw
      .split(/[\s,]+/)
      .map((entry) => entry.trim().toLowerCase())
      .filter((entry) => entry.length > 0),
  );
}

// True when a repository's full name (`owner/name`) is on the auto-merge allow-list.
// Case-insensitive, mirroring `parseAutomergeRepositories`.
export function isRepositoryAutomergeAllowed(
  allowList: ReadonlySet<string>,
  repositoryFullName: string,
): boolean {
  return allowList.has(repositoryFullName.trim().toLowerCase());
}

// The outcome the transport acts on for one approved review on a Coder PR:
//   * `merge`         — squash-merge the pull request, stamp the Merged lane, comment.
//   * `comment_ready` — the repo is not on the allow-list: the PR is good but merging
//                       stays human. Post a "ready to merge" comment and stop.
//   * `skip`          — nothing to do (not an approval, PR closed, humans took over,
//                       or the PR is already merged — a redelivered approval).
export type AutoMergeDecision =
  | { action: "merge" }
  | { action: "comment_ready"; reason: string }
  | { action: "skip"; reason: string };

export type AutoMergeInput = {
  // The submitted review's state. Only `approved` can merge.
  reviewState: string;
  // The pull request's repository (`owner/name`) is on `CODER_AUTOMERGE_REPOS`.
  repositoryAllowListed: boolean;
  // The pull request is still open on GitHub (a redelivery after merge/close is not).
  pullRequestOpen: boolean;
  // The claim's babysit stop reason (null = still running). A stop reason that parks
  // the issue Failed / Blocked (`human_in_the_loop`, `round_cap_reached`) blocks the
  // merge; `human_approved` does not (it is the approval we act on).
  babysitBlockedReason: string | null;
  // The linked PR is already stamped merged — a redelivery of the approval after the
  // merge already landed must be a no-op (idempotency).
  alreadyMerged: boolean;
};

// Pure decision. Ordering is deliberate: reject the states that can never merge
// first (not approved, already merged, closed, humans-took-over), then split the
// remaining good approvals on the allow-list.
export function decideAutoMerge(input: AutoMergeInput): AutoMergeDecision {
  if (input.reviewState !== "approved") {
    return { action: "skip", reason: "review_not_approved" };
  }
  if (input.alreadyMerged) {
    // A redelivered approval after the merge already landed — no-op.
    return { action: "skip", reason: "already_merged" };
  }
  if (!input.pullRequestOpen) {
    return { action: "skip", reason: "pull_request_not_open" };
  }
  if (
    input.babysitBlockedReason != null &&
    BABYSIT_BLOCKED_LANE_REASONS.includes(input.babysitBlockedReason)
  ) {
    // A human took over (`human_in_the_loop`) or the loop exhausted its rounds
    // (`round_cap_reached`): the issue is parked Failed / Blocked. Never auto-merge a
    // PR humans have taken over or the babysit loop gave up on. (`human_approved` is
    // NOT in this set — it is the approval we act on.)
    return { action: "skip", reason: "babysit_stopped" };
  }
  if (!input.repositoryAllowListed) {
    // The PR is approved and mergeable, but this repository is not on the allow-list:
    // comment that it is ready and stop. Merging stays a human action.
    return { action: "comment_ready", reason: "repository_not_allow_listed" };
  }
  return { action: "merge" };
}
