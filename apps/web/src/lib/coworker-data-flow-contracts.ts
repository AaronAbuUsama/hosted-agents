import type { CollectionName, RenderBoundary } from "./coworker-ia-contracts";

export type CollectionSyncDriver =
  | "tanstack-query-collection"
  | "better-auth-session"
  | "github-webhook-ingest"
  | "manual-configuration";

export type MutationMode = "optimistic" | "pessimistic" | "server-confirmed";

export type DataIslandState =
  | "loading"
  | "empty"
  | "error"
  | "stale"
  | "optimistic"
  | "saving"
  | "blocked"
  | "not-found";

export type CollectionQueryKey = readonly [CollectionName, ...string[]];

export type CollectionFlowContract = {
  collection: CollectionName;
  queryKey: CollectionQueryKey;
  syncDriver: CollectionSyncDriver;
  plannedSource: string;
  ownerKey: string;
  stalePolicy: string;
  optimisticWrites: readonly string[];
  invalidates: readonly CollectionName[];
  firstConsumerRoutes: readonly string[];
  implementationNotes: readonly string[];
};

export type MutationFlowContract = {
  id: string;
  label: string;
  collection: CollectionName;
  mode: MutationMode;
  callerRoutes: readonly string[];
  optimisticEffect: string;
  serverCommit: string;
  rollback: string;
  invalidates: readonly CollectionName[];
};

export type PhaseFourStep = {
  step: string;
  goal: string;
  deliverables: readonly string[];
  blocksVisualDesignUntil: string;
};

