import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { organization, user } from "@hosted-agents/db/schema/auth";
import { githubInstallation, githubRepository } from "@hosted-agents/db/schema/github";
import { agentProviderCredential } from "@hosted-agents/db/schema/provider-credentials";

export const CODE_REVIEW_WORKER_ROLE = "code_review";
export const CODE_REVIEW_WORKER_DISPLAY_NAME = "Code Review Worker";
export const GITHUB_PULL_REQUEST_REVIEW_RUN_TYPE = "github.pull_request_review";
export const LEGACY_CODE_REVIEW_COWORKER_SLUG = "code-review";

// The implementation ("Coder") worker role. Identity follows ADR-0001: one
// GitHub App per worker role, so the Coder authors its own branches, comments,
// and pull requests. Per CONTEXT.md the module/event vocabulary is
// `implementation`; "The Coder" is only a user-facing display name and must not
// appear in identifiers. This constant is the shared vocabulary that per-role
// GitHub App credential lookup and the implementation run adapter key on.
export const IMPLEMENTATION_WORKER_ROLE = "implementation";
export const IMPLEMENTATION_WORKER_DISPLAY_NAME = "The Coder";
// One implementation run turns a single ready-for-agent issue into a branch and
// pull request; the run type sits beside `github.pull_request_review` so the
// same worker runtime spine drives both roles (one pipeline, not two).
export const GITHUB_ISSUE_IMPLEMENTATION_RUN_TYPE = "github.issue_implementation";
export const LEGACY_IMPLEMENTATION_COWORKER_SLUG = "implementation";

export const agentRun = sqliteTable(
  "agent_run",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    providerCredentialId: text("provider_credential_id").references(
      () => agentProviderCredential.id,
      {
        onDelete: "set null",
      },
    ),
    coworkerSlug: text("coworker_slug").notNull(),
    workerRole: text("worker_role").default(CODE_REVIEW_WORKER_ROLE).notNull(),
    workerDisplayName: text("worker_display_name"),
    runType: text("run_type").notNull(),
    sourceProvider: text("source_provider").notNull(),
    sourceDeliveryId: text("source_delivery_id"),
    githubInstallationId: text("github_installation_id").references(() => githubInstallation.id, {
      onDelete: "set null",
    }),
    githubRepositoryId: text("github_repository_id").references(() => githubRepository.id, {
      onDelete: "set null",
    }),
    repositoryOwner: text("repository_owner"),
    repositoryName: text("repository_name"),
    repositoryUrl: text("repository_url"),
    branch: text("branch"),
    baseBranch: text("base_branch"),
    // The issue an implementation run implements. Kick-off (spec #21 stories 1–4)
    // links the ready-for-agent issue to the run it queues, so the implementation
    // worker knows which issue to turn into a branch and pull request. Null for
    // review runs, which are keyed by pull request instead.
    issueNumber: integer("issue_number"),
    pullRequestNumber: integer("pull_request_number"),
    pullRequestBaseRef: text("pull_request_base_ref"),
    pullRequestBaseSha: text("pull_request_base_sha"),
    pullRequestHeadRef: text("pull_request_head_ref"),
    pullRequestHeadSha: text("pull_request_head_sha"),
    status: text("status").default("queued").notNull(),
    model: text("model"),
    flueRunId: text("flue_run_id"),
    sandboxProvider: text("sandbox_provider"),
    sandboxId: text("sandbox_id"),
    currentStage: text("current_stage"),
    lastHeartbeatAt: integer("last_heartbeat_at", { mode: "timestamp_ms" }),
    summary: text("summary"),
    findingsJson: text("findings_json"),
    errorMessage: text("error_message"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("agent_run_organizationId_idx").on(table.organizationId),
    index("agent_run_userId_idx").on(table.userId),
    index("agent_run_providerCredentialId_idx").on(table.providerCredentialId),
    index("agent_run_coworkerSlug_idx").on(table.coworkerSlug),
    index("agent_run_workerRole_idx").on(table.workerRole),
    index("agent_run_runType_idx").on(table.runType),
    index("agent_run_status_idx").on(table.status),
    index("agent_run_flueRunId_idx").on(table.flueRunId),
    index("agent_run_sandboxId_idx").on(table.sandboxId),
    index("agent_run_sourceDeliveryId_idx").on(table.sourceDeliveryId),
    index("agent_run_githubInstallationId_idx").on(table.githubInstallationId),
    index("agent_run_githubRepositoryId_idx").on(table.githubRepositoryId),
  ],
);

export const agentRunEvent = sqliteTable(
  "agent_run_event",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => agentRun.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull(),
    category: text("category").notNull(),
    type: text("type").notNull(),
    stage: text("stage"),
    message: text("message").notNull(),
    payloadJson: text("payload_json"),
    flueEventIndex: integer("flue_event_index"),
    flueEventType: text("flue_event_type"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("agent_run_event_runId_idx").on(table.runId),
    uniqueIndex("agent_run_event_runSequence_idx").on(table.runId, table.sequence),
    index("agent_run_event_type_idx").on(table.type),
    index("agent_run_event_category_idx").on(table.category),
    index("agent_run_event_flueEventIndex_idx").on(table.flueEventIndex),
  ],
);

export const agentRunSandbox = sqliteTable(
  "agent_run_sandbox",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => agentRun.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    sandboxId: text("sandbox_id").notNull(),
    status: text("status").notNull(),
    labelsJson: text("labels_json"),
    errorMessage: text("error_message"),
    startedAt: integer("started_at", { mode: "timestamp_ms" }),
    completedAt: integer("completed_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("agent_run_sandbox_runId_idx").on(table.runId),
    index("agent_run_sandbox_sandboxId_idx").on(table.sandboxId),
    index("agent_run_sandbox_status_idx").on(table.status),
  ],
);

export const agentRunArtifact = sqliteTable(
  "agent_run_artifact",
  {
    id: text("id").primaryKey(),
    runId: text("run_id")
      .notNull()
      .references(() => agentRun.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    contentType: text("content_type").notNull(),
    content: text("content"),
    payloadJson: text("payload_json"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
  },
  (table) => [
    index("agent_run_artifact_runId_idx").on(table.runId),
    index("agent_run_artifact_name_idx").on(table.name),
  ],
);

export const agentRunRelations = relations(agentRun, ({ many, one }) => ({
  organization: one(organization, {
    fields: [agentRun.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [agentRun.userId],
    references: [user.id],
  }),
  providerCredential: one(agentProviderCredential, {
    fields: [agentRun.providerCredentialId],
    references: [agentProviderCredential.id],
  }),
  githubInstallation: one(githubInstallation, {
    fields: [agentRun.githubInstallationId],
    references: [githubInstallation.id],
  }),
  githubRepository: one(githubRepository, {
    fields: [agentRun.githubRepositoryId],
    references: [githubRepository.id],
  }),
  events: many(agentRunEvent),
  sandboxes: many(agentRunSandbox),
  artifacts: many(agentRunArtifact),
}));

export const agentRunEventRelations = relations(agentRunEvent, ({ one }) => ({
  run: one(agentRun, {
    fields: [agentRunEvent.runId],
    references: [agentRun.id],
  }),
}));

export const agentRunSandboxRelations = relations(agentRunSandbox, ({ one }) => ({
  run: one(agentRun, {
    fields: [agentRunSandbox.runId],
    references: [agentRun.id],
  }),
}));

export const agentRunArtifactRelations = relations(agentRunArtifact, ({ one }) => ({
  run: one(agentRun, {
    fields: [agentRunArtifact.runId],
    references: [agentRun.id],
  }),
}));
