import {
  ISSUE_STAGE_LABELS,
  deriveStage,
  isAgentClaimable,
  type IssueStage,
} from "@hosted-agents/api/issues/stage";

// The issue detail renders live GitHub data — getRepositoryIssue returns
// { issue, comments } straight from the API. These helpers turn that raw shape
// into what the view needs (author identity, stage, human-readable dates) and are
// kept pure so they're unit-tested without React, mirroring run-view-model.

export type IssueAuthorKind = "agent" | "member";

// A worker role posts as its GitHub App, and GitHub attributes an App's comments
// to a login suffixed "[bot]". That suffix is the reliable agent-vs-member signal
// (per-role App identities, ADR-0001; see issue #19 stories 16–18). We match the
// suffix tolerant of casing but anchored to the end so a member literally named
// "robot" is not misread as an agent.
const BOT_LOGIN_SUFFIX = /\[bot\]$/i;

export function classifyIssueAuthor(login: string | null | undefined): IssueAuthorKind {
  if (login && BOT_LOGIN_SUFFIX.test(login.trim())) {
    return "agent";
  }
  return "member";
}

// Display name drops the "[bot]" suffix so an agent reads as its app name.
export function issueAuthorDisplayName(login: string | null | undefined): string {
  const trimmed = login?.trim();
  if (!trimmed) {
    return "Unknown";
  }
  return trimmed.replace(BOT_LOGIN_SUFFIX, "");
}

export type StageDerivable = {
  state: "open" | "closed";
  labels: readonly string[];
};

function stageInput(issue: StageDerivable) {
  // The detail seam has only the live issue — no claim/PR overlay — so we derive
  // stage from state + labels exactly as the board does in its pure-live path,
  // keeping the detail's stage consistent with the lane the issue sits in.
  return {
    issueState: issue.state,
    labels: [...issue.labels],
    claimed: false,
    runStatus: null,
    linkedPullRequest: null,
    closedByMerge: false,
    blocked: false,
  } as const;
}

export function issueStage(issue: StageDerivable): IssueStage {
  return deriveStage(stageInput(issue));
}

export function issueStageLabel(issue: StageDerivable): string {
  return ISSUE_STAGE_LABELS[issueStage(issue)];
}

// Whether an agent may claim this issue — drives whether the kick-off affordance
// is shown. The affordance itself stays gated this phase (the coding worker role
// does not exist yet), but it only appears on issues an agent could pick up.
export function issueClaimable(issue: StageDerivable): boolean {
  return isAgentClaimable(stageInput(issue));
}

const ISSUE_DATE_FORMAT = new Intl.DateTimeFormat("en-US", {
  year: "numeric",
  month: "short",
  day: "numeric",
  timeZone: "UTC",
});

// GitHub timestamps are ISO strings (or null when absent). Format to a stable,
// locale-fixed date; unusable input renders as an em dash rather than "Invalid
// Date".
export function formatIssueDate(iso: string | null | undefined): string {
  if (!iso) {
    return "—";
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "—";
  }
  return ISSUE_DATE_FORMAT.format(date);
}
