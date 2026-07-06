import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { organization, user } from "@hosted-agents/db/schema/auth";

export const githubInstallation = sqliteTable(
  "github_installation",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    installationId: text("installation_id").notNull(),
    appSlug: text("app_slug").notNull(),
    accountId: text("account_id"),
    accountLogin: text("account_login"),
    accountType: text("account_type"),
    repositorySelection: text("repository_selection"),
    status: text("status").default("connected").notNull(),
    setupAction: text("setup_action"),
    installedByUserId: text("installed_by_user_id").references(() => user.id, {
      onDelete: "set null",
    }),
    suspendedAt: integer("suspended_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("github_installation_installationId_idx").on(table.installationId),
    index("github_installation_organizationId_idx").on(table.organizationId),
    index("github_installation_accountLogin_idx").on(table.accountLogin),
  ],
);

export const githubRepository = sqliteTable(
  "github_repository",
  {
    id: text("id").primaryKey(),
    installationId: text("installation_id")
      .notNull()
      .references(() => githubInstallation.id, { onDelete: "cascade" }),
    githubRepositoryId: text("github_repository_id").notNull(),
    owner: text("owner").notNull(),
    name: text("name").notNull(),
    fullName: text("full_name").notNull(),
    htmlUrl: text("html_url"),
    defaultBranch: text("default_branch"),
    private: integer("private", { mode: "boolean" }).default(false).notNull(),
    selected: integer("selected", { mode: "boolean" }).default(true).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("github_repository_installation_repo_idx").on(
      table.installationId,
      table.githubRepositoryId,
    ),
    index("github_repository_installationId_idx").on(table.installationId),
    index("github_repository_fullName_idx").on(table.fullName),
  ],
);

export const githubWebhookDelivery = sqliteTable(
  "github_webhook_delivery",
  {
    id: text("id").primaryKey(),
    event: text("event").notNull(),
    action: text("action"),
    installationId: text("installation_id"),
    repositoryFullName: text("repository_full_name"),
    pullRequestNumber: integer("pull_request_number"),
    status: text("status").default("claimed").notNull(),
    reviewRunId: text("review_run_id"),
    receivedAt: integer("received_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("github_webhook_delivery_event_idx").on(table.event),
    index("github_webhook_delivery_installationId_idx").on(table.installationId),
    index("github_webhook_delivery_status_idx").on(table.status),
    index("github_webhook_delivery_reviewRunId_idx").on(table.reviewRunId),
  ],
);

export const githubInstallationRelations = relations(githubInstallation, ({ many, one }) => ({
  organization: one(organization, {
    fields: [githubInstallation.organizationId],
    references: [organization.id],
  }),
  installedByUser: one(user, {
    fields: [githubInstallation.installedByUserId],
    references: [user.id],
  }),
  repositories: many(githubRepository),
}));

export const githubRepositoryRelations = relations(githubRepository, ({ one }) => ({
  installation: one(githubInstallation, {
    fields: [githubRepository.installationId],
    references: [githubInstallation.id],
  }),
}));
