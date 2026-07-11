export type RenderBoundary = "server-static" | "server-shell-client-data" | "client-live";

export type CollectionName =
  | "organizations"
  | "providerAccounts"
  | "githubInstallations"
  | "repositories"
  | "coworkers"
  | "coworkerRules"
  | "runs"
  | "runEvents"
  | "runMessages";

export type CollectionContract = {
  name: CollectionName;
  record: string;
  key: string;
  ownership: string;
  reads: string[];
  writes: string[];
  syncSource: string;
};

export type ScreenDataContract = {
  route: string;
  job: string;
  renderBoundary: RenderBoundary;
  collections: CollectionName[];
  liveQueries: string[];
  mutations: string[];
  states: string[];
  notes: string[];
};

export const collectionContracts: CollectionContract[] = [
  {
    name: "organizations",
    record: "Organization",
    key: "organization.id",
    ownership: "Current signed-in account owns or belongs to one active Coworker organization.",
    reads: ["active organization", "organization setup status"],
    writes: ["create organization", "rename organization"],
    syncSource: "Better Auth session plus organization API endpoint",
  },
  {
    name: "providerAccounts",
    record: "ProviderAccount",
    key: "providerAccount.id",
    ownership: "Organization-scoped OpenAI/Codex provider connection; coworker overrides can come later.",
    reads: ["connection status", "credential health", "last failed provider check"],
    writes: ["connect provider", "rotate provider credential", "disconnect provider"],
    syncSource: "Provider credential API endpoint",
  },
  {
    name: "githubInstallations",
    record: "GitHubInstallation",
    key: "githubInstallation.id",
    ownership: "Organization GitHub installation plus named GitHub App identity per coworker.",
    reads: ["installation status", "installed account", "installed coworker apps"],
    writes: ["start GitHub App install", "sync installation", "disconnect installation"],
    syncSource: "GitHub App installation API endpoint and webhook refreshes",
  },
  {
    name: "repositories",
    record: "Repository",
    key: "repository.id",
    ownership: "Repositories available to the active organization through GitHub installations.",
    reads: ["repository selector", "branch scope", "repo health"],
    writes: ["include repository", "exclude repository", "refresh repository metadata"],
    syncSource: "GitHub repositories API endpoint",
  },
  {
    name: "coworkers",
    record: "Coworker",
    key: "coworker.id",
    ownership: "Named coworker product identity such as Abu Bakr or Umar.",
    reads: ["roster", "coworker identity", "install status", "run summary"],
    writes: ["install coworker", "disable coworker", "update coworker settings"],
    syncSource: "Coworker API endpoint",
  },
  {
    name: "coworkerRules",
    record: "CoworkerRule",
    key: "coworkerRule.id",
    ownership: "Rules belong to a coworker; they are not a standalone top-level app section.",
    reads: ["rules for coworker", "rule coverage", "trigger/action/guardrail details"],
    writes: ["create rule", "update rule", "enable rule", "disable rule", "delete rule"],
    syncSource: "Coworker rules API endpoint",
  },
  {
    name: "runs",
    record: "Run",
    key: "run.id",
    ownership: "Execution created by a coworker rule, manual command, or GitHub event.",
    reads: ["run list", "run detail facts", "blocked/running summaries"],
    writes: ["trigger run", "cancel run", "retry run", "mark reviewed"],
    syncSource: "Runs API endpoint plus live status refresh",
  },
  {
    name: "runEvents",
    record: "RunEvent",
    key: "runEvent.id",
    ownership: "Ordered timeline event emitted during a run.",
    reads: ["run timeline", "latest live event"],
    writes: ["append run event from worker"],
    syncSource: "Run event stream or polling endpoint",
  },
  {
    name: "runMessages",
    record: "RunMessage",
    key: "runMessage.id",
    ownership: "Conversation transcript between GitHub, coworker, tools, and user.",
    reads: ["run transcript", "chat composer context"],
    writes: ["send user message", "append coworker message", "append tool summary"],
    syncSource: "Run messages API endpoint or stream",
  },
];

