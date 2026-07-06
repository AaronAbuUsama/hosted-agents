#!/usr/bin/env node
import { resolve } from "node:path";

import { checkGitHubAppPrivateKey, loadHostedAgentsLocalEnv } from "./local-env.mjs";

function normalizeDatabaseUrl(databaseUrl, root) {
  if (
    !databaseUrl.startsWith("file:") ||
    databaseUrl === "file::memory:" ||
    databaseUrl.startsWith("file:/")
  ) {
    return databaseUrl;
  }

  return `file:${resolve(root, "apps/server", databaseUrl.slice("file:".length))}`;
}

async function tableIsQueryable(tableName) {
  const [{ db }, schema] = await Promise.all([
    import("@hosted-agents/db"),
    import("@hosted-agents/db/schema/index"),
  ]);
  const table = schema[tableName];

  try {
    await db.select().from(table).limit(1);
    return true;
  } catch {
    return false;
  }
}

function checkRequiredEnv(env, keys) {
  return keys
    .filter((key) => !env[key])
    .map((key) => ({
      ok: false,
      label: key,
      reason: `${key} is required.`,
    }));
}

async function main() {
  const root = process.cwd();
  const env = loadHostedAgentsLocalEnv({ root });
  Object.assign(process.env, {
    ...env,
    DATABASE_URL: normalizeDatabaseUrl(env.DATABASE_URL, root),
  });
  const checks = [
    ...checkRequiredEnv(env, [
      "DATABASE_URL",
      "GITHUB_WEBHOOK_PROXY_URL",
      "GITHUB_WEBHOOK_SECRET",
      "GITHUB_APP_ID",
      "GITHUB_APP_SLUG",
      "DAYTONA_API_KEY",
    ]),
  ];
  const keyCheck = checkGitHubAppPrivateKey(env, { root });

  checks.push({
    ok: keyCheck.ok,
    label: "GitHub App private key",
    reason: keyCheck.ok ? `Readable from ${keyCheck.source}.` : keyCheck.reason,
  });

  if (env.DATABASE_URL) {
    checks.push({
      ok: await tableIsQueryable("agentRun"),
      label: "agent_run table",
      reason: "DATABASE_URL must have migrations applied.",
    });
    checks.push({
      ok: await tableIsQueryable("agentRunEvent"),
      label: "agent_run_event table",
      reason: "DATABASE_URL must have migrations applied.",
    });
  }

  let failed = false;
  for (const check of checks) {
    if (check.ok) {
      console.log(`[ok] ${check.label}`);
      continue;
    }

    failed = true;
    console.error(`[fail] ${check.label}: ${check.reason}`);
  }

  if (failed) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
