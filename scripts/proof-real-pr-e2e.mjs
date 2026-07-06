#!/usr/bin/env node
import { resolve } from "node:path";

import { loadHostedAgentsLocalEnv } from "./local-env.mjs";

function parseArgs(argv) {
  const args = {
    repo: "AaronAbuUsama/test-repo",
    timeoutMs: 15 * 60 * 1000,
    pollMs: 2_000,
    requireCompleted: false,
    requireGitHubOutput: false,
    verifyDaytona: true,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--repo" && next) {
      args.repo = next;
      index += 1;
    } else if (arg === "--pr" && next) {
      args.pr = Number(next);
      index += 1;
    } else if (arg === "--timeout-ms" && next) {
      args.timeoutMs = Number(next);
      index += 1;
    } else if (arg === "--poll-ms" && next) {
      args.pollMs = Number(next);
      index += 1;
    } else if (arg === "--require-completed") {
      args.requireCompleted = true;
    } else if (arg === "--require-github-output") {
      args.requireGitHubOutput = true;
    } else if (arg === "--no-daytona-check") {
      args.verifyDaytona = false;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown or incomplete argument: ${arg}`);
    }
  }

  const [owner, name] = args.repo.split("/");
  if (!owner || !name) {
    throw new Error("--repo must use owner/name format.");
  }
  if (args.pr !== undefined && (!Number.isInteger(args.pr) || args.pr <= 0)) {
    throw new Error("--pr must be a positive integer.");
  }

  return { ...args, owner, name };
}

function printHelp() {
  console.log(`
Usage:
  bun scripts/proof-real-pr-e2e.mjs --repo AaronAbuUsama/test-repo [--pr 1]

This script does not send or synthesize webhooks. It waits for durable database
state produced by a real GitHub PR webhook flowing through Smee, the Hono server,
the worker, Daytona, and Flue/Codex.
`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

async function loadDatabase() {
  const [{ db }, schema, { and, asc, desc, eq, gt }] = await Promise.all([
    import("@hosted-agents/db"),
    import("@hosted-agents/db/schema/index"),
    import("drizzle-orm"),
  ]);

  return { db, schema, ops: { and, asc, desc, eq, gt } };
}

async function findLatestRun(database, schema, ops, args) {
  const conditions = [
    ops.eq(schema.agentRun.sourceProvider, "github"),
    ops.eq(schema.agentRun.runType, "github.pull_request_review"),
    ops.eq(schema.agentRun.repositoryOwner, args.owner),
    ops.eq(schema.agentRun.repositoryName, args.name),
  ];
  if (args.pr) {
    conditions.push(ops.eq(schema.agentRun.pullRequestNumber, args.pr));
  }

  const [run] = await database
    .select()
    .from(schema.agentRun)
    .where(ops.and(...conditions))
    .orderBy(ops.desc(schema.agentRun.createdAt))
    .limit(1);

  return run ?? null;
}

async function listEvents(database, schema, ops, runId, afterSequence) {
  return database
    .select()
    .from(schema.agentRunEvent)
    .where(
      ops.and(
        ops.eq(schema.agentRunEvent.runId, runId),
        ops.gt(schema.agentRunEvent.sequence, afterSequence),
      ),
    )
    .orderBy(ops.asc(schema.agentRunEvent.sequence));
}

async function listSandboxes(database, schema, ops, runId) {
  return database
    .select()
    .from(schema.agentRunSandbox)
    .where(ops.eq(schema.agentRunSandbox.runId, runId))
    .orderBy(ops.asc(schema.agentRunSandbox.createdAt));
}

async function listArtifacts(database, schema, ops, runId) {
  return database
    .select()
    .from(schema.agentRunArtifact)
    .where(ops.eq(schema.agentRunArtifact.runId, runId))
    .orderBy(ops.asc(schema.agentRunArtifact.createdAt));
}

function parseArtifactPayload(artifact) {
  const raw = artifact.payloadJson ?? artifact.content;
  if (!raw) {
    return null;
  }

  return JSON.parse(raw);
}

function requiredArtifact(artifacts, name) {
  const artifact = artifacts.find((candidate) => candidate.name === name);
  if (!artifact) {
    throw new Error(`GitHub output proof failed: missing artifact ${name}`);
  }

  return parseArtifactPayload(artifact);
}

async function verifyApiSurface(run, expectedEventCount) {
  const { appRouter } = await import("../packages/api/src/routers/index.ts");
  const context = {
    auth: null,
    session: {
      user: { id: run.userId },
      session: { activeOrganizationId: run.organizationId },
    },
    reviewRunInvoker: async () => ({ flueRunId: "unused" }),
  };

  const runs = await appRouter.agentRuns.callable({ context })({
    organizationId: run.organizationId,
  });
  const events = await appRouter.agentRunEvents.callable({ context })({
    runId: run.id,
    organizationId: run.organizationId,
  });
  const listedRun = runs.find((item) => item.id === run.id);

  if (!listedRun) {
    throw new Error(`API proof failed: agentRuns did not list run ${run.id}`);
  }
  if (listedRun.status !== run.status) {
    throw new Error(
      `API proof failed: listed run status ${listedRun.status} did not match ${run.status}`,
    );
  }
  if (events.length !== expectedEventCount) {
    throw new Error(
      `API proof failed: expected ${expectedEventCount} events, got ${events.length}`,
    );
  }
  for (let index = 0; index < events.length; index += 1) {
    const expectedSequence = index + 1;
    if (events[index].sequence !== expectedSequence) {
      throw new Error(
        `API proof failed: expected event sequence ${expectedSequence}, got ${events[index].sequence}`,
      );
    }
  }

  return {
    listedRunStatus: listedRun.status,
    listedRunStage: listedRun.currentStage,
    eventCount: events.length,
    firstEvent: events[0]?.type ?? null,
    lastEvent: events.at(-1)?.type ?? null,
  };
}

async function verifyGitHubOutput(database, schema, ops, run, allEvents) {
  const requiredEventTypes = [
    "github.tool.start_github_review.completed",
    "github.tool.submit_pull_request_review.completed",
    "github.tool.complete_review_check.completed",
  ];
  const eventTypes = new Set(allEvents.map((event) => event.type));
  for (const eventType of requiredEventTypes) {
    if (!eventTypes.has(eventType)) {
      throw new Error(`GitHub output proof failed: missing durable event ${eventType}`);
    }
  }

  const [installation] = await database
    .select()
    .from(schema.githubInstallation)
    .where(ops.eq(schema.githubInstallation.id, run.githubInstallationId))
    .limit(1);
  if (!installation) {
    throw new Error("GitHub output proof failed: linked installation record not found");
  }

  const { createGitHubInstallationAccessToken } = await import("../packages/api/src/github-app.ts");
  const token = await createGitHubInstallationAccessToken(installation.installationId);
  const artifacts = await listArtifacts(database, schema, ops, run.id);
  const start = requiredArtifact(artifacts, "github/start-review.json");
  const review = requiredArtifact(artifacts, "github/pull-request-review.json");
  const check = requiredArtifact(artifacts, "github/check-run.json");

  const owner = run.repositoryOwner;
  const repo = run.repositoryName;
  const pullNumber = run.pullRequestNumber;
  if (!owner || !repo || !pullNumber) {
    throw new Error(
      "GitHub output proof failed: run is missing repository or pull request metadata",
    );
  }

  const ownerSegment = encodeURIComponent(owner);
  const repoSegment = encodeURIComponent(repo);
  const [comment, pullRequestReview, checkRun] = await Promise.all([
    githubGet(
      token,
      `/repos/${ownerSegment}/${repoSegment}/issues/comments/${encodeURIComponent(
        start.commentId,
      )}`,
    ),
    githubGet(
      token,
      `/repos/${ownerSegment}/${repoSegment}/pulls/${encodeURIComponent(
        pullNumber,
      )}/reviews/${encodeURIComponent(review.reviewId)}`,
    ),
    githubGet(
      token,
      `/repos/${ownerSegment}/${repoSegment}/check-runs/${encodeURIComponent(check.checkRunId)}`,
    ),
  ]);

  if (!comment.body?.includes(run.id)) {
    throw new Error("GitHub output proof failed: start comment does not contain the agent run id");
  }
  if (pullRequestReview.id !== review.reviewId) {
    throw new Error("GitHub output proof failed: pull request review id mismatch");
  }
  if (checkRun.id !== check.checkRunId) {
    throw new Error("GitHub output proof failed: check run id mismatch");
  }

  return {
    startCommentUrl: comment.html_url,
    reviewUrl: pullRequestReview.html_url,
    checkRunUrl: checkRun.html_url,
    checkConclusion: checkRun.conclusion,
  };
}

async function githubGet(token, path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub GET ${path} failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
}

async function verifyNoDaytonaSandboxes(labels, env) {
  if (!env.DAYTONA_API_KEY) {
    return { checked: false, reason: "DAYTONA_API_KEY is not set" };
  }

  const { Daytona } = await import("@daytona/sdk");
  const client = new Daytona({
    apiKey: env.DAYTONA_API_KEY,
    apiUrl: env.DAYTONA_API_URL,
    otelEnabled: false,
  });
  const remaining = [];

  try {
    for await (const sandbox of client.list({ labels })) {
      remaining.push(sandbox.id);
    }
  } finally {
    await client[Symbol.asyncDispose]?.();
  }

  return { checked: true, remaining };
}

async function main() {
  const root = process.cwd();
  const args = parseArgs(process.argv.slice(2));
  const env = loadHostedAgentsLocalEnv({ root });
  Object.assign(process.env, {
    ...env,
    DATABASE_URL: normalizeDatabaseUrl(env.DATABASE_URL, root),
  });
  const { db, schema, ops } = await loadDatabase();
  const deadline = Date.now() + args.timeoutMs;
  let currentRunId = null;
  let lastSequence = 0;

  console.log(`Waiting for real PR webhook proof for ${args.repo}${args.pr ? `#${args.pr}` : ""}.`);
  console.log("Keep `bun run dev:github-webhooks` running, then open or sync a real PR.");

  while (Date.now() < deadline) {
    const run = await findLatestRun(db, schema, ops, args);

    if (!run) {
      await sleep(args.pollMs);
      continue;
    }

    const runId = run.id;
    if (runId !== currentRunId) {
      currentRunId = runId;
      lastSequence = 0;
      console.log(`Observed agent_run ${runId}`);
    }

    const events = await listEvents(db, schema, ops, runId, lastSequence);
    for (const event of events) {
      lastSequence = event.sequence;
      console.log(
        [
          `#${lastSequence}`,
          event.category,
          event.type,
          event.stage ? `(${event.stage})` : "",
          event.message,
        ]
          .filter(Boolean)
          .join(" "),
      );
    }

    const status = run.status;
    if (status === "completed" || status === "failed") {
      const sandboxes = await listSandboxes(db, schema, ops, runId);
      console.log(`Terminal status: ${status}`);
      console.log(`Sandbox records: ${sandboxes.length}`);

      if (args.verifyDaytona && sandboxes.length === 0 && !run.sandboxId) {
        console.log("Daytona orphan check skipped: no sandbox was created for this run.");
      } else if (args.verifyDaytona) {
        const labels = {
          app: "hosted-agents",
          workerRole: run.workerRole ?? "code_review",
          agentRunId: runId,
          organizationId: run.organizationId,
        };
        const daytona = await verifyNoDaytonaSandboxes(labels, env);
        if (!daytona.checked) {
          console.log(`Daytona orphan check skipped: ${daytona.reason}`);
        } else if (daytona.remaining.length > 0) {
          console.error(`Daytona orphan check failed: ${daytona.remaining.join(", ")}`);
          process.exit(2);
        } else {
          console.log("Daytona orphan check passed: no matching sandboxes remain.");
        }
      }

      if (args.requireCompleted && status !== "completed") {
        process.exit(3);
      }
      const allEvents = await listEvents(db, schema, ops, runId, 0);
      const apiProof = await verifyApiSurface(run, lastSequence);
      console.log(
        `API proof passed: listed ${apiProof.listedRunStatus}/${apiProof.listedRunStage} run with ${apiProof.eventCount} ordered events (${apiProof.firstEvent} -> ${apiProof.lastEvent}).`,
      );
      if (args.requireGitHubOutput) {
        const githubProof = await verifyGitHubOutput(db, schema, ops, run, allEvents);
        console.log(
          [
            "GitHub output proof passed:",
            `start=${githubProof.startCommentUrl}`,
            `review=${githubProof.reviewUrl}`,
            `check=${githubProof.checkRunUrl}`,
            `conclusion=${githubProof.checkConclusion}`,
          ].join(" "),
        );
      }
      return;
    }

    await sleep(args.pollMs);
  }

  console.error("Timed out waiting for a terminal agent_run status.");
  process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