export const collectionDataFlowContracts = [
  {
    collection: "organizations",
    queryKey: ["organizations", "by-session"],
    syncDriver: "tanstack-query-collection",
    plannedSource: "planned ORPC organizations.list for the signed-in user",
    ownerKey: "userId",
    stalePolicy: "Refresh on app-shell mount and after organization create/select mutations.",
    optimisticWrites: ["createOrganization", "selectOrganization"],
    invalidates: ["providerAccounts", "githubInstallations", "repositories", "coworkers", "coworkerRules", "runs"],
    firstConsumerRoutes: ["/onboarding/organization", "/app", "/app/settings"],
    implementationNotes: [
      "The client record must not become the auth source of truth; Better Auth session remains authoritative.",
      "SSR can read session identity, but organization collection hydration belongs to a client data island.",
    ],
  },
  {
    collection: "providerAccounts",
    queryKey: ["providerAccounts", "by-organization", "{organizationId}"],
    syncDriver: "tanstack-query-collection",
    plannedSource: "planned ORPC providerAccounts.list scoped to the active organization",
    ownerKey: "organizationId",
    stalePolicy: "Refresh on settings/onboarding mount and after credential connect/rotate/disconnect.",
    optimisticWrites: ["connectProviderAccount", "disconnectProviderAccount"],
    invalidates: ["runs"],
    firstConsumerRoutes: ["/onboarding/provider", "/app", "/app/settings"],
    implementationNotes: [
      "Expose connection health, provider kind, and last verified time; never expose raw credentials to the browser.",
      "Implementation runs should render blocked state when this collection has no connected provider account.",
    ],
  },
  {
    collection: "githubInstallations",
    queryKey: ["githubInstallations", "by-organization", "{organizationId}"],
    syncDriver: "tanstack-query-collection",
    plannedSource: "planned ORPC githubInstallations.list plus GitHub App webhook refresh",
    ownerKey: "organizationId",
    stalePolicy: "Refresh on GitHub setup/settings mount, app installation callback, and installation webhook.",
    optimisticWrites: ["startGithubInstallation", "disconnectGithubInstallation"],
    invalidates: ["repositories", "coworkers", "coworkerRules", "runs"],
    firstConsumerRoutes: ["/onboarding/github", "/onboarding/coworkers", "/app/settings"],
    implementationNotes: [
      "Treat each named coworker GitHub App as a distinct installation identity where the backend supports it.",
      "Client records should show installation state and permissions, not GitHub tokens.",
    ],
  },
  {
    collection: "repositories",
    queryKey: ["repositories", "by-organization", "{organizationId}"],
    syncDriver: "tanstack-query-collection",
    plannedSource: "planned ORPC repositories.list derived from GitHub installations",
    ownerKey: "organizationId",
    stalePolicy: "Refresh after GitHub installation changes and repository selection mutations.",
    optimisticWrites: ["assignCoworkerRepositories"],
    invalidates: ["coworkers", "coworkerRules", "runs"],
    firstConsumerRoutes: ["/onboarding/github", "/app/coworkers/[coworkerId]", "/app/settings"],
    implementationNotes: [
      "Repository records power rule scope pickers and run context labels.",
      "Keep repository selection separate from coworker rule activation so scope changes can be reviewed.",
    ],
  },
  {
    collection: "coworkers",
    queryKey: ["coworkers", "by-organization", "{organizationId}"],
    syncDriver: "tanstack-query-collection",
    plannedSource: "planned ORPC coworkers.list combining coworker catalog and organization installs",
    ownerKey: "organizationId",
    stalePolicy: "Refresh after coworker install/uninstall, GitHub installation, and repository assignment changes.",
    optimisticWrites: ["installCoworker", "updateCoworkerAssignment"],
    invalidates: ["coworkerRules", "runs"],
    firstConsumerRoutes: ["/onboarding/coworkers", "/app", "/app/coworkers", "/app/coworkers/[coworkerId]"],
    implementationNotes: [
      "Coworker identity fields are product identity, not user-editable display-name fluff.",
      "Each installed coworker should expose setup health from provider, GitHub, repository, and rule dependencies.",
    ],
  },
  {
    collection: "coworkerRules",
    queryKey: ["coworkerRules", "by-organization", "{organizationId}"],
    syncDriver: "tanstack-query-collection",
    plannedSource: "planned ORPC coworkerRules.list scoped to active organization and coworker filters",
    ownerKey: "organizationId",
    stalePolicy: "Refresh after rule create/update/toggle/delete and repository assignment changes.",
    optimisticWrites: ["createCoworkerRule", "updateCoworkerRule", "toggleCoworkerRule"],
    invalidates: ["runs"],
    firstConsumerRoutes: ["/onboarding/rules", "/app", "/app/coworkers/[coworkerId]"],
    implementationNotes: [
      "Rules are edited on coworker surfaces; there is no top-level rules app section.",
      "Rules must include trigger, scope, action, guardrail, enabled state, and owning coworker.",
    ],
  },
  {
    collection: "runs",
    queryKey: ["runs", "by-organization", "{organizationId}"],
    syncDriver: "tanstack-query-collection",
    plannedSource: "planned ORPC runs.list plus run lifecycle events from the backend",
    ownerKey: "organizationId",
    stalePolicy: "Poll or subscribe while live runs exist; refresh after trigger/cancel/retry mutations.",
    optimisticWrites: ["triggerRun", "cancelRun", "retryRun"],
    invalidates: ["runEvents", "runMessages"],
    firstConsumerRoutes: ["/app", "/app/runs", "/app/runs/[runId]", "/app/coworkers/[coworkerId]"],
    implementationNotes: [
      "Runs are the operational spine of the app and should be grouped by status, not hidden in dashboard cards.",
      "Run list records should stay compact; detailed transcript and timeline live in child collections.",
    ],
  },
  {
    collection: "runEvents",
    queryKey: ["runEvents", "by-run", "{runId}"],
    syncDriver: "tanstack-query-collection",
    plannedSource: "planned ORPC runEvents.list plus future run event stream",
    ownerKey: "runId",
    stalePolicy: "Subscribe or poll only while the run detail route is mounted or a live run summary is visible.",
    optimisticWrites: ["appendLocalRunEvent"],
    invalidates: ["runs"],
    firstConsumerRoutes: ["/app/runs/[runId]"],
    implementationNotes: [
      "Timeline events should be append-only from the client perspective.",
      "The run detail UI should distinguish backend events, GitHub events, and coworker actions.",
    ],
  },
  {
    collection: "runMessages",
    queryKey: ["runMessages", "by-run", "{runId}"],
    syncDriver: "tanstack-query-collection",
    plannedSource: "planned ORPC runMessages.list plus future run transcript stream",
    ownerKey: "runId",
    stalePolicy: "Subscribe or poll only on run detail and any future compact live transcript preview.",
    optimisticWrites: ["sendRunMessage"],
    invalidates: ["runs", "runEvents"],
    firstConsumerRoutes: ["/app/runs/[runId]"],
    implementationNotes: [
      "Transcript records need actor identity so Abu Bakr/Umar never collapse into a generic assistant.",
      "Human commands should be optimistic; coworker replies should be server-confirmed stream entries.",
    ],
  },
] as const satisfies readonly CollectionFlowContract[];

