import { db } from "@hosted-agents/db";
import { agentRun } from "@hosted-agents/db/schema/agent-runs";
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
import { cleanupDaytonaSandboxesByLabels } from "./daytona-code-review-sandbox-runner";
import type { SandboxLifecycleEvent } from "./sandbox-lifecycle-event";

// The worker runtime spine, shared by every worker role. A role adapter (code
// review, implementation) supplies its run type + role and a `runOne` step; this
// module owns the atomic claim, the serial drain, stale recovery, the common
// installation/repository/config/skill/token lookup, and the durable event
// recorder. One pipeline, not two (spec #21, story 13).

type Database = typeof db;
export type AgentRun = typeof agentRun.$inferSelect;
export type WorkerDatabase = Pick<Database, "insert" | "select" | "update" | "transaction">;
export type CreateInstallationAccessToken = (installationId: string) => Promise<string>;
type CleanupSandboxesByLabels = typeof cleanupDaytonaSandboxesByLabels;

const STALE_RUNNING_RUN_MS = 30 * 60 * 1000;

export type QueuedRunRoleSelector = {
  runType: string;
  workerRole: string;
};

export function queuedRunErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

// The concurrency cap lives here: a single transaction selects the oldest queued
// run for this role and flips it to running under a `status = 'queued'` guard, so
// two workers (or two drain passes) can never claim the same run.
export async function claimNextQueuedGitHubRun(
  database: WorkerDatabase,
  { runType, workerRole }: QueuedRunRoleSelector,
): Promise<AgentRun | null> {
  return database.transaction(async (transaction) => {
    const [candidate] = await transaction
      .select()
      .from(agentRun)
      .where(
        and(
          eq(agentRun.sourceProvider, "github"),
          eq(agentRun.runType, runType),
          eq(agentRun.workerRole, workerRole),
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

export async function failQueuedGitHubRun(
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

// Fan the sandbox runner's lifecycle events out to the durable stores. Shared so
// every role's timeline is recorded identically.
export async function recordRunnerEvent(
  database: WorkerDatabase,
  runId: string,
  event: SandboxLifecycleEvent,
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

export async function recoverStaleRunningGitHubRuns({
  database = db,
  runType,
  workerRole,
  staleAfterMs = STALE_RUNNING_RUN_MS,
  cleanupSandboxesByLabels = cleanupDaytonaSandboxesByLabels,
}: QueuedRunRoleSelector & {
  database?: WorkerDatabase;
  staleAfterMs?: number;
  cleanupSandboxesByLabels?: CleanupSandboxesByLabels;
}) {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const staleRuns = await database
    .select()
    .from(agentRun)
    .where(
      and(
        eq(agentRun.sourceProvider, "github"),
        eq(agentRun.runType, runType),
        eq(agentRun.workerRole, workerRole),
        eq(agentRun.status, "running"),
        or(isNull(agentRun.lastHeartbeatAt), lt(agentRun.lastHeartbeatAt, cutoff)),
      ),
    );

  for (const run of staleRuns) {
    try {
      const cleanupResults = await cleanupSandboxesByLabels({
        labels: {
          app: "hosted-agents",
          workerRole,
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
        message: queuedRunErrorMessage(error, "Stale sandbox cleanup failed"),
        payload: { sandboxId: run.sandboxId },
      });
    }

    await failQueuedGitHubRun(database, run.id, "Recovered stale running agent run.", {
      sandboxId: run.sandboxId ?? undefined,
    });
  }

  return staleRuns.map((run) => ({ agentRunId: run.id, sandboxId: run.sandboxId }));
}

export type WorkerSkillBundle = {
  name: string;
  files: { path: string; content: string }[];
};

export type QueuedGitHubRunContext = {
  installation: typeof githubInstallation.$inferSelect;
  repository: typeof githubRepository.$inferSelect;
  configuration: typeof workerConfig.$inferSelect | undefined;
  workerDisplayName: string;
  skills: WorkerSkillBundle[];
  installationAccessToken: string;
};

// The installation/repository/worker-config/skill/token lookup common to every
// role. Emits the same worker stage events (installation_lookup → repository_lookup
// → config_lookup → config_loaded → installation_token) so a run's timeline reads
// the same regardless of role.
export async function resolveQueuedGitHubRunContext(
  database: WorkerDatabase,
  run: AgentRun,
  {
    createInstallationAccessToken,
    defaultDisplayName,
  }: {
    createInstallationAccessToken: CreateInstallationAccessToken;
    defaultDisplayName: string;
  },
): Promise<QueuedGitHubRunContext> {
  const githubInstallationId = run.githubInstallationId;
  const githubRepositoryId = run.githubRepositoryId;
  if (!githubInstallationId || !githubRepositoryId) {
    const missing = [
      ["githubInstallationId", githubInstallationId],
      ["githubRepositoryId", githubRepositoryId],
    ]
      .filter(([, value]) => value === null || value === undefined || value === "")
      .map(([name]) => name);
    throw new Error(`Queued GitHub agent run is missing metadata: ${missing.join(", ")}`);
  }

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
    .where(eq(githubInstallation.id, githubInstallationId))
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
    .where(eq(githubRepository.id, githubRepositoryId))
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
  const skillBundles: WorkerSkillBundle[] = enabledSkills.map((skill) => ({
    name: skill.name,
    files: skillFiles
      .filter((file) => file.skillId === skill.id)
      .map((file) => ({ path: file.path, content: file.content })),
  }));

  const workerDisplayName =
    configuration?.displayName?.trim() || run.workerDisplayName || defaultDisplayName;

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
  const installationAccessToken = await createInstallationAccessToken(installation.installationId);

  return {
    installation,
    repository,
    configuration,
    workerDisplayName,
    skills: skillBundles,
    installationAccessToken,
  };
}

// The serial drain: recover stale runs once, then process at most `limit` queued
// runs by calling `runOne` in sequence and stopping the moment the queue is
// empty. With `limit: 1` (the production cap) each poll processes exactly one
// run, so runs execute strictly serially.
export async function drainQueuedGitHubRuns<
  Result extends { status: "idle" | "completed" | "failed" },
>({
  runOne,
  limit = 1,
  recoverStale,
}: {
  runOne: () => Promise<Result>;
  limit?: number;
  recoverStale?: () => Promise<unknown>;
}): Promise<Result[]> {
  if (recoverStale) {
    await recoverStale();
  }

  const results: Result[] = [];

  for (let index = 0; index < limit; index += 1) {
    const result = await runOne();
    results.push(result);

    if (result.status === "idle") {
      break;
    }
  }

  return results;
}
