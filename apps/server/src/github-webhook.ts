import {
  createGitHubInstallationAccessToken,
  resolveGitHubAppWorkerRole,
} from "@hosted-agents/api/github-app";
import {
  BABYSIT_ROUND_CAP,
  BABYSIT_STOP_HUMAN,
  decideBabysitReview,
  findCoderClaimedIssueByRepositoryName,
  hasActiveBabysitRun,
  recordBabysitRoundEnqueued,
  recordBabysitStopped,
} from "@hosted-agents/api/issues/babysit";
import {
  deleteSyncedIssueComment,
  upsertSyncedIssue,
  upsertSyncedIssueComment,
} from "@hosted-agents/api/issues/sync";
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

import { parseCoderIssueBranch } from "./runners/coder-branch";
import { defaultImplementationGitHubClient } from "./runners/github-implementation-tools";
import { planGitHubIssueImplementationRun, planGitHubPullRequestRun } from "./github-run-planner";

const OPENAI_CODEX_PROVIDER = "openai-codex";
const ADMITTED_PULL_REQUEST_ACTIONS: Record<string, true> = {
  opened: true,
  reopened: true,
  synchronize: true,
  ready_for_review: true,
};

type Database = typeof db;
type AdmissionDatabase = Pick<Database, "insert" | "select" | "update">;

// Posts the Coder's explanation comment when a babysit run is not enqueued (the
// round cap is reached). Injected so the admission stays pure/DB-only under test —
// the default mints the Coder installation token and posts via the Coder App, so
// the comment is attributed to the Coder (ADR-0001); a test supplies a fake that
// records the call instead of touching GitHub.
export type PostCoderIssueComment = (input: {
  installationId: string;
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
}) => Promise<void>;

export type GitHubWebhookAdmissionDeps = {
  postCoderIssueComment?: PostCoderIssueComment;
};

type GitHubWebhookChannelOptions = {
  database?: Database;
  webhookSecret?: string;
  deps?: GitHubWebhookAdmissionDeps;
};

// Default Coder-comment poster: mint the Coder App's installation token and post
// the comment as the Coder. Best-effort — a failed comment must not roll back the
// blocked state the admission already committed.
async function defaultPostCoderIssueComment(input: {
  installationId: string;
  owner: string;
  repo: string;
  issueNumber: number;
  body: string;
}): Promise<void> {
  const token = await createGitHubInstallationAccessToken(
    input.installationId,
    IMPLEMENTATION_WORKER_ROLE,
  );
  const client = defaultImplementationGitHubClient(token);
  await client.rest.issues.createComment({
    owner: input.owner,
    repo: input.repo,
    issue_number: input.issueNumber,
    body: input.body,
  });
}

// The repository fields both the pull-request and issue-sync paths need to resolve
// (or lazily create) the linked `github_repository` record. Shared so
// `resolveRepository` serves both event families.
type RepositoryDescriptor = {
  repositoryId: string;
  repositoryOwner: string;
  repositoryName: string;
  repositoryFullName: string;
  repositoryUrl: string | null;
  repositoryPrivate: boolean;
  repositoryDefaultBranch: string | null;
};

type PullRequestAdmissionMetadata = RepositoryDescriptor & {
  deliveryId: string;
  installationId: string;
  pullRequestNumber: number;
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
  action: string;
  // `sender.type` on the delivery: "User" for a human, "Bot" for the Coder/Reviewer
  // app. A human `synchronize` (a push to a Coder-owned PR) yields babysitting;
  // null when absent so the yield only fires on an explicit human sender.
  senderType: string | null;
};

