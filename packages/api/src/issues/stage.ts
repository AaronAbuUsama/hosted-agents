// Pure stage derivation for the issues board (see issue #19). The board is a
// table grouped by the stage this function returns — there is no drag-to-move,
// so the stage is always derived, never stored as truth. Kept free of I/O so the
// board's meaning is defined once and unit-tested directly.

export type IssueStage =
  | "backlog"
  | "ready_for_agent"
  | "executing"
  | "in_pr"
  | "merged"
  | "failed_blocked";

// Board column order, Failed / Blocked last.
export const ISSUE_STAGES: readonly IssueStage[] = [
  "backlog",
  "ready_for_agent",
  "executing",
  "in_pr",
  "merged",
  "failed_blocked",
] as const;

// Display copy for the columns. "Failed / Blocked" wording is not final (see #19).
export const ISSUE_STAGE_LABELS: Record<IssueStage, string> = {
  backlog: "Backlog",
  ready_for_agent: "Ready for agent",
  executing: "Executing",
  in_pr: "In PR",
  merged: "Merged",
  failed_blocked: "Failed / Blocked",
};

// Product gating labels on end-user repositories. Exact strings are configurable;
// these are the defaults (see #19). Distinct from this repo's own triage labels in
// docs/agents/triage-labels.md.
export const READY_FOR_AGENT_LABEL = "ready for agent";
export const HUMAN_IN_THE_LOOP_LABEL = "human in the loop";

export type LinkedPullRequestState = {
  state: "open" | "closed";
  merged: boolean;
};

export type StageInput = {
  issueState: "open" | "closed";
  labels: readonly string[];
  // A worker Run has claimed this issue (claim bookkeeping lives in our store).
  claimed: boolean;
  // Terminal status of the claiming run, when known.
  runStatus?: "queued" | "running" | "succeeded" | "failed" | null;
  // The pull request linked to this issue, when one exists.
  linkedPullRequest?: LinkedPullRequestState | null;
  // The issue was closed by a merged pull request.
  closedByMerge?: boolean;
  // Explicitly parked on human review.
  blocked?: boolean;
};

// Match labels tolerant of separator + case, so the product's "ready for agent"
// and a tracker's "ready-for-agent" / "ready_for_agent" all count as the same
// gating label (the exact string is configurable per #19).
function normalizeLabel(label: string): string {
  return label.trim().toLowerCase().replace(/[\s_-]+/g, " ");
}

function hasLabel(labels: readonly string[], target: string): boolean {
  const normalized = normalizeLabel(target);
  return labels.some((label) => normalizeLabel(label) === normalized);
}

// Order matters: Failed / Blocked wins from any stage, then terminal PR states,
// then in-flight, then the gating label, then the default.
export function deriveStage(input: StageInput): IssueStage {
  if (input.runStatus === "failed" || input.blocked) {
    return "failed_blocked";
  }

  const pr = input.linkedPullRequest;
  if (pr?.merged || (input.issueState === "closed" && input.closedByMerge)) {
    return "merged";
  }
  if (pr && pr.state === "open") {
    return "in_pr";
  }
  if (input.claimed) {
    return "executing";
  }
  if (hasLabel(input.labels, READY_FOR_AGENT_LABEL)) {
    return "ready_for_agent";
  }
  return "backlog";
}

// The kick-off affordance is enabled only when an agent may claim the issue.
// "human in the loop" gates the agent out even if the ready label is also present.
export function isAgentClaimable(input: StageInput): boolean {
  if (hasLabel(input.labels, HUMAN_IN_THE_LOOP_LABEL)) {
    return false;
  }
  if (!hasLabel(input.labels, READY_FOR_AGENT_LABEL)) {
    return false;
  }
  return deriveStage(input) === "ready_for_agent";
}