export const screenDataContracts: ScreenDataContract[] = [
  {
    route: "/",
    job: "Explain Coworker and route a new visitor to signup or coworker roster preview.",
    renderBoundary: "server-static",
    collections: [],
    liveQueries: [],
    mutations: [],
    states: ["static", "marketing CTA"],
    notes: ["No TanStack DB collection should be required for the marketing route."],
  },
  {
    route: "/login and /signup",
    job: "Authenticate the user, create an account, and send new users into onboarding instead of the dashboard.",
    renderBoundary: "client-live",
    collections: ["organizations"],
    liveQueries: ["session lookup after auth succeeds"],
    mutations: ["sign in", "sign up"],
    states: ["idle", "submitting", "auth error", "success redirect"],
    notes: ["Auth forms remain client components because Better Auth client methods run in the browser."],
  },
  {
    route: "/onboarding/*",
    job: "Complete the minimum setup needed for named coworkers to act in GitHub.",
    renderBoundary: "client-live",
    collections: ["organizations", "providerAccounts", "githubInstallations", "repositories", "coworkers", "coworkerRules"],
    liveQueries: ["setup checklist by organization", "available coworkers", "starter rules by selected coworker"],
    mutations: ["create organization", "connect provider", "connect GitHub", "install coworker", "create starter coworker rule"],
    states: ["not started", "in progress", "connected", "needs attention", "blocked by prior step"],
    notes: ["Starter rules still exist in onboarding, but the rule owner is always a coworker."],
  },
  {
    route: "/app",
    job: "Show whether the Coworker system is operational right now.",
    renderBoundary: "server-shell-client-data",
    collections: ["organizations", "providerAccounts", "githubInstallations", "coworkers", "coworkerRules", "runs"],
    liveQueries: ["active runs", "setup health", "coworker readiness", "blocked run count", "rule coverage by coworker"],
    mutations: [],
    states: ["loading operational summary", "healthy", "needs setup", "blocked run", "empty organization"],
    notes: ["Dashboard can mention rule coverage, but links should go to coworker profiles."],
  },
  {
    route: "/app/coworkers",
    job: "List named coworkers and show whether each is ready to act.",
    renderBoundary: "server-shell-client-data",
    collections: ["coworkers", "githubInstallations", "repositories", "coworkerRules", "runs"],
    liveQueries: ["coworker roster", "active rules per coworker", "installed repositories per coworker", "latest run per coworker"],
    mutations: ["install coworker", "disable coworker"],
    states: ["loading roster", "empty roster", "installed", "ready to install", "needs provider or GitHub"],
    notes: ["This is the primary configuration index. Rules are summarized here, not in a separate nav item."],
  },
  {
    route: "/app/coworkers/[coworkerId]",
    job: "Configure and inspect one named coworker.",
    renderBoundary: "server-shell-client-data",
    collections: ["coworkers", "githubInstallations", "repositories", "coworkerRules", "runs"],
    liveQueries: ["coworker identity", "rules for coworker", "repositories in scope", "recent runs for coworker"],
    mutations: ["create coworker rule", "update coworker rule", "enable coworker rule", "disable coworker rule", "assign repository", "trigger manual run"],
    states: ["loading coworker", "not found", "no rules", "rule saving", "rule save failed", "provider missing"],
    notes: ["This replaces /app/rules as the rule management surface."],
  },
  {
    route: "/app/runs",
    job: "Show live and historical executions grouped by status and urgency.",
    renderBoundary: "server-shell-client-data",
    collections: ["runs", "coworkers", "repositories", "coworkerRules"],
    liveQueries: ["runs by status", "runs by coworker", "blocked runs", "recent completed runs"],
    mutations: ["cancel run", "retry run"],
    states: ["loading runs", "no runs", "running", "needs review", "blocked", "completed"],
    notes: ["Runs are operational evidence, not generic jobs."],
  },
  {
    route: "/app/runs/[runId]",
    job: "The live workspace for one coworker execution: chat transcript, curated stage dividers, and a run-context panel.",
    renderBoundary: "server-shell-client-data",
    collections: ["runs", "coworkers", "repositories", "coworkerRules", "runEvents", "runMessages"],
    liveQueries: ["run facts", "ordered run events", "transcript messages", "triggering coworker rule"],
    mutations: ["cancel run", "retry run", "send follow-up message", "mark reviewed"],
    states: ["loading run", "not found", "live streaming", "waiting for GitHub", "blocked", "completed"],
    notes: ["The transcript workspace is the run page; the steer-mid-run composer is placeholder until the runtime inbox exists."],
  },
  {
    route: "/app/settings",
    job: "Manage organization-wide provider, GitHub, billing, and account settings.",
    renderBoundary: "server-shell-client-data",
    collections: ["organizations", "providerAccounts", "githubInstallations"],
    liveQueries: ["organization settings", "provider status", "GitHub installation status"],
    mutations: ["rename organization", "connect provider", "rotate provider credential", "connect GitHub", "disconnect GitHub"],
    states: ["loading settings", "connected", "needs attention", "saving", "save failed"],
    notes: ["Settings are organization-level. Coworker rules do not live here unless they become global policy later."],
  },
];
