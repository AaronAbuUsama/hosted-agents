import { createGitHubInstallationAccessToken } from "@hosted-agents/api/github-app";
import { db } from "@hosted-agents/db";
import {
  CODE_REVIEW_WORKER_DISPLAY_NAME,
  CODE_REVIEW_WORKER_ROLE,
  GITHUB_PULL_REQUEST_REVIEW_RUN_TYPE,
  agentRun,
} from "@hosted-agents/db/schema/agent-runs";
import { githubInstallation, githubRepository } from "@hosted-agents/db/schema/github";
import { workerConfig, workerSkill, workerSkillFile } from "@hosted-agents/db/schema/worker-config";
import { and, asc, eq, inArray, isNull, lt, or } from "drizzle-orm";

import {
  appendAgentRunEvent,
  appendFlueRunEvent,
  insertAgentRunArtifact,
  recordAgentRunSandboxCompleted,
  recordAgentRunSandboxCreated,
  recordAgentRunStage,
} from "./agent-run-events";
import {
  CodeReviewSandboxRunError,
  type CodeReviewSandboxLifecycleEvent,
  type CodeReviewSandboxRunner,
} from "./code-review-sandbox-runner";
import { cleanupDaytonaSandboxesByLabels } from "./daytona-code-review-sandbox-runner";

type Database = typeof db;
type AgentRun = typeof agentRun.$inferSelect;
type WorkerDatabase = Pick<Database, "insert" | "select" | "update" | "transaction">;
type CreateInstallationAccessToken = (installationId: string) => Promise<string>;
type CleanupSandboxesByLabels = typeof cleanupDaytonaSandboxesByLabels;

const STALE_RUNNING_RUN_MS = 30 * 60 * 1000;

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
  return error instanceof Error ? error.message : "Unknown code review worker failure";
}

