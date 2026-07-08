import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

import { organization } from "@hosted-agents/db/schema/auth";

// Organization-level overlay on a worker role's built-in behavior. The role
// adapter owns the non-negotiable protocol (tool-calling contract, output
// schema); this table owns what a team admin may tune per organization.
export const workerConfig = sqliteTable(
  "worker_config",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    workerRole: text("worker_role").notNull(),
    displayName: text("display_name"),
    model: text("model"),
    instructions: text("instructions"),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("worker_config_org_role_idx").on(table.organizationId, table.workerRole),
    index("worker_config_organizationId_idx").on(table.organizationId),
  ],
);

// Named instruction files uploaded into the worker sandbox before a run
// starts. The worker is told to read enabled skills alongside its base
// instructions, so skill content shapes behavior without code changes.
export const workerSkill = sqliteTable(
  "worker_skill",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organization.id, { onDelete: "cascade" }),
    workerRole: text("worker_role").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    content: text("content").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).default(true).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
      .$onUpdate(() => /* @__PURE__ */ new Date())
      .notNull(),
  },
  (table) => [
    uniqueIndex("worker_skill_org_role_name_idx").on(
      table.organizationId,
      table.workerRole,
      table.name,
    ),
    index("worker_skill_organizationId_idx").on(table.organizationId),
  ],
);
