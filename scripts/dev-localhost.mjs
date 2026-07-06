#!/usr/bin/env node
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const serverEnvPath = resolve(root, "apps/server/.env");
const braintrustEnvPath = resolve(root, ".env.braintrust");
const localSecretsEnvPath = resolve(homedir(), ".config/hosted-agents/secrets.env");
const children = new Set();
const daytonaEnvAliases = [
  ["DAYTONA_API_KEY", "DATONA_API_KEY"],
  ["DAYTONA_API_URL", "DATONA_API_URL"],
];

function parseEnvFile(path) {
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

function applyDaytonaEnvAliases(env) {
  const merged = { ...env };

  for (const [currentName, legacyName] of daytonaEnvAliases) {
    if (!merged[currentName] && merged[legacyName]) {
      merged[currentName] = merged[legacyName];
    }
  }

  return merged;
}

function ensureServerEnv() {
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

function prefixStream(name, stream, output) {
  let pending = "";

  stream.on("data", (chunk) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";

    for (const line of lines) {
      output.write(line ? `[${name}] ${line}\n` : "\n");
    }
  });

  stream.on("end", () => {
    if (pending) {
      output.write(`[${name}] ${pending}\n`);
    }
  });
}

function run(name, command, commandArgs, env) {
  const child = spawn(command, commandArgs, {
    cwd: root,
    env,
    stdio: ["inherit", "pipe", "pipe"],
  });

  children.add(child);
  prefixStream(name, child.stdout, process.stdout);
  prefixStream(name, child.stderr, process.stderr);

  child.on("exit", (code, signal) => {
    children.delete(child);

    if (signal || code === 0) {
      return;
    }

    console.error(`[${name}] exited with code ${code}`);
    shutdown(code ?? 1);
  });

  return child;
}

function shutdown(code = 0) {
  for (const child of children) {
    child.kill("SIGINT");
  }

  setTimeout(() => process.exit(code), 300);
}

const serverEnv = ensureServerEnv();
const mergedEnv = applyDaytonaEnvAliases({
  ...process.env,
  ...parseEnvFile(localSecretsEnvPath),
  ...serverEnv,
  ...parseEnvFile(braintrustEnvPath),
});
const smeeUrl = mergedEnv.GITHUB_WEBHOOK_PROXY_URL;
const targetUrl = mergedEnv.GITHUB_WEBHOOK_TARGET_URL ?? "http://localhost:3000/api/github/webhook";

if (!smeeUrl) {
  console.error(
    [
      "Missing GITHUB_WEBHOOK_PROXY_URL in apps/server/.env.",
      "Create a Smee channel at https://smee.io/new, then add:",
      "GITHUB_WEBHOOK_PROXY_URL=https://smee.io/<channel>",
    ].join("\n"),
  );
  process.exit(1);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.info(`GitHub webhook proxy: ${smeeUrl}`);
console.info(`GitHub webhook target: ${targetUrl}`);

if (!args.has("--no-web")) {
  run("web", "bun", ["run", "dev:web"], mergedEnv);
}

run("server", "bun", ["run", "dev:server"], mergedEnv);
run("smee", "npx", ["--yes", "smee-client", "-u", smeeUrl, "-t", targetUrl], mergedEnv);
