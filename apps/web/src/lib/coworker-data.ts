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

type BadgeVariant = "blue" | "green" | "red" | "yellow";

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
    repo: "coworker/api",
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
    repo: "customer/mobile",
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
    title: "Provider account",
    status: "Needs attention",
    detail: "Connect OpenAI/Codex before implementation runs can start.",
  },
  {
    title: "GitHub Apps",
    status: "Partial",
    detail: "Abu Bakr is installed. Umar is ready to install in three repositories.",
  },
  {
    title: "Rules",
    status: "Drafting",
    detail: "Review rules are active. Implementation rules need repository scope.",
  },
];

