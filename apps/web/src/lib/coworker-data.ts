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
  status: ProjectIssueStatus;
  labels: string[];
  assignee: string;
  comments: number;
  updated: string;
  githubUrl: string;
  lastComment: string;
  linkedRunId?: string;
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
    status: "In progress",
    labels: ["coworker:in-progress", "backend", "provider"],
    assignee: "Umar",
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
    status: "Ready",
    labels: ["coworker:ready", "frontend"],
    assignee: "Unassigned",
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
    status: "In review",
    labels: ["coworker:review", "pull-request"],
    assignee: "Abu Bakr",
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
    status: "Done",
    labels: ["coworker:done", "docs"],
    assignee: "Human",
    comments: 7,
    updated: "Yesterday",
    githubUrl: "https://github.com/coworker/web/issues/101",
    lastComment: "The branch-scope note was merged into the setup runbook.",
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
