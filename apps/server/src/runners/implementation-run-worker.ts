import { createGitHubInstallationAccessToken } from "@hosted-agents/api/github-app";
import { db } from "@hosted-agents/db";
import {
  GITHUB_ISSUE_IMPLEMENTATION_RUN_TYPE,
  IMPLEMENTATION_WORKER_DISPLAY_NAME,
  IMPLEMENTATION_WORKER_ROLE,
  agentRun,
} from "@hosted-agents/db/schema/agent-runs";
import { eq } from "drizzle-orm";

import { appendAgentRunEvent, insertAgentRunArtifact } from "./agent-run-events";
import { cleanupDaytonaSandboxesByLabels } from "./daytona-code-review-sandbox-runner";
import {
  ImplementationSandboxRunError,
  type ImplementationSandboxRunner,
} from "./implementation-sandbox-runner";
import {
  type CreateInstallationAccessToken,
  type WorkerDatabase,
  claimNextQueuedGitHubRun,
  drainQueuedGitHubRuns,
  failQueuedGitHubRun,
  queuedRunErrorMessage,
  recordRunnerEvent,
  recoverStaleRunningGitHubRuns,
  resolveQueuedGitHubRunContext,
} from "./queued-github-run-worker";

// The implementation ("Coder") role adapter. It reuses the shared worker-runtime
// spine (claim → resolve context → run → record) and is capped to one active run
// at a time by `drainQueuedImplementationRuns({ limit: 1 })` — that limit IS the
// concurrency cap (spec #21). The write-capable Daytona runner lands in C5; this
// worker is runner-agnostic and drives whatever runner it is handed to a terminal
// state.

type CleanupSandboxesByLabels = typeof cleanupDaytonaSandboxesByLabels;

export type RunQueuedImplementationResult =
  | {
      status: "idle";
    }
  | {
      status: "completed";
      agentRunId: string;
      sandboxId: string;
    }
  | {
      status: "failed";
      agentRunId: string;
      errorMessage: string;
    };

function errorMessage(error: unknown) {
  return queuedRunErrorMessage(error, "Unknown implementation worker failure");
}

// Mint a token as the Coder's own GitHub App (ADR-0001), so the branch, commits,
// pull request, and comments are attributed to the implementation identity.
function createImplementationInstallationAccessToken(installationId: string) {
  return createGitHubInstallationAccessToken(installationId, IMPLEMENTATION_WORKER_ROLE);
}

export async function recoverStaleRunningImplementations({
  database = db,
  staleAfterMs,
  cleanupSandboxesByLabels = cleanupDaytonaSandboxesByLabels,
}: {
  database?: WorkerDatabase;
  staleAfterMs?: number;
  cleanupSandboxesByLabels?: CleanupSandboxesByLabels;
} = {}) {
  return recoverStaleRunningGitHubRuns({
    database,
    runType: GITHUB_ISSUE_IMPLEMENTATION_RUN_TYPE,
    workerRole: IMPLEMENTATION_WORKER_ROLE,
    staleAfterMs,
    cleanupSandboxesByLabels,
  });
}

