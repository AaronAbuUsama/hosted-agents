import "../braintrust";
import "../sentry";

import { DaytonaImplementationSandboxRunner } from "../runners/daytona-implementation-sandbox-runner";
import { drainQueuedImplementationRuns } from "../runners/implementation-run-worker";
import { registerPiOpenAICodexProvider } from "../lib/pi-auth";

const args = new Set(process.argv.slice(2));
const once = args.has("--once");
const pollIntervalMs = Number(process.env.IMPLEMENTATION_WORKER_POLL_INTERVAL_MS ?? 5_000);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function registerOptionalPiProvider() {
  try {
    await registerPiOpenAICodexProvider();
  } catch (error) {
    console.warn(
      `[implementation-worker] Optional Pi provider registration failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
}

await registerOptionalPiProvider();

const runner = new DaytonaImplementationSandboxRunner();
console.info(
  `[implementation-worker] started${
    once ? " in one-shot mode" : `; polling every ${pollIntervalMs}ms`
  }`,
);

while (true) {
  // limit: 1 is the global concurrency cap — at most one Coder run at a time.
  const results = await drainQueuedImplementationRuns({ runner, limit: 1 });

  for (const result of results) {
    if (result.status === "idle") {
      continue;
    }

    console.info("[implementation-worker] processed implementation run", result);
  }

  if (once) {
    break;
  }

  await sleep(pollIntervalMs);
}
