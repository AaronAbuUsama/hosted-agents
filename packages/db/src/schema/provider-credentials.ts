import { relations, sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

import { organization, user } from "./auth";

export const agentProviderCredential = sqliteTable(
  "agent_provider_credential",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    credentialType: text("credential_type").notNull(),
    encryptedCredential: text("encrypted_credential").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }),
    status: text("status").default("connected").notNull(),
    lastError: text("last_error"),
    lastUsedAt: integer("last_used_at", { mode: "timestamp_ms" }),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    index("agent_provider_credential_organizationId_idx").on(table.organizationId),
    index("agent_provider_credential_userId_idx").on(table.userId),
    index("agent_provider_credential_provider_idx").on(table.provider),
    index("agent_provider_credential_status_idx").on(table.status),
  ],
);

export const agentProviderCredentialRelations = relations(agentProviderCredential, ({ one }) => ({
  organization: one(organization, {
    fields: [agentProviderCredential.organizationId],
    references: [organization.id],
  }),
  user: one(user, {
    fields: [agentProviderCredential.userId],
    references: [user.id],
  }),
}));
