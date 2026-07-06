export type CoworkerStatus = "Installed" | "Ready" | "Needs setup";

export type Coworker = {
  id: string;
  name: string;
  role: string;
  email: string;
  githubAppName: string;
  purpose: string;
  status: CoworkerStatus;
  repos: number;
  runsThisWeek: number;
  triggers: string[];
};

export type RunStatus = "Running" | "Needs review" | "Completed" | "Blocked";

export type RuleStatus = "Active" | "Draft";

export type Run = {
  id: string;
  title: string;
  coworkerId: string;
  status: RunStatus;
  repo: string;
  branch: string;
  trigger: string;
  started: string;
  duration: string;
  result: string;
  timeline: string[];
  transcript: Array<{ speaker: string; message: string }>;
};

export type ProjectMode = "Pull request review" | "Issue board";

export type ProjectStatus = "Healthy" | "Needs setup" | "Syncing";

export type ProjectLabelSetup = "Synced" | "Not enabled" | "Needs setup";

export type Project = {
  id: string;
  name: string;
  repo: string;
  branches: string[];
  modes: ProjectMode[];
  reviewerCoworkerId?: string;
  implementerCoworkerId?: string;
  status: ProjectStatus;
  labelSetup: ProjectLabelSetup;
  openPullRequests: number;
  syncedIssues: number;
  activeRuns: number;
  lastSync: string;
  summary: string;
};

export type ProjectIssueStatus = "Backlog" | "Ready" | "In progress" | "In review" | "Done";

export type ProjectIssue = {
  id: string;
  projectId: string;
  number: number;
  title: string;
  body: string;
  status: ProjectIssueStatus;
  labels: string[];
  assignee: string;
  openedBy: string;
  opened: string;
  comments: number;
  updated: string;
  githubUrl: string;
  lastComment: string;
  linkedRunId?: string;
};

export type ProjectIssueComment = {
  id: string;
  issueId: string;
  author: string;
  role: "Human" | "Coworker" | "GitHub";
  time: string;
  body: string;
};

export type PullRequestReview = {
  id: string;
  projectId: string;
  number: number;
  title: string;
  branch: string;
  status: "Reviewing" | "Waiting for CI" | "Approved";
  coworkerId: string;
};

export type Rule = {
  id: string;
  name: string;
  coworkerId: string;
  trigger: string;
  scope: string;
  action: string;
  guardrail: string;
  status: RuleStatus;
};

export type SetupStepStatus = "Complete" | "Needs attention" | "Partial" | "Drafting";

export type SetupStep = {
  title: string;
  status: SetupStepStatus;
  detail: string;
};

type BadgeVariant = "blue" | "green" | "neutral" | "red" | "yellow";

export const coworkerStatusBadgeVariants: Record<CoworkerStatus, BadgeVariant> = {
  Installed: "green",
  Ready: "blue",
  "Needs setup": "blue",
};

export const runStatusBadgeVariants: Record<RunStatus, BadgeVariant> = {
  Running: "blue",
  "Needs review": "yellow",
  Completed: "green",
  Blocked: "red",
};

export const summaryRunStatusBadgeVariants: Record<RunStatus, BadgeVariant> = {
  Running: "blue",
  "Needs review": "blue",
  Completed: "green",
  Blocked: "red",
};

export const ruleStatusBadgeVariants: Record<RuleStatus, BadgeVariant> = {
  Active: "green",
  Draft: "yellow",
};

export const setupStepStatusBadgeVariants: Record<SetupStepStatus, BadgeVariant> = {
  Complete: "green",
  "Needs attention": "yellow",
  Partial: "yellow",
  Drafting: "yellow",
};

export const projectStatusBadgeVariants: Record<ProjectStatus, BadgeVariant> = {
  Healthy: "green",
  "Needs setup": "yellow",
  Syncing: "blue",
};

export const projectLabelSetupBadgeVariants: Record<ProjectLabelSetup, BadgeVariant> = {
  Synced: "green",
  "Not enabled": "neutral",
  "Needs setup": "yellow",
};

export const coworkers: Coworker[] = [
  {
    id: "abu-bakr",
    name: "Abu Bakr",
    role: "Code Review Engineer",
    email: "abu-bakr@coworker.tech",
    githubAppName: "Abu Bakr by Coworker",
    purpose:
      "Reviews pull requests, leaves inline comments, suggests patches, and posts merge-blocking checks.",
    status: "Installed",
    repos: 8,
    runsThisWeek: 42,
    triggers: ["Pull request opened", "Pull request synchronized", "Review requested"],
  },
  {
    id: "umar",
    name: "Umar",
    role: "Software Engineer",
    email: "umar@coworker.tech",
    githubAppName: "Umar by Coworker",
    purpose:
      "Takes assigned issues, edits code in a sandbox, opens pull requests, and responds to review feedback.",
    status: "Ready",
    repos: 3,
    runsThisWeek: 17,
    triggers: ["Issue assigned", "Comment command", "Changes requested"],
  },
];

