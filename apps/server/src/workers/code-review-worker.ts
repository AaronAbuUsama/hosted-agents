import "../braintrust";
import "../sentry";

import { drainQueuedCodeReviews } from "../runners/code-review-run-worker";
import { DaytonaCodeReviewSandboxRunner } from "../runners/daytona-code-review-sandbox-runner";
import { registerPiOpenAICodexProvider } from "../lib/pi-auth";

const args = new Set(process.argv.slice(2));
const once = args.has("--once");
const pollIntervalMs = Number(process.env.CODE_REVIEW_WORKER_POLL_INTERVAL_MS ?? 5_000);

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function registerOptionalPiProvider() {
  try {
    await registerPiOpenAICodexProvider();
  } catch (error) {
    console.warn(
      `[code-review-worker] Optional Pi provider registration failed: ${
        error instanceof Error ? error.message : "unknown error"
      }`,
    );
  }
}

await registerOptionalPiProvider();

const runner = new DaytonaCodeReviewSandboxRunner();
console.info(
  `[code-review-worker] started${once ? " in one-shot mode" : `; polling every ${pollIntervalMs}ms`}`,
);

while (true) {
  const results = await drainQueuedCodeReviews({ runner, limit: 1 });

  for (const result of results) {
    if (result.status === "idle") {
      continue;
    }

    console.info("[code-review-worker] processed review run", result);
  }

  if (once) {
    break;
  }

  await sleep(pollIntervalMs);
}
