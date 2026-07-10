import { resolveGitHubAppWorkerRole } from "@hosted-agents/api/github-app";
import { db } from "@hosted-agents/db";
import {
  agentRun,
  agentRunEvent,
  IMPLEMENTATION_WORKER_ROLE,
} from "@hosted-agents/db/schema/agent-runs";
import {
  githubInstallation,
  githubRepository,
  githubWebhookDelivery,
} from "@hosted-agents/db/schema/github";
import { agentProviderCredential } from "@hosted-agents/db/schema/provider-credentials";
import { env } from "@hosted-agents/env/server";
import { createGitHubChannel, type GitHubChannel, type GitHubWebhookDelivery } from "@flue/github";
import { and, desc, eq } from "drizzle-orm";
import type { BlankEnv } from "hono/types";

import { planGitHubPullRequestRun } from "./github-run-planner";

const OPENAI_CODEX_PROVIDER = "openai-codex";
const ADMITTED_PULL_REQUEST_ACTIONS: Record<string, true> = {
  opened: true,
  reopened: true,
  synchronize: true,
  ready_for_review: true,
};

type Database = typeof db;
type AdmissionDatabase = Pick<Database, "insert" | "select" | "update">;

type GitHubWebhookChannelOptions = {
  database?: Database;
  webhookSecret?: string;
};

type PullRequestAdmissionMetadata = {
  deliveryId: string;
  installationId: string;
  repositoryId: string;
  repositoryOwner: string;
  repositoryName: string;
  repositoryFullName: string;
  repositoryUrl: string | null;
  repositoryPrivate: boolean;
  repositoryDefaultBranch: string | null;
  pullRequestNumber: number;
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
  action: string;
};

export type GitHubWebhookAdmission = {
  ok: true;
  accepted: boolean;
  duplicate: boolean;
  event: string;
  action?: string;
  deliveryId: string;
  agentRunId?: string;
  reviewRunId?: string;
  reason?: string;
};

function acceptedJsonResponse(value: GitHubWebhookAdmission) {
  return new Response(JSON.stringify(value), {
    status: 202,
    headers: {
      "content-type": "application/json",
    },
  });
}

function deliveryAction(delivery: GitHubWebhookDelivery) {
  const payload = delivery.payload as { action?: unknown };
  return typeof payload.action === "string" ? payload.action : undefined;
}

function ignoredDelivery({
  event,
  action,
  deliveryId,
  reason,
}: {
  event: string;
  action?: string;
  deliveryId: string;
  reason: string;
}): GitHubWebhookAdmission {
  return {
    ok: true,
    accepted: false,
    duplicate: false,
    event,
    action,
    deliveryId,
    reason,
  };
}

async function claimDelivery(database: AdmissionDatabase, metadata: PullRequestAdmissionMetadata) {
  const rows = await database
    .insert(githubWebhookDelivery)
    .values({
      id: metadata.deliveryId,
      event: "pull_request",
      action: metadata.action,
      installationId: metadata.installationId,
      repositoryFullName: metadata.repositoryFullName,
      pullRequestNumber: metadata.pullRequestNumber,
      status: "claimed",
    })
    .onConflictDoNothing()
    .returning({ id: githubWebhookDelivery.id });

  return rows.length === 1;
}

async function markDeliveryIgnored(
  database: AdmissionDatabase,
  deliveryId: string,
  reason: string,
) {
  await database
    .update(githubWebhookDelivery)
    .set({
      status: `ignored:${reason}`,
      updatedAt: new Date(),
    })
    .where(eq(githubWebhookDelivery.id, deliveryId));
}

async function getDuplicateAdmission(database: AdmissionDatabase, delivery: GitHubWebhookDelivery) {
  const [claimed] = await database
    .select({
      agentRunId: githubWebhookDelivery.agentRunId,
      reviewRunId: githubWebhookDelivery.reviewRunId,
      status: githubWebhookDelivery.status,
    })
    .from(githubWebhookDelivery)
    .where(eq(githubWebhookDelivery.id, delivery.deliveryId))
    .limit(1);

  if (!claimed || (claimed.status === "claimed" && !claimed.agentRunId && !claimed.reviewRunId)) {
    throw new Error("GitHub delivery claim is incomplete; retry delivery.");
  }
  return {
    ok: true,
    accepted: false,
    duplicate: true,
    event: delivery.name,
    action: deliveryAction(delivery),
    deliveryId: delivery.deliveryId,
    agentRunId: claimed?.agentRunId ?? undefined,
    reviewRunId: claimed?.reviewRunId ?? undefined,
    reason: "duplicate_delivery",
  } satisfies GitHubWebhookAdmission;
}

