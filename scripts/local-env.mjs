import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, resolve } from "node:path";

const daytonaEnvAliases = [
  ["DAYTONA_API_KEY", "DATONA_API_KEY"],
  ["DAYTONA_API_URL", "DATONA_API_URL"],
];

export function parseEnvFile(path) {
  if (!existsSync(path)) {
    return {};
  }

  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        const key = line.slice(0, index);
        const value = line.slice(index + 1).replace(/^['"]|['"]$/g, "");
        return [key, value];
      }),
  );
}

export function applyDaytonaEnvAliases(env) {
  const merged = { ...env };

  for (const [currentName, legacyName] of daytonaEnvAliases) {
    if (!merged[currentName] && merged[legacyName]) {
      merged[currentName] = merged[legacyName];
    }
  }

  return merged;
}

export function ensureServerEnv(root = process.cwd()) {
  const serverEnvPath = resolve(root, "apps/server/.env");

  if (!existsSync(serverEnvPath)) {
    console.error("Missing apps/server/.env. Copy the local server env before running this.");
    process.exit(1);
  }

  const env = parseEnvFile(serverEnvPath);

  if (!env.GITHUB_WEBHOOK_SECRET) {
    appendFileSync(serverEnvPath, `\nGITHUB_WEBHOOK_SECRET=${randomBytes(32).toString("hex")}\n`);
    console.info("Generated GITHUB_WEBHOOK_SECRET in apps/server/.env");
  }

  return parseEnvFile(serverEnvPath);
}

export function loadHostedAgentsLocalEnv({ root = process.cwd(), ensureServer = true } = {}) {
  const serverEnvPath = resolve(root, "apps/server/.env");
  const braintrustEnvPath = resolve(root, ".env.braintrust");
  const localSecretsEnvPath = resolve(homedir(), ".config/hosted-agents/secrets.env");
  const serverEnv = ensureServer ? ensureServerEnv(root) : parseEnvFile(serverEnvPath);

  return applyDaytonaEnvAliases({
    ...process.env,
    ...parseEnvFile(localSecretsEnvPath),
    ...serverEnv,
    ...parseEnvFile(braintrustEnvPath),
  });
}

export function resolveLocalEnvPath(value, { root = process.cwd(), base = "apps/server" } = {}) {
  if (isAbsolute(value)) {
    return value;
  }

  return resolve(root, base, value);
}

export function checkGitHubAppPrivateKey(
  env,
  {
    root = process.cwd(),
    keyVar = "GITHUB_APP_PRIVATE_KEY",
    pathVar = "GITHUB_APP_PRIVATE_KEY_PATH",
  } = {},
) {
  if (env[keyVar]) {
    return { ok: true, source: keyVar };
  }

  if (!env[pathVar]) {
    return {
      ok: false,
      reason: `${keyVar} or ${pathVar} is required.`,
    };
  }

  const privateKeyPath = resolveLocalEnvPath(env[pathVar], { root });

  try {
    readFileSync(privateKeyPath, "utf8");
    return {
      ok: true,
      source: pathVar,
      path: privateKeyPath,
    };
  } catch (error) {
    return {
      ok: false,
      path: privateKeyPath,
      reason:
        error instanceof Error
          ? `${error.message}. Move the key to a terminal-readable path or set ${keyVar}.`
          : "GitHub App private key is not readable.",
    };
  }
}
