import { createGitHubInstallationAccessToken } from "@hosted-agents/api/github-app";
import { db } from "@hosted-agents/db";
import {
  CODE_REVIEW_WORKER_DISPLAY_NAME,
  CODE_REVIEW_WORKER_ROLE,
  GITHUB_PULL_REQUEST_REVIEW_RUN_TYPE,
  agentRun,
} from "@hosted-agents/db/schema/agent-runs";
import { eq } from "drizzle-orm";

import { appendAgentRunEvent, insertAgentRunArtifact } from "./agent-run-events";
import {
  CodeReviewSandboxRunError,
  type CodeReviewSandboxRunner,
} from "./code-review-sandbox-runner";
import { cleanupDaytonaSandboxesByLabels } from "./daytona-code-review-sandbox-runner";
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

type AgentRun = typeof agentRun.$inferSelect;
type CleanupSandboxesByLabels = typeof cleanupDaytonaSandboxesByLabels;

export type RunQueuedCodeReviewResult =
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
  return queuedRunErrorMessage(error, "Unknown code review worker failure");
}

function requireRunMetadata(run: AgentRun) {
  const {
    githubInstallationId,
    githubRepositoryId,
    repositoryOwner,
    repositoryName,
    pullRequestNumber,
    pullRequestBaseRef,
    pullRequestBaseSha,
    pullRequestHeadRef,
    pullRequestHeadSha,
  } = run;
  const missing = [
    ["githubInstallationId", githubInstallationId],
    ["githubRepositoryId", githubRepositoryId],
    ["repositoryOwner", repositoryOwner],
    ["repositoryName", repositoryName],
    ["pullRequestNumber", pullRequestNumber],
    ["pullRequestBaseRef", pullRequestBaseRef],
    ["pullRequestBaseSha", pullRequestBaseSha],
    ["pullRequestHeadRef", pullRequestHeadRef],
    ["pullRequestHeadSha", pullRequestHeadSha],
  ]
    .filter(([, value]) => value === null || value === undefined || value === "")
    .map(([name]) => name);

  if (
    !githubInstallationId ||
    !githubRepositoryId ||
    !repositoryOwner ||
    !repositoryName ||
    !pullRequestNumber ||
    !pullRequestBaseRef ||
    !pullRequestBaseSha ||
    !pullRequestHeadRef ||
    !pullRequestHeadSha
  ) {
    throw new Error(`Queued GitHub agent run is missing metadata: ${missing.join(", ")}`);
  }

  return {
    githubInstallationId,
    githubRepositoryId,
    workerRole: run.workerRole,
    workerDisplayName: run.workerDisplayName ?? CODE_REVIEW_WORKER_DISPLAY_NAME,
    owner: repositoryOwner,
    repo: repositoryName,
    pullRequestNumber,
    baseRef: pullRequestBaseRef,
    baseSha: pullRequestBaseSha,
    headRef: pullRequestHeadRef,
    headSha: pullRequestHeadSha,
  };
}

export async function recoverStaleRunningCodeReviews({
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
    runType: GITHUB_PULL_REQUEST_REVIEW_RUN_TYPE,
    workerRole: CODE_REVIEW_WORKER_ROLE,
    staleAfterMs,
    cleanupSandboxesByLabels,
  });
}

export async function runNextQueuedCodeReview({
  runner,
  database = db,
  createInstallationAccessToken = createGitHubInstallationAccessToken,
}: {
  runner: CodeReviewSandboxRunner;
  database?: WorkerDatabase;
  createInstallationAccessToken?: CreateInstallationAccessToken;
}): Promise<RunQueuedCodeReviewResult> {
  const run = await claimNextQueuedGitHubRun(database, {
    runType: GITHUB_PULL_REQUEST_REVIEW_RUN_TYPE,
    workerRole: CODE_REVIEW_WORKER_ROLE,
  });

  if (!run) {
    return { status: "idle" };
  }

  await appendAgentRunEvent(database, {
    runId: run.id,
    category: "worker",
    type: "worker.claimed",
    stage: "worker_claimed",
    message: "Worker claimed queued GitHub pull request code review run",
    payload: {
      workerRole: run.workerRole,
      workerDisplayName: run.workerDisplayName ?? CODE_REVIEW_WORKER_DISPLAY_NAME,
    },
  });

  try {
    const metadata = requireRunMetadata(run);
    const context = await resolveQueuedGitHubRunContext(database, run, {
      createInstallationAccessToken,
      defaultDisplayName: CODE_REVIEW_WORKER_DISPLAY_NAME,
    });
    const { configuration, workerDisplayName } = context;

    const result = await runner.run({
      agentRunId: run.id,
      organizationId: run.organizationId,
      workerRole: metadata.workerRole,
      workerDisplayName,
      configuredModel: configuration?.model ?? undefined,
      configuredReasoningEffort: configuration?.reasoningEffort ?? undefined,
      configuredInstructions: configuration?.instructions ?? undefined,
      skills: context.skills,
      providerCredentialId: run.providerCredentialId ?? undefined,
      githubInstallationId: metadata.githubInstallationId,
      githubRepositoryId: metadata.githubRepositoryId,
      installationId: context.installation.installationId,
      installationAccessToken: context.installationAccessToken,
      owner: metadata.owner,
      repo: metadata.repo,
      pullRequestNumber: metadata.pullRequestNumber,
      baseRef: metadata.baseRef,
      baseSha: metadata.baseSha,
      headRef: metadata.headRef,
      headSha: metadata.headSha,
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
        findingsJson: result.findingsJson,
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
      message: "Code review completed",
      payload: {
        sandboxId: result.sandboxId,
        model: result.model,
        workerRole: metadata.workerRole,
        workerDisplayName,
        findingsCount: JSON.parse(result.findingsJson || "[]").length,
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
      logs: error instanceof CodeReviewSandboxRunError ? error.logs : undefined,
      sandboxId: error instanceof CodeReviewSandboxRunError ? error.sandboxId : undefined,
    });

    return {
      status: "failed",
      agentRunId: run.id,
      errorMessage: message,
    };
  }
}

export async function drainQueuedCodeReviews({
  runner,
  database = db,
  createInstallationAccessToken = createGitHubInstallationAccessToken,
  limit = 1,
  recoverStaleRuns = true,
}: {
  runner: CodeReviewSandboxRunner;
  database?: WorkerDatabase;
  createInstallationAccessToken?: CreateInstallationAccessToken;
  limit?: number;
  recoverStaleRuns?: boolean;
}) {
  return drainQueuedGitHubRuns<RunQueuedCodeReviewResult>({
    limit,
    recoverStale: recoverStaleRuns ? () => recoverStaleRunningCodeReviews({ database }) : undefined,
    runOne: () => runNextQueuedCodeReview({ runner, database, createInstallationAccessToken }),
  });
}