export async function runNextQueuedImplementation({
  runner,
  database = db,
  createInstallationAccessToken = createImplementationInstallationAccessToken,
}: {
  runner: ImplementationSandboxRunner;
  database?: WorkerDatabase;
  createInstallationAccessToken?: CreateInstallationAccessToken;
}): Promise<RunQueuedImplementationResult> {
  const run = await claimNextQueuedGitHubRun(database, {
    runType: GITHUB_ISSUE_IMPLEMENTATION_RUN_TYPE,
    workerRole: IMPLEMENTATION_WORKER_ROLE,
  });

  if (!run) {
    return { status: "idle" };
  }

  await appendAgentRunEvent(database, {
    runId: run.id,
    category: "worker",
    type: "worker.claimed",
    stage: "worker_claimed",
    message: "Worker claimed queued GitHub issue implementation run",
    payload: {
      workerRole: run.workerRole,
      workerDisplayName: run.workerDisplayName ?? IMPLEMENTATION_WORKER_DISPLAY_NAME,
    },
  });

  try {
    const context = await resolveQueuedGitHubRunContext(database, run, {
      createInstallationAccessToken,
      defaultDisplayName: IMPLEMENTATION_WORKER_DISPLAY_NAME,
    });
    const { configuration, installation, repository, workerDisplayName } = context;

    const result = await runner.run({
      agentRunId: run.id,
      organizationId: run.organizationId,
      workerRole: run.workerRole,
      workerDisplayName,
      configuredModel: configuration?.model ?? undefined,
      configuredReasoningEffort: configuration?.reasoningEffort ?? undefined,
      configuredInstructions: configuration?.instructions ?? undefined,
      skills: context.skills,
      providerCredentialId: run.providerCredentialId ?? undefined,
      githubInstallationId: installation.id,
      githubRepositoryId: repository.id,
      installationId: installation.installationId,
      installationAccessToken: context.installationAccessToken,
      owner: repository.owner,
      repo: repository.name,
      defaultBranch: repository.defaultBranch ?? run.baseBranch ?? "main",
      // The issue this run implements — kick-off (C4) stamps it on the run. Title
      // and body stay unset here; the write-capable runner (C5) reads the live
      // issue + comments itself, so the seam only needs the number to link them.
      issueNumber: run.issueNumber ?? undefined,
      onEvent: (event) => recordRunnerEvent(database, run.id, event),
    });

    for (const artifact of result.artifacts) {
      await insertAgentRunArtifact(database, {
        runId: run.id,
        name: artifact.name,
        contentType: artifact.contentType,
        content: artifact.content,
      });
    }
    await insertAgentRunArtifact(database, {
      runId: run.id,
      name: "sandbox-execution.log",
      contentType: "text/plain",
      content: result.logs,
    });

    const now = new Date();
    await database
      .update(agentRun)
      .set({
        status: "completed",
        model: result.model,
        workerDisplayName,
        sandboxProvider: result.sandboxProvider,
        sandboxId: result.sandboxId,
        currentStage: "completed",
        lastHeartbeatAt: now,
        summary: result.summary,
        // Stamp the branch + pull request the Coder opened so the board's In PR
        // lane is immediate (C5 populates these; nulls leave the run untouched).
        branch: result.branch ?? run.branch,
        pullRequestNumber: result.pullRequestNumber ?? run.pullRequestNumber,
        pullRequestHeadRef: result.branch ?? run.pullRequestHeadRef,
        errorMessage: null,
        completedAt: now,
        updatedAt: now,
      })
      .where(eq(agentRun.id, run.id));

    await appendAgentRunEvent(database, {
      runId: run.id,
      category: "result",
      type: "result.completed",
      stage: "completed",
      message: "Issue implementation completed",
      payload: {
        sandboxId: result.sandboxId,
        model: result.model,
        workerRole: run.workerRole,
        workerDisplayName,
        branch: result.branch ?? null,
        pullRequestNumber: result.pullRequestNumber ?? null,
      },
    });

    return {
      status: "completed",
      agentRunId: run.id,
      sandboxId: result.sandboxId,
    };
  } catch (error) {
    const message = errorMessage(error);
    await failQueuedGitHubRun(database, run.id, message, {
      logs: error instanceof ImplementationSandboxRunError ? error.logs : undefined,
      sandboxId: error instanceof ImplementationSandboxRunError ? error.sandboxId : undefined,
    });

    return {
      status: "failed",
      agentRunId: run.id,
      errorMessage: message,
    };
  }
}

// `limit: 1` is the concurrency cap: each drain pass processes at most one run,
// and because the pass awaits each run to a terminal state before claiming the
// next, queued runs execute strictly serially.
export async function drainQueuedImplementationRuns({
  runner,
  database = db,
  createInstallationAccessToken = createImplementationInstallationAccessToken,
  limit = 1,
  recoverStaleRuns = true,
}: {
  runner: ImplementationSandboxRunner;
  database?: WorkerDatabase;
  createInstallationAccessToken?: CreateInstallationAccessToken;
  limit?: number;
  recoverStaleRuns?: boolean;
}) {
  return drainQueuedGitHubRuns<RunQueuedImplementationResult>({
    limit,
    recoverStale: recoverStaleRuns
      ? () => recoverStaleRunningImplementations({ database })
      : undefined,
    runOne: () => runNextQueuedImplementation({ runner, database, createInstallationAccessToken }),
  });
}