export const projects: Project[] = [
  {
    id: "coworker-web",
    name: "coworker/web",
    repo: "coworker/web",
    branches: ["main", "develop"],
    modes: ["Pull request review", "Issue board"],
    reviewerCoworkerId: "abu-bakr",
    implementerCoworkerId: "umar",
    status: "Healthy",
    labelSetup: "Synced",
    openPullRequests: 4,
    syncedIssues: 128,
    activeRuns: 2,
    lastSync: "2 min ago",
    summary:
      "Full project setup with Abu Bakr reviewing PRs and Umar available for issue-board work.",
  },
  {
    id: "coworker-api",
    name: "coworker/api",
    repo: "coworker/api",
    branches: ["main"],
    modes: ["Pull request review"],
    reviewerCoworkerId: "abu-bakr",
    status: "Healthy",
    labelSetup: "Not enabled",
    openPullRequests: 2,
    syncedIssues: 0,
    activeRuns: 1,
    lastSync: "5 min ago",
    summary: "Minimum setup: Abu Bakr reviews pull requests on main. Issues are not synced.",
  },
  {
    id: "desktop-client",
    name: "desktop-client",
    repo: "customer/mobile",
    branches: ["main", "release/*"],
    modes: ["Pull request review"],
    reviewerCoworkerId: "abu-bakr",
    status: "Needs setup",
    labelSetup: "Not enabled",
    openPullRequests: 1,
    syncedIssues: 0,
    activeRuns: 0,
    lastSync: "Yesterday",
    summary: "Reviewer-only project waiting for branch and GitHub App permission confirmation.",
  },
];

export const projectIssues: ProjectIssue[] = [
  {
    id: "issue-117",
    projectId: "coworker-web",
    number: 117,
    title: "Add provider credential storage",
    body: [
      "## Goal",
      "",
      "Persist provider credentials at the organization boundary so assigned coworkers can start sandboxed implementation runs without copying account secrets into each task.",
      "",
      "## Requirements",
      "",
      "- Store credentials by organization and provider.",
      "- Keep per-coworker overrides out of this slice.",
      "- Return a clear blocked state when no provider account is connected.",
      "- Do not expose secret values through the dashboard API.",
      "",
      "## Proposed shape",
      "",
      "```ts",
      "type ProviderCredential = {",
      "  organizationId: string;",
      '  provider: "openai" | "codex";',
      "  alias: string;",
      '  status: "active" | "revoked";',
      "};",
      "```",
      "",
      "## Acceptance criteria",
      "",
      "| Check | Expected result |",
      "| --- | --- |",
      "| Organization has a credential | Coworker run can enter sandbox setup |",
      "| Credential is missing | Run is blocked before sandbox creation |",
      "| User opens settings | Provider account state is visible without leaking secrets |",
    ].join("\n"),
    status: "In progress",
    labels: ["coworker:in-progress", "backend", "provider"],
    assignee: "Umar",
    openedBy: "Product",
    opened: "Jul 3",
    comments: 12,
    updated: "8 min ago",
    githubUrl: "https://github.com/coworker/web/issues/117",
    lastComment:
      "Umar opened a draft PR and asked whether per-coworker overrides belong in this slice.",
    linkedRunId: "implement-issue-117",
  },
  {
    id: "issue-130",
    projectId: "coworker-web",
    number: 130,
    title: "Clarify auth copy on provider setup",
    body: [
      "## Problem",
      "",
      "The provider setup screen currently makes GitHub access and model/provider access sound like the same thing.",
      "",
      "## Copy direction",
      "",
      "- GitHub installation grants repository access.",
      "- Provider account powers sandboxed coworker runs.",
      "- A reviewer coworker can review PRs without an implementer coworker being enabled.",
      "",
      "> The user should know why a provider account is required before a coworker starts editing code.",
      "",
      "## Suggested microcopy",
      "",
      "```md",
      "Connect a provider account so coworkers can create sandboxes, run checks, and prepare pull requests for your organization.",
      "```",
    ].join("\n"),
    status: "Ready",
    labels: ["coworker:ready", "frontend"],
    assignee: "Unassigned",
    openedBy: "Product",
    opened: "Jul 3",
    comments: 4,
    updated: "21 min ago",
    githubUrl: "https://github.com/coworker/web/issues/130",
    lastComment:
      "Product asked for copy that names the provider account before sandbox work can start.",
  },
  {
    id: "issue-482",
    projectId: "coworker-web",
    number: 482,
    title: "Review GitHub App installation flow",
    body: [
      "## Review scope",
      "",
      "Review the GitHub App installation flow and verify the organization/install mapping is clear before named coworkers are enabled across multiple repositories.",
      "",
      "## Focus areas",
      "",
      "- Signature verification on `/webhooks/github/[coworker]`.",
      "- Installation-to-organization lookup.",
      "- Permission copy for reviewer-only projects.",
      "- Required check behavior while CI is still pending.",
      "",
      "## Expected reviewer output",
      "",
      "- [ ] Inline comments on blocking issues.",
      "- [ ] Summary comment on the pull request.",
      "- [ ] Required check held until CI is green.",
      "",
      "```bash",
      "bunx tsc --noEmit -p apps/web/tsconfig.json",
      "```",
    ].join("\n"),
    status: "In review",
    labels: ["coworker:review", "pull-request"],
    assignee: "Abu Bakr",
    openedBy: "Abu Bakr",
    opened: "Jul 4",
    comments: 18,
    updated: "4 min ago",
    githubUrl: "https://github.com/coworker/web/issues/482",
    lastComment:
      "Abu Bakr is writing inline comments and holding the final check until CI completes.",
    linkedRunId: "review-pr-482",
  },
  {
    id: "issue-101",
    projectId: "coworker-web",
    number: 101,
    title: "Document branch scope defaults",
    body: [
      "## Documentation update",
      "",
      "Document how branch scopes default for review-only projects and how an organization can narrow a coworker to release branches later.",
      "",
      "```yaml",
      "defaultBranchScope:",
      "  include:",
      "    - main",
      "    - develop",
      "  exclude: []",
      "```",
    ].join("\n"),
    status: "Done",
    labels: ["coworker:done", "docs"],
    assignee: "Human",
    openedBy: "Operations",
    opened: "Jul 1",
    comments: 7,
    updated: "Yesterday",
    githubUrl: "https://github.com/coworker/web/issues/101",
    lastComment: "The branch-scope note was merged into the setup runbook.",
  },
];