export const mutationContracts = [
  {
    id: "createOrganization",
    label: "Create Coworker organization",
    collection: "organizations",
    mode: "optimistic",
    callerRoutes: ["/onboarding/organization"],
    optimisticEffect: "Insert a pending organization row and select it as active for onboarding continuation.",
    serverCommit: "planned ORPC organizations.create",
    rollback: "Remove the pending organization and keep the user on organization setup with the server error.",
    invalidates: ["organizations"],
  },
  {
    id: "connectProviderAccount",
    label: "Connect provider account",
    collection: "providerAccounts",
    mode: "pessimistic",
    callerRoutes: ["/onboarding/provider", "/app/settings"],
    optimisticEffect: "Show connection-in-progress state, but do not mark credentials connected before server verification.",
    serverCommit: "planned ORPC providerAccounts.connect or external provider callback",
    rollback: "Return to needs-attention state and preserve non-secret form choices.",
    invalidates: ["providerAccounts", "runs"],
  },
  {
    id: "installGithubApp",
    label: "Install coworker GitHub App",
    collection: "githubInstallations",
    mode: "pessimistic",
    callerRoutes: ["/onboarding/github", "/onboarding/coworkers", "/app/settings"],
    optimisticEffect: "Show outbound install state while GitHub owns the browser flow.",
    serverCommit: "planned GitHub App installation callback and githubInstallations.refresh",
    rollback: "Keep coworker install blocked and show missing GitHub installation reason.",
    invalidates: ["githubInstallations", "repositories", "coworkers"],
  },
  {
    id: "installCoworker",
    label: "Hire/install coworker",
    collection: "coworkers",
    mode: "optimistic",
    callerRoutes: ["/onboarding/coworkers"],
    optimisticEffect: "Mark the selected named coworker as pending install while dependencies are checked.",
    serverCommit: "planned ORPC coworkers.install",
    rollback: "Restore previous coworker install state and show the blocking dependency.",
    invalidates: ["coworkers", "coworkerRules"],
  },
  {
    id: "assignCoworkerRepositories",
    label: "Assign coworker repository scope",
    collection: "repositories",
    mode: "optimistic",
    callerRoutes: ["/app/coworkers/[coworkerId]"],
    optimisticEffect: "Update selected repository scope immediately on the coworker profile.",
    serverCommit: "planned ORPC coworkers.assignRepositories",
    rollback: "Restore prior repository scope and keep affected rules in stale state until refreshed.",
    invalidates: ["repositories", "coworkers", "coworkerRules"],
  },
  {
    id: "createCoworkerRule",
    label: "Create coworker rule",
    collection: "coworkerRules",
    mode: "optimistic",
    callerRoutes: ["/onboarding/rules", "/app/coworkers/[coworkerId]"],
    optimisticEffect: "Insert a draft rule under the owning coworker with saving state.",
    serverCommit: "planned ORPC coworkerRules.create",
    rollback: "Remove the pending rule and restore the rule composer input.",
    invalidates: ["coworkerRules", "runs"],
  },
  {
    id: "updateCoworkerRule",
    label: "Update coworker rule",
    collection: "coworkerRules",
    mode: "optimistic",
    callerRoutes: ["/app/coworkers/[coworkerId]"],
    optimisticEffect: "Patch trigger, scope, action, guardrail, or enabled state in place.",
    serverCommit: "planned ORPC coworkerRules.update",
    rollback: "Restore original rule fields from the TanStack DB mutation transaction.",
    invalidates: ["coworkerRules", "runs"],
  },
  {
    id: "triggerRun",
    label: "Trigger coworker run",
    collection: "runs",
    mode: "optimistic",
    callerRoutes: ["/app", "/app/runs", "/app/coworkers/[coworkerId]"],
    optimisticEffect: "Insert a queued run row so the operations surface updates immediately.",
    serverCommit: "planned ORPC runs.trigger",
    rollback: "Remove queued run and show the blocking provider/GitHub/rule error.",
    invalidates: ["runs", "runEvents", "runMessages"],
  },
  {
    id: "cancelRun",
    label: "Cancel run",
    collection: "runs",
    mode: "optimistic",
    callerRoutes: ["/app/runs/[runId]"],
    optimisticEffect: "Move the run to canceling/canceled state and disable duplicate cancel actions.",
    serverCommit: "planned ORPC runs.cancel",
    rollback: "Restore the previous run status if the backend cannot cancel the run.",
    invalidates: ["runs", "runEvents"],
  },
  {
    id: "sendRunMessage",
    label: "Send run command or reply",
    collection: "runMessages",
    mode: "optimistic",
    callerRoutes: ["/app/runs/[runId]"],
    optimisticEffect: "Append the human message immediately with pending delivery state.",
    serverCommit: "planned ORPC runMessages.send",
    rollback: "Mark the message failed and keep retry affordance visible.",
    invalidates: ["runMessages", "runEvents", "runs"],
  },
] as const satisfies readonly MutationFlowContract[];