// The fields the babysit admission (C6) reads off a `pull_request_review.submitted`
// delivery: which pull request the review is on (number + head/base refs), the
// review's state + author kind, and who delivered it.
type PullRequestReviewAdmissionMetadata = RepositoryDescriptor & {
  deliveryId: string;
  installationId: string;
  action: string;
  pullRequestNumber: number;
  headRef: string;
  baseRef: string;
  reviewState: string;
  // `sender.type` on the delivery: "User" for a human, "Bot" for the Reviewer or
  // Coder GitHub App. Humans always win, so this is what gates the yield.
  senderType: string;
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
  issueNumber?: number;
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

type DeliveryClaim = {
  deliveryId: string;
  event: string;
  action?: string;
  installationId: string;
  repositoryFullName: string;
  pullRequestNumber?: number | null;
};

// Insert the delivery-ledger row that makes admission exactly-once: the first
// writer wins the unique delivery id, a redelivery conflicts and is treated as a
// duplicate. Shared by the pull-request and issue-sync paths.
async function claimDelivery(database: AdmissionDatabase, claim: DeliveryClaim) {
  const rows = await database
    .insert(githubWebhookDelivery)
    .values({
      id: claim.deliveryId,
      event: claim.event,
      action: claim.action,
      installationId: claim.installationId,
      repositoryFullName: claim.repositoryFullName,
      pullRequestNumber: claim.pullRequestNumber ?? null,
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
  descriptor,
}: {
  database: AdmissionDatabase;
  installationRecordId: string;
  repositorySelection: string | null;
  descriptor: RepositoryDescriptor;
}) {
  const [existing] = await database
    .select()
    .from(githubRepository)
    .where(
      and(
        eq(githubRepository.installationId, installationRecordId),
        eq(githubRepository.githubRepositoryId, descriptor.repositoryId),
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
    githubRepositoryId: descriptor.repositoryId,
    owner: descriptor.repositoryOwner,
    name: descriptor.repositoryName,
    fullName: descriptor.repositoryFullName,
    htmlUrl: descriptor.repositoryUrl,
    defaultBranch: descriptor.repositoryDefaultBranch,
    private: descriptor.repositoryPrivate,
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
  const sender = payload.sender as { type?: unknown } | null | undefined;

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
    senderType: typeof sender?.type === "string" ? sender.type : null,
  };
}

// The webhook channel is one HMAC-verified ingress for several event families.
// This dispatcher routes each verified delivery to the transport that owns it:
// pull requests queue a review run (or, on a human push, yield babysitting),
// pull-request reviews drive the babysit loop, a human pull-request comment yields
// babysitting (humans always win), issues and issue comments sync into the board
// store, and everything else is acknowledged without side effects.
export async function admitGitHubWebhookDelivery(
  delivery: GitHubWebhookDelivery,
  database: Database = db,
  deps: GitHubWebhookAdmissionDeps = {},
): Promise<GitHubWebhookAdmission> {
  const action = deliveryAction(delivery);

  const pullRequest = pullRequestMetadata(delivery);
  if (pullRequest) {
    return admitPullRequestDelivery(delivery, database, pullRequest, action);
  }

  const pullRequestReview = pullRequestReviewMetadata(delivery);
  if (pullRequestReview) {
    return admitPullRequestReviewDelivery(delivery, database, pullRequestReview, action, deps);
  }

  const pullRequestComment = pullRequestCommentMetadata(delivery);
  if (pullRequestComment) {
    return admitPullRequestCommentDelivery(delivery, database, pullRequestComment, action);
  }

  const issueSync = issueSyncMetadata(delivery);
  if (issueSync) {
    if (!issueSync.admit) {
      return ignoredDelivery({
        event: delivery.name,
        action,
        deliveryId: delivery.deliveryId,
        reason: issueSync.reason,
      });
    }
    return admitIssueSyncDelivery(delivery, database, issueSync.metadata, action);
  }

  return ignoredDelivery({
    event: delivery.name,
    action,
    deliveryId: delivery.deliveryId,
    reason: "event_not_admitted",
  });
}

async function admitPullRequestDelivery(
  delivery: GitHubWebhookDelivery,
  database: Database,
  metadata: PullRequestAdmissionMetadata,
  action: string | undefined,
): Promise<GitHubWebhookAdmission> {
  return database.transaction(async (transaction) => {
    const claimed = await claimDelivery(transaction, {
      deliveryId: metadata.deliveryId,
      event: "pull_request",
      action: metadata.action,
      installationId: metadata.installationId,
      repositoryFullName: metadata.repositoryFullName,
      pullRequestNumber: metadata.pullRequestNumber,
    });
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
      descriptor: metadata,
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

    // Humans always win (spec #21 story 8): a human push to a Coder-owned PR ends
    // babysitting. Without this, a human `synchronize` queues a Reviewer run whose
    // eventual `changes_requested` — a Bot review — dispatches the Coder onto the
    // human's branch. Recording the stop here makes that later review a no-op
    // (`babysit_already_stopped`) AND skips this re-review, so the whole loop backs
    // off. A Bot `synchronize` (the Coder's own fix push) is the intended re-review
    // trigger and falls through untouched. The claim lives on the Coder app's repo
    // row, not this Reviewer installation's, so it is matched across installations.
    if (metadata.senderType === "User") {
      const claim = await findCoderClaimedIssueByRepositoryName(transaction, {
        organizationId: installation.organizationId,
        repositoryFullName: metadata.repositoryFullName,
        pullRequestNumber: metadata.pullRequestNumber,
        branchIssueNumber: parseCoderIssueBranch(metadata.headRef),
      });
      if (claim) {
        if (claim.babysitBlockedReason == null) {
          await recordBabysitStopped(transaction, {
            issueId: claim.issueId,
            reason: BABYSIT_STOP_HUMAN,
          });
        }
        await transaction
          .update(githubWebhookDelivery)
          .set({ status: `yielded:${BABYSIT_STOP_HUMAN}`, updatedAt: new Date() })
          .where(eq(githubWebhookDelivery.id, metadata.deliveryId));
        return {
          ok: true,
          accepted: false,
          duplicate: false,
          event: delivery.name,
          action,
          deliveryId: delivery.deliveryId,
          issueNumber: claim.number,
          reason: BABYSIT_STOP_HUMAN,
        };
      }
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

// Parse a `pull_request_review` delivery into the fields the babysit admission
// needs. Only a `submitted` review drives the loop; `edited` / `dismissed`
// reviews return null and fall through to event_not_admitted (acknowledged, no
// side effect).
function pullRequestReviewMetadata(
  delivery: GitHubWebhookDelivery,
): PullRequestReviewAdmissionMetadata | null {
  if (delivery.name !== "pull_request_review") {
    return null;
  }

  const { payload } = delivery;
  if (payload.action !== "submitted") {
    return null;
  }

  const installationId = payload.installation?.id;
  const pullRequest = payload.pull_request;
  const review = payload.review;
  const sender = payload.sender;
  const repository = parseRepositoryDescriptor(payload.repository);

  if (
    typeof installationId !== "number" ||
    !repository ||
    !pullRequest ||
    typeof pullRequest.number !== "number" ||
    typeof pullRequest.head?.ref !== "string" ||
    typeof pullRequest.base?.ref !== "string" ||
    !review ||
    typeof review.state !== "string" ||
    typeof sender?.type !== "string"
  ) {
    return null;
  }

  return {
    ...repository,
    deliveryId: delivery.deliveryId,
    installationId: String(installationId),
    action: payload.action,
    pullRequestNumber: pullRequest.number,
    headRef: pullRequest.head.ref,
    baseRef: pullRequest.base.ref,
    reviewState: review.state,
    senderType: sender.type,
  };
}

// The transaction's outcome. `admission` is what the caller returns to GitHub;
// `blockedComment`, when present (the round cap was crossed), is posted as the
// Coder AFTER the transaction commits so a comment failure never rolls back the
// blocked state.
type ReviewAdmissionOutcome = {
  admission: GitHubWebhookAdmission;
  blockedComment?: {
    installationId: string;
    owner: string;
    repo: string;
    issueNumber: number;
    body: string;
  };
};

// The babysit admission (spec #21 stories 7–9, C6). A `changes_requested` review
// by the Reviewer on a Coder-owned pull request wakes the Coder for one fix round
// on the same branch, up to a hard cap; at the cap the issue is parked Failed /
// Blocked with an explanation comment. A human review yields immediately (humans
// always win — see also the human-push yield in `admitPullRequestDelivery` and the
// human-comment yield in `admitPullRequestCommentDelivery`). An `approved` review
// is the approval path C7 owns — a deliberate no-op here.
async function admitPullRequestReviewDelivery(
  delivery: GitHubWebhookDelivery,
  database: Database,
  metadata: PullRequestReviewAdmissionMetadata,
  action: string | undefined,
  deps: GitHubWebhookAdmissionDeps,
): Promise<GitHubWebhookAdmission> {
  const outcome = await database.transaction<ReviewAdmissionOutcome>(async (transaction) => {
    const claimed = await claimDelivery(transaction, {
      deliveryId: metadata.deliveryId,
      event: "pull_request_review",
      action: metadata.action,
      installationId: metadata.installationId,
      repositoryFullName: metadata.repositoryFullName,
      pullRequestNumber: metadata.pullRequestNumber,
    });
    if (!claimed) {
      return { admission: await getDuplicateAdmission(transaction, delivery) };
    }

    const ignore = async (reason: string): Promise<ReviewAdmissionOutcome> => {
      await markDeliveryIgnored(transaction, metadata.deliveryId, reason);
      return {
        admission: ignoredDelivery({
          event: delivery.name,
          action,
          deliveryId: delivery.deliveryId,
          reason,
        }),
      };
    };

    const [installation] = await transaction
      .select()
      .from(githubInstallation)
      .where(eq(githubInstallation.installationId, metadata.installationId))
      .limit(1);

    if (!installation) {
      return ignore("installation_not_linked");
    }

    // Coder-app-only guard, the mirror of the reviewer-only guard on the PR path.
    // Both the Reviewer and Coder apps receive pull_request_review deliveries with
    // distinct delivery ids; admitting only the Coder app's copy de-dups the two
    // and yields the Coder installation the fix run needs to push. C7 will add the
    // approval-merge branch behind this same guard.
    if (resolveGitHubAppWorkerRole(installation.appSlug) !== IMPLEMENTATION_WORKER_ROLE) {
      return ignore("installation_app_not_coder");
    }

    if (installation.status !== "connected") {
      return ignore("installation_not_connected");
    }
    if (!installation.installedByUserId) {
      return ignore("installation_missing_actor");
    }

    const repository = await resolveRepository({
      database: transaction,
      installationRecordId: installation.id,
      repositorySelection: installation.repositorySelection,
      descriptor: metadata,
    });
    if (!repository) {
      return ignore("repository_not_linked");
    }

    // Match the review to the Coder-claimed issue whose PR it is — by the linked-PR
    // stamp or by the `coder/issue-<n>-*` branch name. Scoped by (org, repo full
    // name), never by this Coder installation's repo-row id: the claim is stamped on
    // whichever repo row the board project is linked through (possibly the Reviewer
    // app's), which need not be the row this review resolved under, so a repo-row-id
    // lookup would silently drop every review (`no_matching_coder_issue`) and the
    // whole loop would go inert. The human push/comment yields already scope this way.
    // A review on any other PR (a human's branch, an unclaimed issue) matches nothing
    // and is not babysat.
    const branchIssueNumber = parseCoderIssueBranch(metadata.headRef);
    const claim = await findCoderClaimedIssueByRepositoryName(transaction, {
      organizationId: installation.organizationId,
      repositoryFullName: metadata.repositoryFullName,
      pullRequestNumber: metadata.pullRequestNumber,
      branchIssueNumber,
    });
    if (!claim) {
      return ignore("no_matching_coder_issue");
    }

    const decision = decideBabysitReview({
      reviewState: metadata.reviewState,
      senderIsHuman: metadata.senderType === "User",
      babysitRound: claim.babysitRound,
      alreadyStopped: claim.babysitBlockedReason != null,
    });

    const acceptedNoRun = (reason: string): ReviewAdmissionOutcome => ({
      admission: {
        ok: true,
        accepted: false,
        duplicate: false,
        event: delivery.name,
        action,
        deliveryId: delivery.deliveryId,
        issueNumber: claim.number,
        reason,
      },
    });

    if (decision.action === "noop") {
      // Approval (C7's job), an already-stopped PR, or a non-actionable review
      // state — recognized, no side effect.
      return ignore(decision.reason);
    }

    if (decision.action === "yield") {
      // Humans always win: record the stop so the Coder never resumes, no run.
      await recordBabysitStopped(transaction, {
        issueId: claim.issueId,
        reason: decision.reason,
      });
      await transaction
        .update(githubWebhookDelivery)
        .set({ status: `yielded:${decision.reason}`, updatedAt: new Date() })
        .where(eq(githubWebhookDelivery.id, metadata.deliveryId));
      return acceptedNoRun(decision.reason);
    }

    if (decision.action === "blocked") {
      // Round cap crossed: park the issue Failed / Blocked and post the Coder's
      // explanation comment (after commit). No fix run.
      await recordBabysitStopped(transaction, {
        issueId: claim.issueId,
        reason: decision.reason,
      });
      await transaction
        .update(githubWebhookDelivery)
        .set({ status: `blocked:${decision.reason}`, updatedAt: new Date() })
        .where(eq(githubWebhookDelivery.id, metadata.deliveryId));
      const body = [
        `<!-- worker-role:${IMPLEMENTATION_WORKER_ROLE} role:babysit-blocked issue:${claim.number} -->`,
        `The Coder reached its babysit round cap (${BABYSIT_ROUND_CAP} fix rounds) on pull request #${metadata.pullRequestNumber} without a clean review and has stopped. This issue now needs a human — moving it to Failed / Blocked.`,
      ].join("\n");
      return {
        admission: {
          ok: true,
          accepted: false,
          duplicate: false,
          event: delivery.name,
          action,
          deliveryId: delivery.deliveryId,
          issueNumber: claim.number,
          reason: decision.reason,
        },
        blockedComment: {
          installationId: installation.installationId,
          owner: metadata.repositoryOwner,
          repo: metadata.repositoryName,
          issueNumber: claim.number,
          body,
        },
      };
    }

    // decision.action === "babysit": enqueue exactly one fix run on the same branch.
    // Idempotency guard — a fix run already queued/running for this PR (a second
    // review before the last fix landed, or a redelivery with a fresh id) must not
    // stack a second run or double-spend a round.
    if (
      await hasActiveBabysitRun(transaction, {
        githubRepositoryId: repository.id,
        issueNumber: claim.number,
        pullRequestNumber: metadata.pullRequestNumber,
      })
    ) {
      await markDeliveryIgnored(transaction, metadata.deliveryId, "babysit_run_in_flight");
      return acceptedNoRun("babysit_run_in_flight");
    }

    const providerCredential = await getConnectedOpenAICodexCredential(
      transaction,
      installation.organizationId,
    );
    const runPlan = planGitHubIssueImplementationRun();
    const agentRunId = crypto.randomUUID();

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
      // The EXISTING Coder branch — the babysit runner resumes it (checks it out,
      // addresses the review, pushes) rather than cutting a new branch.
      branch: metadata.headRef,
      baseBranch: metadata.baseRef,
      issueNumber: claim.number,
      githubInstallationId: installation.id,
      githubRepositoryId: repository.id,
      pullRequestNumber: metadata.pullRequestNumber,
      pullRequestBaseRef: metadata.baseRef,
      pullRequestHeadRef: metadata.headRef,
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
      message: `Accepted pull_request_review.${metadata.action} from GitHub`,
      payloadJson: JSON.stringify({
        deliveryId: metadata.deliveryId,
        action: metadata.action,
        repositoryFullName: metadata.repositoryFullName,
        pullRequestNumber: metadata.pullRequestNumber,
        reviewState: metadata.reviewState,
        babysitRound: decision.round,
      }),
    });
    await transaction.insert(agentRunEvent).values({
      id: crypto.randomUUID(),
      runId: agentRunId,
      sequence: 2,
      category: "queue",
      type: "queue.created",
      stage: "queued",
      message: `Queued Coder babysit run (round ${decision.round})`,
      payloadJson: JSON.stringify({
        workerRole: runPlan.workerRole,
        workerDisplayName: runPlan.workerDisplayName,
        runType: runPlan.runType,
        babysitRound: decision.round,
        pullRequestNumber: metadata.pullRequestNumber,
        issueNumber: claim.number,
      }),
    });

    await recordBabysitRoundEnqueued(transaction, {
      issueId: claim.issueId,
      round: decision.round,
    });

    await transaction
      .update(githubWebhookDelivery)
      .set({ status: "accepted", agentRunId, updatedAt: new Date() })
      .where(eq(githubWebhookDelivery.id, metadata.deliveryId));

    return {
      admission: {
        ok: true,
        accepted: true,
        duplicate: false,
        event: delivery.name,
        action,
        deliveryId: delivery.deliveryId,
        agentRunId,
        issueNumber: claim.number,
      },
    };
  });

  if (outcome.blockedComment) {
    const postComment = deps.postCoderIssueComment ?? defaultPostCoderIssueComment;
    try {
      await postComment(outcome.blockedComment);
    } catch (error) {
      console.error("Failed to post Coder babysit round-cap comment", error);
    }
  }

  return outcome.admission;
}

// The fields the babysit human-comment yield reads off an `issue_comment`
// delivery. GitHub models a pull request as an issue, so a PR conversation comment
// arrives as `issue_comment` with `issue.pull_request` set; the PR number is the
// comment's issue number.
type PullRequestCommentAdmissionMetadata = {
  deliveryId: string;
  action: string;
  installationId: string;
  repositoryFullName: string;
  pullRequestNumber: number;
};

// Parse an `issue_comment` delivery into the human-comment yield fields — but ONLY
// for a human comment on a pull request. A bot comment (the Coder's own progress /
// blocked note, a Reviewer's comment) or a comment on a real issue returns null and
// falls through untouched: bot PR comments to the issue-sync skip
// (`pull_request_shaped`), human/bot issue comments to the board sync. Only
// `created` / `edited` (a human authoring content) count; `deleted` is not a
// takeover signal.
function pullRequestCommentMetadata(
  delivery: GitHubWebhookDelivery,
): PullRequestCommentAdmissionMetadata | null {
  if (delivery.name !== "issue_comment") {
    return null;
  }
  const { payload } = delivery;
  if (payload.action !== "created" && payload.action !== "edited") {
    return null;
  }
  // Humans always win — only a human comment yields; bot comments are the loop's
  // own chatter and must not stop it.
  if (payload.sender?.type !== "User") {
    return null;
  }
  const installationId = payload.installation?.id;
  const issue = payload.issue;
  if (
    typeof installationId !== "number" ||
    !issue ||
    typeof issue.number !== "number" ||
    issue.pull_request == null
  ) {
    return null;
  }
  const repository = parseRepositoryDescriptor(payload.repository);
  if (!repository) {
    return null;
  }
  return {
    deliveryId: delivery.deliveryId,
    action: payload.action,
    installationId: String(installationId),
    repositoryFullName: repository.repositoryFullName,
    pullRequestNumber: issue.number,
  };
}

// The babysit human-comment yield (spec #21 story 8). A human commenting on a
// Coder-owned pull request ends babysitting: humans always win. Like the human
// push yield, the claim lives on the Coder app's repository row, not necessarily
// the installation that delivered this comment, so it is matched across
// installations by (org, repo full name, PR number). A comment on any other PR is
// off the issues board and is skipped exactly like the issue-sync path
// (`pull_request_shaped`) — no delivery-ledger row, no side effect.
async function admitPullRequestCommentDelivery(
  delivery: GitHubWebhookDelivery,
  database: Database,
  metadata: PullRequestCommentAdmissionMetadata,
  action: string | undefined,
): Promise<GitHubWebhookAdmission> {
  const pullRequestShaped = (): GitHubWebhookAdmission =>
    ignoredDelivery({
      event: delivery.name,
      action,
      deliveryId: delivery.deliveryId,
      reason: "pull_request_shaped",
    });

  // Resolve the installation (read-only) to get the org the claim is scoped to. An
  // unlinked or disconnected installation cannot own a Coder claim, so its PR
  // comments are off-board like any other.
  const [installation] = await database
    .select()
    .from(githubInstallation)
    .where(eq(githubInstallation.installationId, metadata.installationId))
    .limit(1);
  if (!installation || installation.status !== "connected") {
    return pullRequestShaped();
  }

  const preCheck = await findCoderClaimedIssueByRepositoryName(database, {
    organizationId: installation.organizationId,
    repositoryFullName: metadata.repositoryFullName,
    pullRequestNumber: metadata.pullRequestNumber,
    branchIssueNumber: null,
  });
  if (!preCheck) {
    // Not a Coder-owned PR: match the issue-sync skip exactly — no ledger row.
    return pullRequestShaped();
  }

  // A human commented on a Coder-owned PR — record the stop transactionally, deduped
  // by the delivery ledger so a redelivery (or the second app's copy) is a no-op.
  return database.transaction(async (transaction) => {
    const claimed = await claimDelivery(transaction, {
      deliveryId: metadata.deliveryId,
      event: "issue_comment",
      action: metadata.action,
      installationId: metadata.installationId,
      repositoryFullName: metadata.repositoryFullName,
      pullRequestNumber: metadata.pullRequestNumber,
    });
    if (!claimed) {
      return getDuplicateAdmission(transaction, delivery);
    }

    // Re-read inside the transaction so a concurrent yield (another human event on
    // the same PR) is not clobbered, and an already-stopped PR is a clean no-op.
    const claim = await findCoderClaimedIssueByRepositoryName(transaction, {
      organizationId: installation.organizationId,
      repositoryFullName: metadata.repositoryFullName,
      pullRequestNumber: metadata.pullRequestNumber,
      branchIssueNumber: null,
    });
    if (!claim) {
      await markDeliveryIgnored(transaction, metadata.deliveryId, "pull_request_shaped");
      return pullRequestShaped();
    }
    if (claim.babysitBlockedReason != null) {
      await markDeliveryIgnored(transaction, metadata.deliveryId, "babysit_already_stopped");
      return {
        ok: true,
        accepted: false,
        duplicate: false,
        event: delivery.name,
        action,
        deliveryId: delivery.deliveryId,
        issueNumber: claim.number,
        reason: "babysit_already_stopped",
      };
    }

    await recordBabysitStopped(transaction, {
      issueId: claim.issueId,
      reason: BABYSIT_STOP_HUMAN,
    });
    await transaction
      .update(githubWebhookDelivery)
      .set({ status: `yielded:${BABYSIT_STOP_HUMAN}`, updatedAt: new Date() })
      .where(eq(githubWebhookDelivery.id, metadata.deliveryId));
    return {
      ok: true,
      accepted: false,
      duplicate: false,
      event: delivery.name,
      action,
      deliveryId: delivery.deliveryId,
      issueNumber: claim.number,
      reason: BABYSIT_STOP_HUMAN,
    };
  });
}

// GitHub-sourced issue fields, parsed off the payload. Mirrors the columns
// upsertSyncedIssue writes; the transport parses, the module persists.
type SyncedIssueFields = {
  number: number;
  githubIssueId: string | null;
  nodeId: string | null;
  title: string;
  body: string | null;
  state: "open" | "closed";
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  labels: string[];
  htmlUrl: string | null;
  commentCount: number;
  githubCreatedAt: Date | null;
  githubUpdatedAt: Date | null;
};

type SyncedCommentFields = {
  issueNumber: number;
  githubCommentId: string;
  authorLogin: string | null;
  authorAvatarUrl: string | null;
  body: string;
  htmlUrl: string | null;
  githubCreatedAt: Date | null;
  githubUpdatedAt: Date | null;
};

type IssueSyncMetadata =
  | {
      kind: "issue";
      event: "issues";
      deliveryId: string;
      action: string;
      installationId: string;
      repository: RepositoryDescriptor;
      issueNumber: number;
      issue: SyncedIssueFields;
    }
  | {
      kind: "comment";
      event: "issue_comment";
      deliveryId: string;
      action: string;
      installationId: string;
      repository: RepositoryDescriptor;
      issueNumber: number;
      comment: SyncedCommentFields;
    };

// null → not an issue/comment event we sync (dispatcher falls through to
// event_not_admitted). `{ admit: false }` → a recognized delivery we deliberately
// skip (a pull-request-shaped payload; the board is issues-only).
type IssueSyncAdmission =
  | { admit: true; metadata: IssueSyncMetadata }
  | { admit: false; reason: string };

function parseGitHubDate(value: unknown): Date | null {
  if (typeof value !== "string") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function issueLabelNames(labels: unknown): string[] {
  if (!Array.isArray(labels)) {
    return [];
  }
  return labels
    .map((label) => {
      if (typeof label === "string") {
        return label;
      }
      if (label && typeof label === "object") {
        const name = (label as { name?: unknown }).name;
        return typeof name === "string" ? name : null;
      }
      return null;
    })
    .filter((name): name is string => Boolean(name));
}

function parseRepositoryDescriptor(repository: unknown): RepositoryDescriptor | null {
  if (!repository || typeof repository !== "object") {
    return null;
  }
  const repo = repository as Record<string, unknown>;
  const repositoryId = repo.id;
  const repositoryFullName = repo.full_name;
  const repositoryName = repo.name;
  const owner = repo.owner as { login?: unknown } | null | undefined;
  const repositoryOwner =
    (owner && typeof owner.login === "string" && owner.login) ||
    (typeof repositoryFullName === "string" ? repositoryFullName.split("/")[0] : undefined);

  if (
    typeof repositoryId !== "number" ||
    typeof repositoryFullName !== "string" ||
    repositoryFullName.length === 0 ||
    typeof repositoryName !== "string" ||
    repositoryName.length === 0 ||
    typeof repositoryOwner !== "string" ||
    repositoryOwner.length === 0
  ) {
    return null;
  }

  return {
    repositoryId: String(repositoryId),
    repositoryOwner,
    repositoryName,
    repositoryFullName,
    repositoryUrl: typeof repo.html_url === "string" ? repo.html_url : null,
    repositoryPrivate: Boolean(repo.private),
    repositoryDefaultBranch: typeof repo.default_branch === "string" ? repo.default_branch : null,
  };
}

function mapIssueFields(issue: {
  number: number;
  id?: number | null;
  node_id?: string | null;
  title?: string | null;
  body?: string | null;
  state?: string | null;
  html_url?: string | null;
  comments?: number | null;
  created_at?: string | null;
  updated_at?: string | null;
  user?: { login?: string | null; avatar_url?: string | null } | null;
  labels?: unknown;
}): SyncedIssueFields {
  return {
    number: issue.number,
    githubIssueId: issue.id != null ? String(issue.id) : null,
    nodeId: typeof issue.node_id === "string" ? issue.node_id : null,
    title: typeof issue.title === "string" && issue.title ? issue.title : `Issue #${issue.number}`,
    body: typeof issue.body === "string" ? issue.body : null,
    state: issue.state === "closed" ? "closed" : "open",
    authorLogin: issue.user?.login ?? null,
    authorAvatarUrl: issue.user?.avatar_url ?? null,
    labels: issueLabelNames(issue.labels),
    htmlUrl: typeof issue.html_url === "string" ? issue.html_url : null,
    commentCount: typeof issue.comments === "number" ? issue.comments : 0,
    githubCreatedAt: parseGitHubDate(issue.created_at),
    githubUpdatedAt: parseGitHubDate(issue.updated_at),
  };
}

// Parse `issues.*` and `issue_comment.*` deliveries into the fields the store
// sync needs. A pull-request-shaped payload (a comment on a PR, or the defensive
// issue-with-pull_request case) is recognized and skipped so the issues board
// stays issues-only. Any action is admitted: every issue delivery carries the full
// issue object, so upserting on any of them keeps the synced row fresh.
function issueSyncMetadata(delivery: GitHubWebhookDelivery): IssueSyncAdmission | null {
  if (delivery.name === "issues") {
    const { payload } = delivery;
    const installationId = payload.installation?.id;
    const issue = payload.issue;

    if (typeof installationId !== "number" || !issue || typeof issue.number !== "number") {
      return null;
    }
    if (issue.pull_request != null) {
      return { admit: false, reason: "pull_request_shaped" };
    }

    const repository = parseRepositoryDescriptor(payload.repository);
    if (!repository) {
      return null;
    }

    return {
      admit: true,
      metadata: {
        kind: "issue",
        event: "issues",
        deliveryId: delivery.deliveryId,
        action: payload.action,
        installationId: String(installationId),
        repository,
        issueNumber: issue.number,
        issue: mapIssueFields(issue),
      },
    };
  }

  if (delivery.name === "issue_comment") {
    const { payload } = delivery;
    const installationId = payload.installation?.id;
    const issue = payload.issue;
    const comment = payload.comment;

    if (
      typeof installationId !== "number" ||
      !issue ||
      typeof issue.number !== "number" ||
      !comment ||
      typeof comment.id !== "number"
    ) {
      return null;
    }
    // A GitHub pull request is modeled as an issue, so PR comments arrive here too.
    // They belong to the review flow, not the board.
    if (issue.pull_request != null) {
      return { admit: false, reason: "pull_request_shaped" };
    }

    const repository = parseRepositoryDescriptor(payload.repository);
    if (!repository) {
      return null;
    }

    return {
      admit: true,
      metadata: {
        kind: "comment",
        event: "issue_comment",
        deliveryId: delivery.deliveryId,
        action: payload.action,
        installationId: String(installationId),
        repository,
        issueNumber: issue.number,
        comment: {
          issueNumber: issue.number,
          githubCommentId: String(comment.id),
          authorLogin: comment.user?.login ?? null,
          authorAvatarUrl: comment.user?.avatar_url ?? null,
          body: typeof comment.body === "string" ? comment.body : "",
          htmlUrl: typeof comment.html_url === "string" ? comment.html_url : null,
          githubCreatedAt: parseGitHubDate(comment.created_at),
          githubUpdatedAt: parseGitHubDate(comment.updated_at),
        },
      },
    };
  }

  return null;
}

async function admitIssueSyncDelivery(
  delivery: GitHubWebhookDelivery,
  database: Database,
  metadata: IssueSyncMetadata,
  action: string | undefined,
): Promise<GitHubWebhookAdmission> {
  return database.transaction(async (transaction) => {
    const claimed = await claimDelivery(transaction, {
      deliveryId: metadata.deliveryId,
      event: metadata.event,
      action: metadata.action,
      installationId: metadata.installationId,
      repositoryFullName: metadata.repository.repositoryFullName,
      pullRequestNumber: null,
    });
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

    // Unlike the review path, issue sync admits deliveries from any connected
    // installation (reviewer or Coder app). The upsert is idempotent and keyed by
    // (repository, number) / comment id, so a repo installed under both apps just
    // syncs the same row twice — no double side effect to guard against.
    const repository = await resolveRepository({
      database: transaction,
      installationRecordId: installation.id,
      repositorySelection: installation.repositorySelection,
      descriptor: metadata.repository,
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

    if (metadata.kind === "issue") {
      await upsertSyncedIssue(transaction, {
        organizationId: installation.organizationId,
        githubInstallationId: installation.id,
        githubRepositoryId: repository.id,
        repositoryFullName: metadata.repository.repositoryFullName,
        ...metadata.issue,
      });
    } else if (metadata.action === "deleted") {
      await deleteSyncedIssueComment(transaction, metadata.comment.githubCommentId);
    } else {
      await upsertSyncedIssueComment(transaction, {
        organizationId: installation.organizationId,
        githubRepositoryId: repository.id,
        ...metadata.comment,
      });
    }

    await transaction
      .update(githubWebhookDelivery)
      .set({ status: "accepted", updatedAt: new Date() })
      .where(eq(githubWebhookDelivery.id, metadata.deliveryId));

    return {
      ok: true,
      accepted: true,
      duplicate: false,
      event: delivery.name,
      action,
      deliveryId: delivery.deliveryId,
      issueNumber: metadata.issueNumber,
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
  const deps = options.deps ?? {};

  return createGitHubChannel<BlankEnv>({
    webhookSecret,
    async webhook({ delivery }) {
      return acceptedJsonResponse(await admitGitHubWebhookDelivery(delivery, database, deps));
    },
  });
}