async function getConnectedOpenAICodexCredential(
  database: AdmissionDatabase,
  organizationId: string,
) {
  const [row] = await database
    .select()
    .from(agentProviderCredential)
    .where(
      and(
        eq(agentProviderCredential.organizationId, organizationId),
        eq(agentProviderCredential.provider, OPENAI_CODEX_PROVIDER),
        eq(agentProviderCredential.status, "connected"),
      ),
    )
    .orderBy(desc(agentProviderCredential.updatedAt))
    .limit(1);

  return row ?? null;
}

async function resolveRepository({
  database,
  installationRecordId,
  repositorySelection,
  metadata,
}: {
  database: AdmissionDatabase;
  installationRecordId: string;
  repositorySelection: string | null;
  metadata: PullRequestAdmissionMetadata;
}) {
  const [existing] = await database
    .select()
    .from(githubRepository)
    .where(
      and(
        eq(githubRepository.installationId, installationRecordId),
        eq(githubRepository.githubRepositoryId, metadata.repositoryId),
      ),
    )
    .limit(1);

  if (existing) {
    return existing.selected ? existing : null;
  }

  if (repositorySelection !== "all") {
    return null;
  }

  const id = crypto.randomUUID();
  await database.insert(githubRepository).values({
    id,
    installationId: installationRecordId,
    githubRepositoryId: metadata.repositoryId,
    owner: metadata.repositoryOwner,
    name: metadata.repositoryName,
    fullName: metadata.repositoryFullName,
    htmlUrl: metadata.repositoryUrl,
    defaultBranch: metadata.repositoryDefaultBranch,
    private: metadata.repositoryPrivate,
    selected: true,
  });

  const [created] = await database
    .select()
    .from(githubRepository)
    .where(eq(githubRepository.id, id))
    .limit(1);

  return created ?? null;
}

function pullRequestMetadata(delivery: GitHubWebhookDelivery): PullRequestAdmissionMetadata | null {
  if (delivery.name !== "pull_request") {
    return null;
  }

  const { payload } = delivery;
  const action = payload.action;
  const installationId = payload.installation?.id;
  const repositoryId = payload.repository.id;
  const repositoryFullName = payload.repository.full_name;
  const repositoryOwner = payload.repository.owner?.login ?? repositoryFullName.split("/")[0];
  const repositoryName = payload.repository.name;
  const pullRequest = payload.pull_request;

  if (
    typeof action !== "string" ||
    !ADMITTED_PULL_REQUEST_ACTIONS[action] ||
    typeof installationId !== "number" ||
    typeof repositoryId !== "number" ||
    typeof repositoryOwner !== "string" ||
    repositoryOwner.length === 0 ||
    typeof repositoryName !== "string" ||
    repositoryName.length === 0 ||
    typeof repositoryFullName !== "string" ||
    repositoryFullName.length === 0
  ) {
    return null;
  }

  return {
    deliveryId: delivery.deliveryId,
    installationId: String(installationId),
    repositoryId: String(repositoryId),
    repositoryOwner,
    repositoryName,
    repositoryFullName,
    repositoryUrl: payload.repository.html_url ?? null,
    repositoryPrivate: payload.repository.private,
    repositoryDefaultBranch: payload.repository.default_branch,
    pullRequestNumber: pullRequest.number,
    baseRef: pullRequest.base.ref,
    baseSha: pullRequest.base.sha,
    headRef: pullRequest.head.ref,
    headSha: pullRequest.head.sha,
    action,
  };
}

