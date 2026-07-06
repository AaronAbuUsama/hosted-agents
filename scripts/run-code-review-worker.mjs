#!/usr/bin/env node
import { spawn } from "node:child_process";
import { resolve } from "node:path";

import { checkGitHubAppPrivateKey, loadHostedAgentsLocalEnv } from "./local-env.mjs";

const root = process.cwd();
const serverRoot = resolve(root, "apps/server");
const workerArgs = process.argv.slice(2);
const env = loadHostedAgentsLocalEnv({ root });
const keyCheck = checkGitHubAppPrivateKey(env, { root });

if (!keyCheck.ok) {
  console.error(`GitHub App private key preflight failed: ${keyCheck.reason}`);
  process.exit(1);
}

env.NODE_OPTIONS = [env.NODE_OPTIONS, "--import braintrust/hook.mjs"].filter(Boolean).join(" ");
const child = spawn("bun", ["src/workers/code-review-worker.ts", ...workerArgs], {
  cwd: serverRoot,
  env,
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    console.error(`code review worker exited from signal ${signal}`);
    process.exit(1);
  }

  process.exit(code ?? 1);
});
