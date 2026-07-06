import { createClient, type Client } from "@libsql/client";
import dotenv from "dotenv";
import { drizzle } from "drizzle-orm/libsql";
import { migrate as runDrizzleMigrations } from "drizzle-orm/libsql/migrator";
import { readMigrationFiles, type MigrationMeta } from "drizzle-orm/migrator";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const migrationsTable = "__drizzle_migrations";
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = resolve(packageRoot, "../..");
const migrationsFolder = resolve(packageRoot, "src/migrations");

const tableAdoptionColumns = {
  user: [
    { name: "username", definition: "`username` text" },
    { name: "display_username", definition: "`display_username` text" },
    { name: "image", definition: "`image` text" },
  ],
  organization: [
    { name: "logo", definition: "`logo` text" },
    { name: "metadata", definition: "`metadata` text" },
  ],
} as const;

const reviewRunAdoptionColumns = [
  { name: "agent_name", definition: "`agent_name` text DEFAULT 'code-review' NOT NULL" },
  {
    name: "provider_credential_id",
    definition:
      "`provider_credential_id` text REFERENCES `agent_provider_credential`(`id`) ON UPDATE no action ON DELETE set null",
  },
  {
    name: "repository_provider",
    definition: "`repository_provider` text DEFAULT 'manual' NOT NULL",
  },
  { name: "repository_owner", definition: "`repository_owner` text" },
  { name: "repository_name", definition: "`repository_name` text" },
  { name: "repository_url", definition: "`repository_url` text" },
  { name: "base_branch", definition: "`base_branch` text" },
  { name: "review_context", definition: "`review_context` text" },
  {
    name: "github_delivery_id",
    definition:
      "`github_delivery_id` text REFERENCES `github_webhook_delivery`(`id`) ON UPDATE no action ON DELETE set null",
  },
  {
    name: "github_installation_id",
    definition:
      "`github_installation_id` text REFERENCES `github_installation`(`id`) ON UPDATE no action ON DELETE set null",
  },
  {
    name: "github_repository_id",
    definition:
      "`github_repository_id` text REFERENCES `github_repository`(`id`) ON UPDATE no action ON DELETE set null",
  },
  { name: "pull_request_number", definition: "`pull_request_number` integer" },
  { name: "pull_request_base_ref", definition: "`pull_request_base_ref` text" },
  { name: "pull_request_base_sha", definition: "`pull_request_base_sha` text" },
  { name: "pull_request_head_ref", definition: "`pull_request_head_ref` text" },
  { name: "pull_request_head_sha", definition: "`pull_request_head_sha` text" },
  { name: "flue_run_id", definition: "`flue_run_id` text" },
  { name: "summary", definition: "`summary` text" },
  { name: "findings_json", definition: "`findings_json` text" },
  { name: "error_message", definition: "`error_message` text" },
  { name: "started_at", definition: "`started_at` integer" },
  { name: "completed_at", definition: "`completed_at` integer" },
] as const;

const reviewRunAdoptionIndexes = [
  "CREATE INDEX IF NOT EXISTS `review_run_organizationId_idx` ON `review_run` (`organization_id`)",
  "CREATE INDEX IF NOT EXISTS `review_run_userId_idx` ON `review_run` (`user_id`)",
  "CREATE INDEX IF NOT EXISTS `review_run_providerCredentialId_idx` ON `review_run` (`provider_credential_id`)",
  "CREATE INDEX IF NOT EXISTS `review_run_flueRunId_idx` ON `review_run` (`flue_run_id`)",
  "CREATE INDEX IF NOT EXISTS `review_run_status_idx` ON `review_run` (`status`)",
  "CREATE INDEX IF NOT EXISTS `review_run_githubDeliveryId_idx` ON `review_run` (`github_delivery_id`)",
  "CREATE INDEX IF NOT EXISTS `review_run_githubInstallationId_idx` ON `review_run` (`github_installation_id`)",
  "CREATE INDEX IF NOT EXISTS `review_run_githubRepositoryId_idx` ON `review_run` (`github_repository_id`)",
] as const;

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function quotedIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}

async function tableExists(client: Client, tableName: string): Promise<boolean> {
  const result = await client.execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name = ${sqlString(tableName)} LIMIT 1`,
  );

  return result.rows.length > 0;
}

async function hasApplicationTables(client: Client): Promise<boolean> {
  const result = await client.execute(
    `SELECT 1 FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' AND name != ${sqlString(
      migrationsTable,
    )} LIMIT 1`,
  );

  return result.rows.length > 0;
}

async function hasMigrationHistory(client: Client): Promise<boolean> {
  if (!(await tableExists(client, migrationsTable))) {
    return false;
  }

  const result = await client.execute(`SELECT 1 FROM ${quotedIdentifier(migrationsTable)} LIMIT 1`);

  return result.rows.length > 0;
}

async function columnNames(client: Client, tableName: string): Promise<Set<string>> {
  const result = await client.execute(`PRAGMA table_info(${quotedIdentifier(tableName)})`);

  return new Set(result.rows.map((row) => String(row.name)));
}

function idempotentBaselineStatement(statement: string): string | undefined {
  const trimmedStatement = statement.trim();

  if (!trimmedStatement) {
    return undefined;
  }

  if (/^CREATE\s+(UNIQUE\s+)?INDEX\s+/i.test(trimmedStatement)) {
    return undefined;
  }

  return trimmedStatement.replace(/^CREATE TABLE\s+`/i, "CREATE TABLE IF NOT EXISTS `");
}