async function claimNextQueuedGitHubAgentRun(database: WorkerDatabase) {
  return database.transaction(async (transaction) => {
    const [candidate] = await transaction
      .select()
      .from(agentRun)
      .where(
        and(
          eq(agentRun.sourceProvider, "github"),
          eq(agentRun.runType, GITHUB_PULL_REQUEST_REVIEW_RUN_TYPE),
          eq(agentRun.workerRole, CODE_REVIEW_WORKER_ROLE),
          eq(agentRun.status, "queued"),
        ),
      )
      .orderBy(asc(agentRun.createdAt))
      .limit(1);

    if (!candidate) {
      return null;
    }

    const now = new Date();
    const [claimed] = await transaction
      .update(agentRun)
      .set({
        status: "running",
        currentStage: "worker_claimed",
        startedAt: candidate.startedAt ?? now,
        lastHeartbeatAt: now,
        updatedAt: now,
      })
      .where(and(eq(agentRun.id, candidate.id), eq(agentRun.status, "queued")))
      .returning();

    return claimed ?? null;
  });
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

function categoryForStage(stage: string) {
  if (stage.startsWith("sandbox")) {
    return "sandbox" as const;
  }
  if (stage.startsWith("flue")) {
    return "flue" as const;
  }
  if (stage.startsWith("result")) {
    return "result" as const;
  }
  return "worker" as const;
}

async function recordRunnerEvent(
  database: WorkerDatabase,
  runId: string,
  event: CodeReviewSandboxLifecycleEvent,
) {
  switch (event.type) {
    case "sandbox.created":
      await recordAgentRunSandboxCreated(database, {
        runId,
        provider: event.sandboxProvider,
        sandboxId: event.sandboxId,
        labels: event.labels,
      });
      return;
    case "sandbox.deleted":
      await recordAgentRunSandboxCompleted(database, {
        runId,
        sandboxId: event.sandboxId,
        status: "deleted",
      });
      return;
    case "sandbox.delete_failed":
      await recordAgentRunSandboxCompleted(database, {
        runId,
        sandboxId: event.sandboxId,
        status: "delete_failed",
        errorMessage: event.errorMessage,
      });
      return;
    case "stage":
      await recordAgentRunStage(database, {
        runId,
        category: categoryForStage(event.stage),
        type: `stage.${event.stage}`,
        stage: event.stage,
        message: event.message,
        payload: event.payload,
        status: "running",
      });
      return;
    case "flue.event":
      await appendFlueRunEvent(database, { runId, event: event.event });
      return;
    case "github.tool":
      await appendAgentRunEvent(database, {
        runId,
        category: "tool",
        type: `github.tool.${event.toolName}.${event.status}`,
        stage: "github_tool",
        message: event.message,
        payload: event.payload,
      });
      return;
    case "github.artifact":
      await insertAgentRunArtifact(database, {
        runId,
        name: event.name,
        contentType: event.contentType,
        content: event.content,
        payload: event.payload,
      });
      return;
  }
}

async function failAgentRun(
  database: WorkerDatabase,
  runId: string,
  message: string,
  details: { logs?: string; sandboxId?: string } = {},
) {
  const now = new Date();
  await database
    .update(agentRun)
    .set({
      status: "failed",
      errorMessage: message,
      sandboxId: details.sandboxId,
      currentStage: "failed",
      lastHeartbeatAt: now,
      completedAt: now,
      updatedAt: now,
    })
    .where(eq(agentRun.id, runId));

  if (details.logs) {
    await insertAgentRunArtifact(database, {
      runId,
      name: "sandbox-execution.log",
      contentType: "text/plain",
      content: details.logs,
    });
  }

  await appendAgentRunEvent(database, {
    runId,
    category: "result",
    type: "result.failed",
    stage: "failed",
    message,
    payload: { sandboxId: details.sandboxId },
  });
}

export async function recoverStaleRunningCodeReviews({
  database = db,
  staleAfterMs = STALE_RUNNING_RUN_MS,
  cleanupSandboxesByLabels = cleanupDaytonaSandboxesByLabels,
}: {
  database?: WorkerDatabase;
  staleAfterMs?: number;
  cleanupSandboxesByLabels?: CleanupSandboxesByLabels;
} = {}) {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const staleRuns = await database
    .select()
    .from(agentRun)
    .where(
      and(
        eq(agentRun.sourceProvider, "github"),
        eq(agentRun.runType, GITHUB_PULL_REQUEST_REVIEW_RUN_TYPE),
        eq(agentRun.workerRole, CODE_REVIEW_WORKER_ROLE),
        eq(agentRun.status, "running"),
        or(isNull(agentRun.lastHeartbeatAt), lt(agentRun.lastHeartbeatAt, cutoff)),
      ),
    );

  for (const run of staleRuns) {
    try {
      const cleanupResults = await cleanupSandboxesByLabels({
        labels: {
          app: "hosted-agents",
          workerRole: CODE_REVIEW_WORKER_ROLE,
          agentRunId: run.id,
          organizationId: run.organizationId,
        },
      });
      await appendAgentRunEvent(database, {
        runId: run.id,
        category: "cleanup",
        type: "cleanup.stale_sandboxes_by_labels",
        stage: "stale_recovery",
        message: "Cleaned up Daytona sandboxes by agent run labels",
        payload: { cleanupResults },
      });
    } catch (error) {
      await appendAgentRunEvent(database, {
        runId: run.id,
        category: "cleanup",
        type: "cleanup.stale_sandboxes_by_labels_failed",
        stage: "stale_recovery",
        message: errorMessage(error),
        payload: { sandboxId: run.sandboxId },
      });
    }

    await failAgentRun(database, run.id, "Recovered stale running agent run.", {
      sandboxId: run.sandboxId ?? undefined,
    });
  }

  return staleRuns.map((run) => ({ agentRunId: run.id, sandboxId: run.sandboxId }));
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
  const run = await claimNextQueuedGitHubAgentRun(database);

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
    await recordAgentRunStage(database, {
      runId: run.id,
      category: "worker",
      type: "worker.installation_lookup",
      stage: "installation_lookup",
      message: "Looking up linked GitHub installation",
      status: "running",
    });

    const [installation] = await database
      .select()
      .from(githubInstallation)
      .where(eq(githubInstallation.id, metadata.githubInstallationId))
      .limit(1);

    if (!installation) {
      throw new Error("Linked GitHub installation record was not found.");
    }

    if (installation.status !== "connected") {
      throw new Error(`Linked GitHub installation is ${installation.status}.`);
    }

    await recordAgentRunStage(database, {
      runId: run.id,
      category: "worker",
      type: "worker.repository_lookup",
      stage: "repository_lookup",
      message: "Looking up selected GitHub repository",
      status: "running",
    });

    const [repository] = await database
      .select()
      .from(githubRepository)
      .where(eq(githubRepository.id, metadata.githubRepositoryId))
      .limit(1);

    if (!repository || !repository.selected) {
      throw new Error("Linked GitHub repository record was not found or is not selected.");
    }

    await recordAgentRunStage(database, {
      runId: run.id,
      category: "worker",
      type: "worker.config_lookup",
      stage: "config_lookup",
      message: "Loading worker configuration and skills",
      status: "running",
    });

    const [configuration] = await database
      .select()
      .from(workerConfig)
      .where(
        and(
          eq(workerConfig.organizationId, run.organizationId),
          eq(workerConfig.workerRole, run.workerRole),
        ),
      )
      .limit(1);
    const enabledSkills = await database
      .select()
      .from(workerSkill)
      .where(
        and(
          eq(workerSkill.organizationId, run.organizationId),
          eq(workerSkill.workerRole, run.workerRole),
          eq(workerSkill.enabled, true),
        ),
      )
      .orderBy(asc(workerSkill.name));
    // A skill is a bundle of markdown files with a SKILL.md entry; load every
    // file of every enabled bundle for the sandbox upload.
    const skillFiles =
      enabledSkills.length > 0
        ? await database
            .select()
            .from(workerSkillFile)
            .where(
              inArray(
                workerSkillFile.skillId,
                enabledSkills.map((skill) => skill.id),
              ),
            )
            .orderBy(asc(workerSkillFile.path))
        : [];
    const skillBundles = enabledSkills.map((skill) => ({
      name: skill.name,
      files: skillFiles
        .filter((file) => file.skillId === skill.id)
        .map((file) => ({ path: file.path, content: file.content })),
    }));

    const workerDisplayName = configuration?.displayName?.trim() || metadata.workerDisplayName;

    await appendAgentRunEvent(database, {
      runId: run.id,
      category: "worker",
      type: "worker.config_loaded",
      stage: "config_lookup",
      message:
        enabledSkills.length > 0
          ? `Loaded worker configuration with ${enabledSkills.length} skill${
              enabledSkills.length === 1 ? "" : "s"
            }`
          : "Loaded worker configuration",
      payload: {
        hasConfiguration: Boolean(configuration),
        configuredModel: configuration?.model ?? null,
        configuredReasoningEffort: configuration?.reasoningEffort ?? null,
        hasInstructions: Boolean(configuration?.instructions?.trim()),
        skills: enabledSkills.map((skill) => skill.name),
      },
    });

    await recordAgentRunStage(database, {
      runId: run.id,
      category: "worker",
      type: "worker.installation_token",
      stage: "installation_token",
      message: "Creating GitHub installation access token",
      status: "running",
    });
    const installationAccessToken = await createInstallationAccessToken(
      installation.installationId,
    );

    const result = await runner.run({
      agentRunId: run.id,
      organizationId: run.organizationId,
      workerRole: metadata.workerRole,
      workerDisplayName,
      configuredModel: configuration?.model ?? undefined,
      configuredReasoningEffort: configuration?.reasoningEffort ?? undefined,
      configuredInstructions: configuration?.instructions ?? undefined,
      skills: skillBundles,
      providerCredentialId: run.providerCredentialId ?? undefined,
      githubInstallationId: metadata.githubInstallationId,
      githubRepositoryId: metadata.githubRepositoryId,
      installationId: installation.installationId,
      installationAccessToken,
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
    await failAgentRun(database, run.id, message, {
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
  if (recoverStaleRuns) {
    await recoverStaleRunningCodeReviews({ database });
  }

  const results: RunQueuedCodeReviewResult[] = [];

  for (let index = 0; index < limit; index += 1) {
    const result = await runNextQueuedCodeReview({
      runner,
      database,
      createInstallationAccessToken,
    });
    results.push(result);

    if (result.status === "idle") {
      break;
    }
  }

  return results;
}
