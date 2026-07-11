import type { GitHubIssueSummary } from "../github-app";
import {
  ISSUE_STAGES,
  ISSUE_STAGE_LABELS,
  deriveStage,
  isAgentClaimable,
  type IssueStage,
  type StageInput,
} from "./stage";

// The issues service is the single deep module behind which all issue behavior
// lives (see issue #19). The signed webhook, the authenticated oRPC procedures,
// and (later) agent tools all call in here; none re-implement its logic. The
// GitHub client is an interface so tests drive it with a fake + a real test DB.

export type BoardIssue = GitHubIssueSummary & {
  stage: IssueStage;
  claimable: boolean;
};

export type BoardColumn = {
  stage: IssueStage;
  label: string;
  issues: BoardIssue[];
};

// Our store's bookkeeping for an issue (claim + linked-PR state), keyed by issue
// number. Empty in the pure-live path; the webhook fills it in.
export type IssueOverlay = {
  claimed?: boolean;
  runStatus?: StageInput["runStatus"];
  linkedPullRequest?: StageInput["linkedPullRequest"];
  closedByMerge?: boolean;
  blocked?: boolean;
};

function stageInputFor(issue: GitHubIssueSummary, overlay?: IssueOverlay): StageInput {
  return {
    issueState: issue.state,
    labels: issue.labels,
    claimed: overlay?.claimed ?? false,
    runStatus: overlay?.runStatus ?? null,
    linkedPullRequest: overlay?.linkedPullRequest ?? null,
    closedByMerge: overlay?.closedByMerge ?? false,
    blocked: overlay?.blocked ?? false,
  };
}

// Pure: group live issues into stage columns. Every stage is always present, so
// empty stages render as empty lanes (the kanban-like layout). Overlays carry the
// claim / linked-PR bookkeeping from our store, keyed by issue number.
export function buildBoard(
  issues: GitHubIssueSummary[],
  overlays: Map<number, IssueOverlay> = new Map(),
): BoardColumn[] {
  const columns: BoardColumn[] = ISSUE_STAGES.map((stage) => ({
    stage,
    label: ISSUE_STAGE_LABELS[stage],
    issues: [],
  }));
  const byStage = new Map(columns.map((column) => [column.stage, column]));

  for (const issue of issues) {
    const input = stageInputFor(issue, overlays.get(issue.number));
    const stage = deriveStage(input);
    const column = byStage.get(stage);
    if (column) {
      column.issues.push({ ...issue, stage, claimable: isAgentClaimable(input) });
    }
  }

  return columns;
}

// Derive a single issue's stage + claimable flag from the live issue and its
// store overlay — the detail transport's counterpart to buildBoard's per-issue
// derivation, so the detail's stage matches the lane the board puts it in.
export function deriveIssueStage(
  issue: GitHubIssueSummary,
  overlay?: IssueOverlay,
): { stage: IssueStage; claimable: boolean } {
  const input = stageInputFor(issue, overlay);
  return { stage: deriveStage(input), claimable: isAgentClaimable(input) };
}

// The GitHub side of the module, as an interface so the transport can inject the
// real adapter and tests can inject a fake.
export type GitHubIssuesClient = {
  listIssues(installationId: string, owner: string, repo: string): Promise<GitHubIssueSummary[]>;
  getIssue(
    installationId: string,
    owner: string,
    repo: string,
    issueNumber: number,
  ): Promise<GitHubIssueSummary>;
};

export type RepositoryTarget = {
  installationId: string;
  owner: string;
  repo: string;
};

export async function listBoard(
  client: GitHubIssuesClient,
  target: RepositoryTarget,
  overlays?: Map<number, IssueOverlay>,
): Promise<BoardColumn[]> {
  const issues = await client.listIssues(target.installationId, target.owner, target.repo);
  return buildBoard(issues, overlays);
}
