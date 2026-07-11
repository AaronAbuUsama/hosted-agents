import { ISSUE_STAGE_LABELS, deriveStage, type IssueStage } from "@hosted-agents/api/issues/stage";

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

// The StatusDot variant the detail renders per stage. Kept here (not inline in the
// view) so the stage → dot-colour mapping is exhaustively compiler-checked over
// IssueStage and unit-tested — a wrong colour for a lane is a render regression the
// pure view-model tests can catch without standing up the UI.
export type StageDotVariant = "neutral" | "accent" | "warning" | "success";

const STAGE_DOT_VARIANTS: Record<IssueStage, StageDotVariant> = {
  backlog: "neutral",
  ready_for_agent: "accent",
  executing: "warning",
  in_pr: "accent",
  merged: "success",
  // Closed-without-merge is a quiet terminal — neutral, distinct from Merged's
  // success green.
  closed: "neutral",
  failed_blocked: "warning",
};

export function stageDotVariant(stage: IssueStage): StageDotVariant {
  return STAGE_DOT_VARIANTS[stage];
}

export function issueStageDotVariant(issue: StageDerivable): StageDotVariant {
  return stageDotVariant(issueStage(issue));
}

// The composer trims the draft before posting; an empty or all-whitespace draft
// can't post and is never sent to GitHub. Returns the body to post, or null when
// there is nothing to post — the single source of truth for both the Post button's
// enabled state and the submit guard.
export function normalizeCommentBody(draft: string): string | null {
  const body = draft.trim();
  return body.length > 0 ? body : null;
}

// The Coder leads every progress comment with a machine-readable marker embedded as
// an HTML comment (`<!-- worker-role:… role:progress run:… issue:… -->`) so the
// webhook sync can attribute it. GitHub hides HTML comments when it renders
// Markdown, but Astryx's Markdown renderer prints them literally — angle brackets
// and all — so the marker (and any other authored HTML comment) leaks into the UI
// (issue #52 QA-B2). Strip HTML comments before rendering so our thread matches
// GitHub's clean output; the marker stays intact in the stored body server-side, so
// attribution is unaffected. Handles multi-line and multiple comments, then collapses
// the blank lines a removed comment leaves behind so the visible body reads clean.
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;

export function stripHtmlComments(markdown: string): string {
  return markdown
    .replace(HTML_COMMENT_PATTERN, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// Minimal structural view of Astryx's showToast — a type-only surface so this
// module stays React-free and unit-testable while the component's real ShowToastFn
// (body: ReactNode, type?: 'info' | 'error') remains assignable to it.
export type ShowCommentToast = (toast: { body: string; type?: "info" | "error" }) => unknown;

export type PostCommentHandlers = {
  onSuccess: () => Promise<void>;
  onError: (error: unknown) => void;
};

// The postIssueComment mutation's client-side round-trip, as a pure factory over
// plain callbacks. On success it clears the draft, then re-reads the thread so the
// confirmed comment lands in order (issue #19 story 23), then confirms with a
// toast — that ordering matters, so it is asserted in tests. On failure it surfaces
// the error text as an error toast. Extracting it lets the round-trip contract run
// under `bun test` without React / react-query, exercising the exact wiring a
// reviewer would otherwise only see live.
export function createPostCommentHandlers(deps: {
  setDraft: (value: string) => void;
  refetch: () => Promise<unknown>;
  showToast: ShowCommentToast;
}): PostCommentHandlers {
  return {
    onSuccess: async () => {
      deps.setDraft("");
      await deps.refetch();
      deps.showToast({ body: "Comment posted to GitHub." });
    },
    onError: (error) => {
      deps.showToast({
        body: error instanceof Error ? error.message : "Couldn't post the comment.",
        type: "error",
      });
    },
  };
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