export const projectIssueComments: ProjectIssueComment[] = [
  {
    id: "comment-117-product",
    issueId: "issue-117",
    author: "Product",
    role: "Human",
    time: "32 min ago",
    body: "Keep the implementation scoped to **organization credentials** first. Per-coworker overrides can be a follow-up if the first migration leaves a clean extension point.",
  },
  {
    id: "comment-117-umar",
    issueId: "issue-117",
    author: "Umar",
    role: "Coworker",
    time: "8 min ago",
    body: "I opened a draft PR with the organization-level model. Open question: should the API expose `credential.alias` in this slice, or keep it internal until settings needs it?",
  },
  {
    id: "comment-130-product",
    issueId: "issue-130",
    author: "Product",
    role: "Human",
    time: "21 min ago",
    body: "The setup copy should name the provider account explicitly before the user reaches sandbox configuration. We should not call this a GitHub credential.",
  },
  {
    id: "comment-482-abu",
    issueId: "issue-482",
    author: "Abu Bakr",
    role: "Coworker",
    time: "4 min ago",
    body: "I am holding the final review until CI completes. Main issue: one missing permission check around `installation.owner`.",
  },
  {
    id: "comment-482-ci",
    issueId: "issue-482",
    author: "GitHub",
    role: "GitHub",
    time: "2 min ago",
    body: "The typecheck job passed. Integration tests are still running.",
  },
  {
    id: "comment-101-ops",
    issueId: "issue-101",
    author: "Operations",
    role: "Human",
    time: "Yesterday",
    body: "The branch-scope note was merged into the setup runbook.",
  },
];

export const pullRequestReviews: PullRequestReview[] = [
  {
    id: "pr-482",
    projectId: "coworker-web",
    number: 482,
    title: "Install named GitHub Apps per coworker",
    branch: "feature/github-app-install",
    status: "Reviewing",
    coworkerId: "abu-bakr",
  },
  {
    id: "pr-119",
    projectId: "coworker-web",
    number: 119,
    title: "Add provider credential storage",
    branch: "umar/issue-117-provider-credentials",
    status: "Waiting for CI",
    coworkerId: "abu-bakr",
  },
  {
    id: "pr-477",
    projectId: "coworker-api",
    number: 477,
    title: "Tighten API auth session expiry",
    branch: "fix/session-expiry",
    status: "Approved",
    coworkerId: "abu-bakr",
  },
];

