import { db } from "@hosted-agents/db";
import {
  githubInstallation,
  githubRepository,
  githubWebhookDelivery,
} from "@hosted-agents/db/schema/github";
import { agentProviderCredential } from "@hosted-agents/db/schema/provider-credentials";
import { reviewRun } from "@hosted-agents/db/schema/reviews";
import { env } from "@hosted-agents/env/server";
import { createGitHubChannel, type GitHubChannel, type GitHubWebhookDelivery } from "@flue/github";
import { and, desc, eq } from "drizzle-orm";
import type { BlankEnv } from "hono/types";

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
      reviewRunId: githubWebhookDelivery.reviewRunId,
      status: githubWebhookDelivery.status,
    })
    .from(githubWebhookDelivery)
    .where(eq(githubWebhookDelivery.id, delivery.deliveryId))
    .limit(1);

  if (!claimed || (claimed.status === "claimed" && !claimed.reviewRunId)) {
    throw new Error("GitHub delivery claim is incomplete; retry delivery.");
  }
  return {
    ok: true,
    accepted: false,
    duplicate: true,
    event: delivery.name,
    action: deliveryAction(delivery),
    deliveryId: delivery.deliveryId,
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
    const reviewRunId = crypto.randomUUID();

    await transaction.insert(reviewRun).values({
      id: reviewRunId,
      organizationId: installation.organizationId,
      userId: installation.installedByUserId,
      providerCredentialId: providerCredential?.id ?? null,
      agentName: "abu-bakr-code-review",
      repositoryProvider: "github",
      repositoryOwner: metadata.repositoryOwner,
      repositoryName: metadata.repositoryName,
      repositoryUrl: metadata.repositoryUrl,
      branch: metadata.headRef,
      baseBranch: metadata.baseRef,
      reviewContext: null,
      githubDeliveryId: metadata.deliveryId,
      githubInstallationId: installation.id,
      githubRepositoryId: repository.id,
      pullRequestNumber: metadata.pullRequestNumber,
      pullRequestBaseRef: metadata.baseRef,
      pullRequestBaseSha: metadata.baseSha,
      pullRequestHeadRef: metadata.headRef,
      pullRequestHeadSha: metadata.headSha,
      status: "queued",
    });

    await transaction
      .update(githubWebhookDelivery)
      .set({
        status: "accepted",
        reviewRunId,
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
      reviewRunId,
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