function idempotentIndexStatement(statement: string): string | undefined {
  const trimmedStatement = statement.trim();

  if (!/^CREATE\s+(UNIQUE\s+)?INDEX\s+/i.test(trimmedStatement)) {
    return undefined;
  }

  return trimmedStatement
    .replace(/^CREATE UNIQUE INDEX\s+`/i, "CREATE UNIQUE INDEX IF NOT EXISTS `")
    .replace(/^CREATE INDEX\s+`/i, "CREATE INDEX IF NOT EXISTS `");
}

function indexTarget(statement: string) {
  const match = statement.match(
    /^CREATE\s+(?:UNIQUE\s+)?INDEX\s+`[^`]+`\s+ON\s+`([^`]+)`\s+\((.+)\)$/i,
  );

  if (!match) {
    return null;
  }

  const [, tableName, columnList] = match;
  const columns = [...columnList.matchAll(/`([^`]+)`/g)].map((columnMatch) => columnMatch[1]);

  return {
    tableName,
    columns,
  };
}

async function applyBaselineWithoutClobberingExistingTables(
  client: Client,
  baseline: MigrationMeta,
): Promise<void> {
  for (const statement of baseline.sql) {
    const idempotentStatement = idempotentBaselineStatement(statement);

    if (idempotentStatement) {
      await client.execute(idempotentStatement);
    }
  }
}

async function ensureTableAdoptionColumns(
  client: Client,
  tableName: keyof typeof tableAdoptionColumns,
): Promise<void> {
  if (!(await tableExists(client, tableName))) {
    return;
  }

  const columns = await columnNames(client, tableName);

  for (const column of tableAdoptionColumns[tableName]) {
    if (!columns.has(column.name)) {
      await client.execute(`ALTER TABLE \`${tableName}\` ADD COLUMN ${column.definition}`);
    }
  }
}

async function ensureReviewRunAdoptionColumns(client: Client): Promise<void> {
  if (!(await tableExists(client, "review_run"))) {
    return;
  }

  const columns = await columnNames(client, "review_run");

  for (const column of reviewRunAdoptionColumns) {
    if (!columns.has(column.name)) {
      await client.execute(`ALTER TABLE \`review_run\` ADD COLUMN ${column.definition}`);
    }
  }

  for (const statement of reviewRunAdoptionIndexes) {
    await client.execute(statement);
  }
}

async function applyBaselineIndexesWhenColumnsExist(
  client: Client,
  baseline: MigrationMeta,
): Promise<void> {
  for (const statement of baseline.sql) {
    const idempotentStatement = idempotentIndexStatement(statement);

    if (!idempotentStatement) {
      continue;
    }

    const target = indexTarget(statement);

    if (!target || !(await tableExists(client, target.tableName))) {
      continue;
    }

    const columns = await columnNames(client, target.tableName);

    if (target.columns.every((column) => columns.has(column))) {
      await client.execute(idempotentStatement);
    }
  }
}

async function recordAppliedMigration(client: Client, migration: MigrationMeta): Promise<void> {
  await client.execute(
    `CREATE TABLE IF NOT EXISTS ${quotedIdentifier(migrationsTable)} (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at numeric)`,
  );

  const existing = await client.execute(
    `SELECT 1 FROM ${quotedIdentifier(migrationsTable)} WHERE created_at = ${migration.folderMillis} LIMIT 1`,
  );

  if (existing.rows.length === 0) {
    await client.execute(
      `INSERT INTO ${quotedIdentifier(migrationsTable)} (hash, created_at) VALUES (${sqlString(
        migration.hash,
      )}, ${migration.folderMillis})`,
    );
  }
}

async function adoptUnmanagedDatabase(client: Client, migrations: MigrationMeta[]): Promise<void> {
  const baseline = migrations[0];

  if (!baseline) {
    throw new Error(`No Drizzle baseline migration exists in ${migrationsFolder}`);
  }

  console.info(
    "No Drizzle migration history found on an existing database; adopting baseline safely.",
  );
  await applyBaselineWithoutClobberingExistingTables(client, baseline);
  await ensureTableAdoptionColumns(client, "user");
  await ensureTableAdoptionColumns(client, "organization");
  await ensureReviewRunAdoptionColumns(client);
  await applyBaselineIndexesWhenColumnsExist(client, baseline);
  await recordAppliedMigration(client, baseline);
}

async function migrateManagedDatabase(client: Client): Promise<void> {
  const database = drizzle({ client });
  await runDrizzleMigrations(database, { migrationsFolder, migrationsTable });
}

async function main(): Promise<void> {
  dotenv.config({ path: resolve(repoRoot, "apps/server/.env") });

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required to run database migrations.");
  }

  const client = createClient({ url: databaseUrl });
  try {
    const migrations = readMigrationFiles({ migrationsFolder, migrationsTable });
    const needsBaselineAdoption =
      !(await hasMigrationHistory(client)) && (await hasApplicationTables(client));

    if (needsBaselineAdoption) {
      await adoptUnmanagedDatabase(client, migrations);
    }

    await migrateManagedDatabase(client);
    console.info("Database migrations are up to date.");
  } finally {
    client.close();
  }
}

await main();
