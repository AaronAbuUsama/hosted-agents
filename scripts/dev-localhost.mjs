#!/usr/bin/env node
import { spawn } from "node:child_process";

import { loadHostedAgentsLocalEnv } from "./local-env.mjs";

const root = process.cwd();
const args = new Set(process.argv.slice(2));
const children = new Set();

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

const mergedEnv = loadHostedAgentsLocalEnv({ root });
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
if (!args.has("--no-worker")) {
  run("review-worker", "bun", ["run", "worker:code-reviews"], mergedEnv);
  run("implementation-worker", "bun", ["run", "worker:implementations"], mergedEnv);
}
run("smee", "npx", ["--yes", "smee-client", "-u", smeeUrl, "-t", targetUrl], mergedEnv);