export const runs: Run[] = [
  {
    id: "review-pr-482",
    title: "Reviewing PR #482",
    coworkerId: "abu-bakr",
    status: "Running",
    repo: "coworker/web",
    branch: "feature/github-app-install",
    trigger: "pull_request.opened",
    started: "4 min ago",
    duration: "04:12",
    result: "Writing inline review comments",
    timeline: [
      "Loaded pull request diff",
      "Read repository agent conventions",
      "Checked changed files for silent failures",
      "Writing inline comments",
      "Waiting for CI before final summary",
    ],
    transcript: [
      {
        speaker: "GitHub",
        message: "PR #482 opened against main in coworker/web.",
      },
      {
        speaker: "Abu Bakr",
        message:
          "I found one missing permission check and one migration ordering risk. I am preparing inline comments before posting the required check.",
      },
    ],
  },
  {
    id: "implement-issue-117",
    title: "Implementing issue #117",
    coworkerId: "umar",
    status: "Needs review",
    repo: "coworker/web",
    branch: "umar/issue-117-provider-credentials",
    trigger: "issue.assigned",
    started: "28 min ago",
    duration: "26:08",
    result: "Opened draft PR #119",
    timeline: [
      "Created sandbox branch",
      "Inspected auth and org schema",
      "Added provider credential model",
      "Ran focused API checks",
      "Opened draft pull request",
    ],
    transcript: [
      {
        speaker: "Umar",
        message:
          "I opened PR #119 with provider credential storage scoped by organization. The remaining decision is whether per-coworker overrides ship in this slice.",
      },
    ],
  },
  {
    id: "review-pr-477",
    title: "Reviewed PR #477",
    coworkerId: "abu-bakr",
    status: "Completed",
    repo: "coworker/api",
    branch: "fix/session-expiry",
    trigger: "pull_request.synchronized",
    started: "2 hr ago",
    duration: "07:44",
    result: "Approved with 3 comments",
    timeline: [
      "Loaded diff",
      "Checked auth/session changes",
      "Posted three inline comments",
      "Marked required check successful",
    ],
    transcript: [
      {
        speaker: "Abu Bakr",
        message:
          "The expiry logic is safe after the final patch. I approved the pull request and left notes on test coverage.",
      },
    ],
  },
  {
    id: "blocked-codex-token",
    title: "Waiting for provider account",
    coworkerId: "umar",
    status: "Blocked",
    repo: "customer/backend",
    branch: "main",
    trigger: "comment.command",
    started: "Yesterday",
    duration: "00:18",
    result: "Provider account missing",
    timeline: [
      "Received command",
      "Resolved organization",
      "Checked provider credential",
      "Blocked before sandbox creation",
    ],
    transcript: [
      {
        speaker: "Umar",
        message:
          "I cannot start this implementation until the organization connects a provider account for sandbox runs.",
      },
    ],
  },
];

export const rules: Rule[] = [
  {
    id: "review-every-pr",
    name: "Review every pull request",
    coworkerId: "abu-bakr",
    trigger: "Pull request opened or synchronized",
    scope: "All production repositories, main and develop",
    action: "Review diff, leave inline comments, post required check",
    guardrail: "Wait for CI before final approval",
    status: "Active",
  },
  {
    id: "implement-assigned-issues",
    name: "Implement assigned issues",
    coworkerId: "umar",
    trigger: "Issue assigned to Umar",
    scope: "Selected repositories",
    action: "Create branch, edit code, run checks, open draft PR",
    guardrail: "Draft mode until a human requests ready for review",
    status: "Draft",
  },
];

export const setupSteps: SetupStep[] = [
  {
    title: "Organization",
    status: "Complete",
    detail: "Capxul Alpha is the active Coworker organization.",
  },
  {
    title: "Projects",
    status: "Partial",
    detail:
      "Three repositories are linked. coworker/api is reviewer-only; coworker/web has the issue board enabled.",
  },
  {
    title: "Provider account",
    status: "Needs attention",
    detail: "Connect OpenAI/Codex before Umar can run implementation sandboxes.",
  },
  {
    title: "GitHub Apps",
    status: "Partial",
    detail:
      "Abu Bakr is installed for PR review. Umar is enabled only where project issue boards are active.",
  },
];
