import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { organization, user } from "./auth";
import { agentProviderCredential } from "./provider-credentials";

export const reviewRun = sqliteTable(
  "review_run",
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
    agentName: text("agent_name").default("code-review").notNull(),
    repositoryProvider: text("repository_provider").default("manual").notNull(),
    repositoryOwner: text("repository_owner"),
    repositoryName: text("repository_name"),
    repositoryUrl: text("repository_url"),
    branch: text("branch").notNull(),
    baseBranch: text("base_branch"),
    reviewContext: text("review_context"),
    status: text("status").default("queued").notNull(),
    flueRunId: text("flue_run_id"),
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
    index("review_run_organizationId_idx").on(table.organizationId),
    index("review_run_userId_idx").on(table.userId),
    index("review_run_providerCredentialId_idx").on(table.providerCredentialId),
    index("review_run_flueRunId_idx").on(table.flueRunId),
    index("review_run_status_idx").on(table.status),
  ],
);

export const reviewRunRelations = relations(reviewRun, ({ one }) => ({
  organization: one(organization, {
    fields: [reviewRun.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [reviewRun.userId],
    references: [user.id],
  }),
  providerCredential: one(agentProviderCredential, {
    fields: [reviewRun.providerCredentialId],
    references: [agentProviderCredential.id],
  }),
}));