export type MutationId = (typeof mutationContracts)[number]["id"];
export type AuthMutationId = "email sign in" | "email sign up";
export type RouteMutationId = MutationId | AuthMutationId;

export type RouteDataIslandContract = {
  route: string;
  renderBoundary: RenderBoundary;
  serverResponsibilities: readonly string[];
  clientCollections: readonly CollectionName[];
  liveQueries: readonly string[];
  mutations: readonly RouteMutationId[];
  states: readonly DataIslandState[];
  notes: readonly string[];
};

export const screenDataIslandContracts = [
  {
    route: "/",
    renderBoundary: "server-static",
    serverResponsibilities: ["Render static product story", "Link to auth and product preview routes"],
    clientCollections: [],
    liveQueries: [],
    mutations: [],
    states: ["loading", "error"],
    notes: ["Marketing should not import TanStack DB collections."],
  },
  {
    route: "/login and /signup",
    renderBoundary: "client-live",
    serverResponsibilities: ["Render auth layout shell"],
    clientCollections: [],
    liveQueries: ["Better Auth session state only"],
    mutations: ["email sign in", "email sign up"],
    states: ["loading", "saving", "error"],
    notes: ["Auth remains Better Auth, not TanStack DB."],
  },
  {
    route: "/onboarding/*",
    renderBoundary: "client-live",
    serverResponsibilities: ["Render onboarding route shell and static explanatory copy"],
    clientCollections: ["organizations", "providerAccounts", "githubInstallations", "repositories", "coworkers", "coworkerRules"],
    liveQueries: ["active organization setup checklist", "selected coworkers with dependency health", "starter rules by coworker"],
    mutations: ["createOrganization", "connectProviderAccount", "installGithubApp", "installCoworker", "createCoworkerRule"],
    states: ["loading", "empty", "error", "stale", "optimistic", "saving", "blocked"],
    notes: ["Onboarding should show dependency blockers directly instead of dumping users into an incomplete dashboard."],
  },
  {
    route: "/app",
    renderBoundary: "server-shell-client-data",
    serverResponsibilities: ["Render app frame shell", "Protect route by session before mounting live app data"],
    clientCollections: ["organizations", "providerAccounts", "githubInstallations", "coworkers", "coworkerRules", "runs"],
    liveQueries: ["setup health summary", "active runs", "coworker install status", "rule coverage by coworker"],
    mutations: ["triggerRun"],
    states: ["loading", "empty", "error", "stale", "optimistic", "blocked"],
    notes: ["Dashboard is a summary of live collections, not a separate dashboard model."],
  },
  {
    route: "/app/coworkers",
    renderBoundary: "server-shell-client-data",
    serverResponsibilities: ["Render app frame shell and route metadata"],
    clientCollections: ["coworkers", "coworkerRules", "runs", "repositories", "githubInstallations"],
    liveQueries: ["coworker roster with install health", "recent runs grouped by coworker", "rule counts by coworker"],
    mutations: ["installCoworker"],
    states: ["loading", "empty", "error", "stale", "optimistic", "blocked"],
    notes: ["The roster should make Abu Bakr and Umar feel like people with identities, not bot rows."],
  },
  {
    route: "/app/coworkers/[coworkerId]",
    renderBoundary: "server-shell-client-data",
    serverResponsibilities: ["Resolve route params", "Render 404 if coworker id is impossible once server read model exists"],
    clientCollections: ["coworkers", "coworkerRules", "repositories", "githubInstallations", "runs"],
    liveQueries: ["selected coworker", "rules for coworker", "repository scope", "recent runs for coworker"],
    mutations: ["assignCoworkerRepositories", "createCoworkerRule", "updateCoworkerRule", "triggerRun"],
    states: ["loading", "empty", "error", "stale", "optimistic", "saving", "blocked", "not-found"],
    notes: ["This is the main rules surface; do not recreate a top-level rules app."],
  },
  {
    route: "/app/runs",
    renderBoundary: "server-shell-client-data",
    serverResponsibilities: ["Render app frame shell and route metadata"],
    clientCollections: ["runs", "coworkers", "repositories"],
    liveQueries: ["runs grouped by status", "coworker labels for runs", "repository labels for runs"],
    mutations: ["triggerRun", "cancelRun"],
    states: ["loading", "empty", "error", "stale", "optimistic", "blocked"],
    notes: ["Runs should render as dense operational rows, not as disconnected cards."],
  },
  {
    route: "/app/runs/[runId]",
    renderBoundary: "server-shell-client-data",
    serverResponsibilities: ["Resolve route params", "Render shell and metadata", "Avoid serializing full transcript from server unless explicitly prefetched"],
    clientCollections: ["runs", "runEvents", "runMessages", "coworkers", "repositories"],
    liveQueries: ["selected run", "run timeline events", "run transcript messages", "coworker identity for run"],
    mutations: ["cancelRun", "sendRunMessage"],
    states: ["loading", "empty", "error", "stale", "optimistic", "saving", "blocked", "not-found"],
    notes: ["This should become the live cockpit screen before the final visual pass."],
  },
  {
    route: "/app/settings",
    renderBoundary: "server-shell-client-data",
    serverResponsibilities: ["Render app frame shell and settings metadata"],
    clientCollections: ["organizations", "providerAccounts", "githubInstallations", "repositories"],
    liveQueries: ["organization settings", "provider health", "GitHub installation health", "repository sync summary"],
    mutations: ["connectProviderAccount", "installGithubApp"],
    states: ["loading", "empty", "error", "stale", "saving", "blocked"],
    notes: ["Settings owns account-level configuration; coworker rules stay on coworker detail."],
  },
] as const satisfies readonly RouteDataIslandContract[];