export async function admitGitHubWebhookDelivery(
  delivery: GitHubWebhookDelivery,
  database: Database = db,
): Promise<GitHubWebhookAdmission> {
  const action = deliveryAction(delivery);
  const metadata = pullRequestMetadata(delivery);

  if (!metadata) {
    return ignoredDelivery({
      event: delivery.name,
      action,
      deliveryId: delivery.deliveryId,
      reason: "event_not_admitted",
    });
  }

  return database.transaction(async (transaction) => {
    const claimed = await claimDelivery(transaction, metadata);
    if (!claimed) {
      return getDuplicateAdmission(transaction, delivery);
    }

    const [installation] = await transaction
      .select()
      .from(githubInstallation)
      .where(eq(githubInstallation.installationId, metadata.installationId))
      .limit(1);

    if (!installation) {
      await markDeliveryIgnored(transaction, metadata.deliveryId, "installation_not_linked");
      return ignoredDelivery({
        event: delivery.name,
        action,
        deliveryId: delivery.deliveryId,
        reason: "installation_not_linked",
      });
    }

    // The Coder app is subscribed to pull_request events too, so its installation
    // delivers the same opened/synchronize events to this channel with a distinct
    // delivery id. Only the reviewer app's installation triggers a review run;
    // admitting the Coder app's copy would double-review every pull request.
    if (resolveGitHubAppWorkerRole(installation.appSlug) === IMPLEMENTATION_WORKER_ROLE) {
      await markDeliveryIgnored(transaction, metadata.deliveryId, "installation_app_not_reviewer");
      return ignoredDelivery({
        event: delivery.name,
        action,
        deliveryId: delivery.deliveryId,
        reason: "installation_app_not_reviewer",
      });
    }

    if (installation.status !== "connected") {
      await markDeliveryIgnored(transaction, metadata.deliveryId, "installation_not_connected");
      return ignoredDelivery({
        event: delivery.name,
        action,
        deliveryId: delivery.deliveryId,
        reason: "installation_not_connected",
      });
    }

    if (!installation.installedByUserId) {
      await markDeliveryIgnored(transaction, metadata.deliveryId, "installation_missing_actor");
      return ignoredDelivery({
        event: delivery.name,
        action,
        deliveryId: delivery.deliveryId,
        reason: "installation_missing_actor",
      });
    }

    const repository = await resolveRepository({
      database: transaction,
      installationRecordId: installation.id,
      repositorySelection: installation.repositorySelection,
      metadata,
    });

    if (!repository) {
      await markDeliveryIgnored(transaction, metadata.deliveryId, "repository_not_linked");
      return ignoredDelivery({
        event: delivery.name,
        action,
        deliveryId: delivery.deliveryId,
        reason: "repository_not_linked",
      });
    }

    const providerCredential = await getConnectedOpenAICodexCredential(
      transaction,
      installation.organizationId,
    );
    const agentRunId = crypto.randomUUID();
    const runPlan = planGitHubPullRequestRun();

    await transaction.insert(agentRun).values({
      id: agentRunId,
      organizationId: installation.organizationId,
      userId: installation.installedByUserId,
      providerCredentialId: providerCredential?.id ?? null,
      coworkerSlug: runPlan.legacyCoworkerSlug,
      workerRole: runPlan.workerRole,
      workerDisplayName: runPlan.workerDisplayName,
      runType: runPlan.runType,
      sourceProvider: "github",
      sourceDeliveryId: metadata.deliveryId,
      repositoryOwner: metadata.repositoryOwner,
      repositoryName: metadata.repositoryName,
      repositoryUrl: metadata.repositoryUrl,
      branch: metadata.headRef,
      baseBranch: metadata.baseRef,
      githubInstallationId: installation.id,
      githubRepositoryId: repository.id,
      pullRequestNumber: metadata.pullRequestNumber,
      pullRequestBaseRef: metadata.baseRef,
      pullRequestBaseSha: metadata.baseSha,
      pullRequestHeadRef: metadata.headRef,
      pullRequestHeadSha: metadata.headSha,
      status: "queued",
      currentStage: "queued",
      lastHeartbeatAt: new Date(),
    });

    await transaction.insert(agentRunEvent).values({
      id: crypto.randomUUID(),
      runId: agentRunId,
      sequence: 1,
      category: "github",
      type: "github.webhook.accepted",
      stage: "webhook_admitted",
      message: `Accepted pull_request.${metadata.action} from GitHub`,
      payloadJson: JSON.stringify({
        deliveryId: metadata.deliveryId,
        action: metadata.action,
        repositoryFullName: metadata.repositoryFullName,
        pullRequestNumber: metadata.pullRequestNumber,
      }),
    });
    await transaction.insert(agentRunEvent).values({
      id: crypto.randomUUID(),
      runId: agentRunId,
      sequence: 2,
      category: "queue",
      type: "queue.created",
      stage: "queued",
      message: "Queued code review worker run",
      payloadJson: JSON.stringify({
        workerRole: runPlan.workerRole,
        workerDisplayName: runPlan.workerDisplayName,
        runType: runPlan.runType,
      }),
    });

    await transaction
      .update(githubWebhookDelivery)
      .set({
        status: "accepted",
        agentRunId,
        updatedAt: new Date(),
      })
      .where(eq(githubWebhookDelivery.id, metadata.deliveryId));

    return {
      ok: true,
      accepted: true,
      duplicate: false,
      event: delivery.name,
      action,
      deliveryId: delivery.deliveryId,
      agentRunId,
    };
  });
}

export function createGitHubWebhookChannel(
  options: GitHubWebhookChannelOptions = {},
): GitHubChannel<BlankEnv> | null {
  const webhookSecret = options.webhookSecret ?? env.GITHUB_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return null;
  }

  const database = options.database ?? db;

  return createGitHubChannel<BlankEnv>({
    webhookSecret,
    async webhook({ delivery }) {
      return acceptedJsonResponse(await admitGitHubWebhookDelivery(delivery, database));
    },
  });
}