export const phaseFourImplementationOrder = [
  {
    step: "server-read-model-contracts",
    goal: "Name the ORPC procedures and response records before wiring client collections.",
    deliverables: [
      "organizations.list/create/select",
      "providerAccounts.list/connect/disconnect",
      "githubInstallations.list/start/refresh/disconnect",
      "coworkers.list/install/assignRepositories",
      "coworkerRules.list/create/update/delete",
      "runs.list/trigger/cancel/retry",
      "runEvents.list",
      "runMessages.list/send",
    ],
    blocksVisualDesignUntil: "The UI knows which states can load, fail, go stale, and update optimistically.",
  },
  {
    step: "client-collection-modules",
    goal: "Create TanStack DB collection modules only after real query functions or explicit fixture-preview endpoints exist.",
    deliverables: [
      "one collection module per canonical collection or cohesive group",
      "queryCollectionOptions with stable query keys and getKey",
      "mutation handlers matching this file's mutation contracts",
      "no fake success no-op adapters",
    ],
    blocksVisualDesignUntil: "The visual pass can render from live query read models instead of static imports.",
  },
  {
    step: "route-data-islands",
    goal: "Split server shells from client-live data islands for app routes.",
    deliverables: [
      "server route files that own metadata and params",
      "client data components that call useLiveQuery",
      "loading, empty, error, stale, blocked, optimistic, and not-found states per route",
    ],
    blocksVisualDesignUntil: "Each screen has the actual state inventory the redesign must account for.",
  },
  {
    step: "visual-readiness-review",
    goal: "Confirm the UI state matrix is complete before replacing the current low-fidelity screens.",
    deliverables: [
      "dashboard state matrix",
      "coworker profile rule/editor state matrix",
      "run cockpit transcript/timeline state matrix",
      "settings/provider/GitHub setup state matrix",
    ],
    blocksVisualDesignUntil: "No major product surface lacks a data contract or state contract.",
  },
] as const satisfies readonly PhaseFourStep[];
