import type { RouterClient } from "@orpc/server";
import { ORPCError } from "@orpc/server";
import {
  loginOpenAICodexDeviceCode,
  type OAuthCredentials,
  type OAuthDeviceCodeInfo,
} from "@earendil-works/pi-ai/oauth";
import { db } from "@hosted-agents/db";
import {
  CODE_REVIEW_WORKER_DISPLAY_NAME,
  agentRun,
  agentRunArtifact,
  agentRunEvent,
} from "@hosted-agents/db/schema/agent-runs";
import {
  member,
  organization as authOrganization,
  session as authSession,
} from "@hosted-agents/db/schema/auth";
import { githubInstallation, githubRepository } from "@hosted-agents/db/schema/github";
import { agentProviderCredential } from "@hosted-agents/db/schema/provider-credentials";
import { reviewRun } from "@hosted-agents/db/schema/reviews";
import { env } from "@hosted-agents/env/server";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  claimGitHubInstallation,
  createGitHubAppInstallUrl,
  isGitHubAppConfigured,
  listAvailableGitHubInstallations,
} from "../github-app";
import { protectedProcedure, publicProcedure } from "../index";
import { encryptJsonCredential } from "../provider-credential-crypto";

const OPENAI_CODEX_PROVIDER = "openai-codex";

type PendingOpenAICodexConnectionStatus = "pending" | "connected" | "failed";

type PendingOpenAICodexConnection = {
  id: string;
  organizationId: string;
  userId: string;
  status: PendingOpenAICodexConnectionStatus;
  deviceCode?: OAuthDeviceCodeInfo;
  credentialId?: string;
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
};

const pendingOpenAICodexConnections = new Map<string, PendingOpenAICodexConnection>();

const createReviewRunInput = z.object({
  organizationId: z.string().optional(),
  repositoryUrl: z.string().url().optional().or(z.literal("")),
  repositoryOwner: z.string().optional(),
  repositoryName: z.string().optional(),
  branch: z.string().min(1),
  baseBranch: z.string().optional(),
  reviewContext: z.string().optional(),
});

const listReviewRunsInput = z
  .object({
    organizationId: z.string().optional(),
  })
  .optional();

const listAgentRunsInput = listReviewRunsInput;

const agentRunEventsInput = z.object({
  runId: z.string().min(1),
  organizationId: z.string().optional(),
});

const agentRunArtifactsInput = agentRunEventsInput;

const organizationScopedInput = z
  .object({
    organizationId: z.string().optional(),
  })
  .optional();

const createOrganizationInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Organization name is required.")
    .max(120)
    .transform((name) => name.trim().replace(/\s+/g, " ")),
});

const credentialConnectionInput = z.object({
  connectionId: z.string(),
});

const claimGitHubInstallationInput = z.object({
  installationId: z.string().regex(/^\d+$/, "GitHub installation id must be numeric."),
  organizationId: z.string().optional(),
  setupAction: z.string().optional(),
  state: z.string().optional(),
});

const revokeProviderCredentialInput = z.object({
  id: z.string(),
  organizationId: z.string().optional(),
});

type SessionWithActiveOrganization = {
  session?: {
    id?: string;
    activeOrganizationId?: string | null;
  };
};

type AgentRunScopedInput = z.infer<typeof agentRunEventsInput>;

function toIsoString(value: Date | null) {
  return value ? value.toISOString() : null;
}

function parseFindings(value: string | null) {
  if (!value) {
    return [];
  }

  try {
    return JSON.parse(value) as unknown[];
  } catch {
    return [];
  }
}

function parsePayload(value: string | null) {
  if (!value) {
    return null;
  }

  try {
    return JSON.parse(value) as unknown;
  } catch {
    return value;
  }
}

function mapReviewRun(row: typeof reviewRun.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    providerCredentialId: row.providerCredentialId,
    agentName: row.agentName,
    repositoryProvider: row.repositoryProvider,
    repositoryOwner: row.repositoryOwner,
    repositoryName: row.repositoryName,
    repositoryUrl: row.repositoryUrl,
    branch: row.branch,
    baseBranch: row.baseBranch,
    reviewContext: row.reviewContext,
    status: row.status,
    flueRunId: row.flueRunId,
    sandboxProvider: row.sandboxProvider,
    sandboxId: row.sandboxId,
    sandboxStartedAt: toIsoString(row.sandboxStartedAt),
    sandboxCompletedAt: toIsoString(row.sandboxCompletedAt),
    summary: row.summary,
    findings: parseFindings(row.findingsJson),
    artifacts: parseFindings(row.artifactsJson),
    executionLogs: row.executionLogs,
    errorMessage: row.errorMessage,
    startedAt: toIsoString(row.startedAt),
    completedAt: toIsoString(row.completedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapAgentRun(row: typeof agentRun.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    providerCredentialId: row.providerCredentialId,
    coworkerSlug: row.coworkerSlug,
    workerRole: row.workerRole,
    workerDisplayName: row.workerDisplayName ?? CODE_REVIEW_WORKER_DISPLAY_NAME,
    runType: row.runType,
    sourceProvider: row.sourceProvider,
    sourceDeliveryId: row.sourceDeliveryId,
    repositoryOwner: row.repositoryOwner,
    repositoryName: row.repositoryName,
    repositoryUrl: row.repositoryUrl,
    branch: row.branch,
    baseBranch: row.baseBranch,
    pullRequestNumber: row.pullRequestNumber,
    pullRequestBaseRef: row.pullRequestBaseRef,
    pullRequestBaseSha: row.pullRequestBaseSha,
    pullRequestHeadRef: row.pullRequestHeadRef,
    pullRequestHeadSha: row.pullRequestHeadSha,
    status: row.status,
    flueRunId: row.flueRunId,
    sandboxProvider: row.sandboxProvider,
    sandboxId: row.sandboxId,
    currentStage: row.currentStage,
    lastHeartbeatAt: toIsoString(row.lastHeartbeatAt),
    summary: row.summary,
    findings: parseFindings(row.findingsJson),
    errorMessage: row.errorMessage,
    startedAt: toIsoString(row.startedAt),
    completedAt: toIsoString(row.completedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapAgentRunEvent(row: typeof agentRunEvent.$inferSelect) {
  return {
    id: row.id,
    runId: row.runId,
    sequence: row.sequence,
    category: row.category,
    type: row.type,
    stage: row.stage,
    message: row.message,
    payload: parsePayload(row.payloadJson),
    flueEventIndex: row.flueEventIndex,
    flueEventType: row.flueEventType,
    createdAt: row.createdAt.toISOString(),
  };
}

function mapAgentRunArtifact(row: typeof agentRunArtifact.$inferSelect) {
  return {
    id: row.id,
    runId: row.runId,
    name: row.name,
    contentType: row.contentType,
    content: row.content,
    payload: parsePayload(row.payloadJson),
    createdAt: row.createdAt.toISOString(),
  };
}

function mapProviderCredential(row: typeof agentProviderCredential.$inferSelect) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    userId: row.userId,
    provider: row.provider,
    credentialType: row.credentialType,
    status: row.status,
    expiresAt: toIsoString(row.expiresAt),
    lastError: row.lastError,
    lastUsedAt: toIsoString(row.lastUsedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapGitHubInstallation(
  row: typeof githubInstallation.$inferSelect,
  repositories: (typeof githubRepository.$inferSelect)[],
) {
  return {
    id: row.id,
    organizationId: row.organizationId,
    installationId: row.installationId,
    appSlug: row.appSlug,
    accountId: row.accountId,
    accountLogin: row.accountLogin,
    accountType: row.accountType,
    repositorySelection: row.repositorySelection,
    status: row.status,
    setupAction: row.setupAction,
    installedByUserId: row.installedByUserId,
    suspendedAt: toIsoString(row.suspendedAt),
    repositoryCount: repositories.length,
    repositories: repositories.map((repository) => ({
      id: repository.id,
      githubRepositoryId: repository.githubRepositoryId,
      owner: repository.owner,
      name: repository.name,
      fullName: repository.fullName,
      htmlUrl: repository.htmlUrl,
      defaultBranch: repository.defaultBranch,
      private: repository.private,
      selected: repository.selected,
      createdAt: repository.createdAt.toISOString(),
      updatedAt: repository.updatedAt.toISOString(),
    })),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

type OrganizationMembershipRow = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

function mapOrganizationMembership(row: OrganizationMembershipRow) {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    role: row.role,
  };
}

function slugifyOrganizationName(name: string) {
  const slug = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48)
    .replace(/-+$/g, "");

  return slug || "organization";
}

async function isOrganizationSlugAvailable(slug: string) {
  const [existing] = await db
    .select({ id: authOrganization.id })
    .from(authOrganization)
    .where(eq(authOrganization.slug, slug))
    .limit(1);

  return !existing;
}

async function createUniqueOrganizationSlug(name: string) {
  const baseSlug = slugifyOrganizationName(name);

  if (await isOrganizationSlugAvailable(baseSlug)) {
    return baseSlug;
  }

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const candidate = `${baseSlug}-${crypto.randomUUID().slice(0, 8)}`;
    if (await isOrganizationSlugAvailable(candidate)) {
      return candidate;
    }
  }

  return `${baseSlug}-${crypto.randomUUID()}`;
}

function mapConnection(record: PendingOpenAICodexConnection) {
  return {
    id: record.id,
    organizationId: record.organizationId,
    status: record.status,
    deviceCode: record.deviceCode
      ? {
          userCode: record.deviceCode.userCode,
          verificationUri: record.deviceCode.verificationUri,
          intervalSeconds: record.deviceCode.intervalSeconds,
          expiresInSeconds: record.deviceCode.expiresInSeconds,
        }
      : null,
    credentialId: record.credentialId,
    errorMessage: record.errorMessage,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

async function getUserOrganizationIds(userId: string) {
  const rows = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, userId));

  return rows.map((row) => row.organizationId);
}

async function listUserOrganizations(userId: string) {
  return db
    .select({
      id: authOrganization.id,
      name: authOrganization.name,
      slug: authOrganization.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(authOrganization, eq(member.organizationId, authOrganization.id))
    .where(eq(member.userId, userId));
}

async function findUserOrganizationByName(userId: string, name: string) {
  const [row] = await db
    .select({
      id: authOrganization.id,
      name: authOrganization.name,
      slug: authOrganization.slug,
      role: member.role,
    })
    .from(member)
    .innerJoin(authOrganization, eq(member.organizationId, authOrganization.id))
    .where(and(eq(member.userId, userId), eq(authOrganization.name, name)))
    .limit(1);

  return row ?? null;
}

async function setActiveOrganizationId(
  contextSession: SessionWithActiveOrganization,
  organizationId: string,
) {
  const session = contextSession.session;

  if (!session?.id) {
    return;
  }

  await db
    .update(authSession)
    .set({
      activeOrganizationId: organizationId,
      updatedAt: new Date(),
    })
    .where(eq(authSession.id, session.id));

  session.activeOrganizationId = organizationId;
}

async function resolveActiveOrganization(
  contextSession: SessionWithActiveOrganization,
  organizations: OrganizationMembershipRow[],
) {
  if (organizations.length === 0) {
    return null;
  }

  const activeOrganizationId = contextSession.session?.activeOrganizationId;
  const activeOrganization = activeOrganizationId
    ? organizations.find((organization) => organization.id === activeOrganizationId)
    : null;

  if (activeOrganization) {
    return activeOrganization;
  }

  const fallbackOrganization = organizations[0]!;
  await setActiveOrganizationId(contextSession, fallbackOrganization.id);
  return fallbackOrganization;
}

async function resolveOrganizationId(userId: string, requestedId?: string) {
  const organizationIds = await getUserOrganizationIds(userId);

  if (requestedId) {
    if (!organizationIds.includes(requestedId)) {
      throw new ORPCError("FORBIDDEN");
    }
    return requestedId;
  }

  return organizationIds[0] ?? null;
}

async function getUserOrganizationMembership(userId: string, organizationId: string) {
  const [row] = await db
    .select()
    .from(member)
    .where(and(eq(member.userId, userId), eq(member.organizationId, organizationId)))
    .limit(1);

  return row ?? null;
}

async function assertCanReadAgentRun(userId: string, input: AgentRunScopedInput): Promise<void> {
  const organizationIds = await getUserOrganizationIds(userId);

  if (organizationIds.length === 0) {
    throw new ORPCError("FORBIDDEN");
  }

  const [run] = await db.select().from(agentRun).where(eq(agentRun.id, input.runId)).limit(1);

  if (!run) {
    throw new ORPCError("NOT_FOUND");
  }

  if (
    !organizationIds.includes(run.organizationId) ||
    (input.organizationId && input.organizationId !== run.organizationId)
  ) {
    throw new ORPCError("FORBIDDEN");
  }
}

async function assertCanManageOrganizationCredentials(userId: string, organizationId: string) {
  const membership = await getUserOrganizationMembership(userId, organizationId);

  if (!membership) {
    throw new ORPCError("FORBIDDEN");
  }

  if (!["owner", "admin"].includes(membership.role)) {
    throw new ORPCError("FORBIDDEN", {
      message: "Only organization owners and admins can manage provider credentials.",
    });
  }
}

async function getConnectedOpenAICodexCredential(organizationId: string) {
  const [row] = await db
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

async function saveOpenAICodexCredential({
  organizationId,
  userId,
  credentials,
}: {
  organizationId: string;
  userId: string;
  credentials: OAuthCredentials;
}) {
  await db
    .update(agentProviderCredential)
    .set({
      status: "replaced",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(agentProviderCredential.organizationId, organizationId),
        eq(agentProviderCredential.provider, OPENAI_CODEX_PROVIDER),
        eq(agentProviderCredential.status, "connected"),
      ),
    );

  const id = crypto.randomUUID();
  await db.insert(agentProviderCredential).values({
    id,
    organizationId,
    userId,
    provider: OPENAI_CODEX_PROVIDER,
    credentialType: "oauth",
    encryptedCredential: encryptJsonCredential(credentials),
    expiresAt: new Date(credentials.expires),
    status: "connected",
  });

  return id;
}

function startOpenAICodexConnection(record: PendingOpenAICodexConnection) {
  void loginOpenAICodexDeviceCode({
    onDeviceCode: (deviceCode) => {
      record.deviceCode = deviceCode;
      record.updatedAt = new Date();
    },
  })
    .then(async (credentials) => {
      record.credentialId = await saveOpenAICodexCredential({
        organizationId: record.organizationId,
        userId: record.userId,
        credentials,
      });
      record.status = "connected";
      record.updatedAt = new Date();
    })
    .catch((error) => {
      record.status = "failed";
      record.errorMessage =
        error instanceof Error ? error.message : "OpenAI Codex authorization failed.";
      record.updatedAt = new Date();
    });
}

async function waitForDeviceCode(record: PendingOpenAICodexConnection) {
  const start = Date.now();

  while (!record.deviceCode && record.status === "pending" && Date.now() - start < 10_000) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (!record.deviceCode) {
    if (record.status === "failed") {
      throw new ORPCError("INTERNAL_SERVER_ERROR", {
        message: record.errorMessage ?? "OpenAI Codex authorization failed.",
      });
    }

    throw new ORPCError("INTERNAL_SERVER_ERROR", {
      message: "OpenAI Codex did not return a device code in time.",
    });
  }
}

export const appRouter = {
  healthCheck: publicProcedure.handler(() => {
    return "OK";
  }),
  privateData: protectedProcedure.handler(({ context }) => {
    return {
      message: "This is private",
      user: context.session?.user,
    };
  }),
  organizations: protectedProcedure.handler(async ({ context }) => {
    const contextSession = context.session as SessionWithActiveOrganization;
    const organizations = await listUserOrganizations(context.session.user.id);
    const activeOrganization = await resolveActiveOrganization(contextSession, organizations);

    return {
      organizations: organizations.map(mapOrganizationMembership),
      activeOrganization: activeOrganization ? mapOrganizationMembership(activeOrganization) : null,
    };
  }),
  activeOrganization: protectedProcedure.handler(async ({ context }) => {
    const contextSession = context.session as SessionWithActiveOrganization;
    const organizations = await listUserOrganizations(context.session.user.id);
    const activeOrganization = await resolveActiveOrganization(contextSession, organizations);

    return activeOrganization ? mapOrganizationMembership(activeOrganization) : null;
  }),
  setupState: protectedProcedure.handler(async ({ context }) => {
    const contextSession = context.session as SessionWithActiveOrganization;
    const organizations = await listUserOrganizations(context.session.user.id);
    const activeOrganization = await resolveActiveOrganization(contextSession, organizations);

    if (!activeOrganization) {
      return {
        organization: null,
        hasGitHubInstallation: false,
        hasProviderCredential: false,
      };
    }

    const [linkedRepositories, credentials] = await Promise.all([
      db
        .select({ id: githubRepository.id })
        .from(githubRepository)
        .innerJoin(
          githubInstallation,
          eq(githubRepository.installationId, githubInstallation.id),
        )
        .where(
          and(
            eq(githubInstallation.organizationId, activeOrganization.id),
            eq(githubInstallation.status, "connected"),
          ),
        )
        .limit(1),
      db
        .select({ id: agentProviderCredential.id })
        .from(agentProviderCredential)
        .where(
          and(
            eq(agentProviderCredential.organizationId, activeOrganization.id),
            eq(agentProviderCredential.provider, OPENAI_CODEX_PROVIDER),
            eq(agentProviderCredential.status, "connected"),
          ),
        )
        .limit(1),
    ]);

    return {
      organization: mapOrganizationMembership(activeOrganization),
      hasGitHubInstallation: linkedRepositories.length > 0,
      hasProviderCredential: credentials.length > 0,
    };
  }),
  createOrganization: protectedProcedure
    .input(createOrganizationInput)
    .handler(async ({ input, context }) => {
      const userId = context.session.user.id;
      const contextSession = context.session as SessionWithActiveOrganization;
      const existingOrganization = await findUserOrganizationByName(userId, input.name);

      if (existingOrganization) {
        await setActiveOrganizationId(contextSession, existingOrganization.id);
        return mapOrganizationMembership(existingOrganization);
      }

      const id = crypto.randomUUID();
      const now = new Date();
      const slug = await createUniqueOrganizationSlug(input.name);

      await db.transaction(async (transaction) => {
        await transaction.insert(authOrganization).values({
          id,
          name: input.name,
          slug,
          createdAt: now,
        });
        await transaction.insert(member).values({
          id: crypto.randomUUID(),
          userId,
          organizationId: id,
          role: "owner",
          createdAt: now,
        });
      });

      await setActiveOrganizationId(contextSession, id);

      return mapOrganizationMembership({
        id,
        name: input.name,
        slug,
        role: "owner",
      });
    }),
  reviewRuns: protectedProcedure.input(listReviewRunsInput).handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const activeOrganizationId = (context.session as SessionWithActiveOrganization).session
      ?.activeOrganizationId;
    const requestedOrganizationId = input?.organizationId ?? activeOrganizationId ?? undefined;
    const organizationIds = await getUserOrganizationIds(userId);

    if (organizationIds.length === 0) {
      return [];
    }

    if (requestedOrganizationId && !organizationIds.includes(requestedOrganizationId)) {
      throw new ORPCError("FORBIDDEN");
    }

    const rows = await db
      .select()
      .from(reviewRun)
      .where(
        requestedOrganizationId
          ? and(
              eq(reviewRun.organizationId, requestedOrganizationId),
              inArray(reviewRun.organizationId, organizationIds),
            )
          : inArray(reviewRun.organizationId, organizationIds),
      )
      .orderBy(desc(reviewRun.createdAt));

    return rows.map(mapReviewRun);
  }),
  agentRuns: protectedProcedure.input(listAgentRunsInput).handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const activeOrganizationId = (context.session as SessionWithActiveOrganization).session
      ?.activeOrganizationId;
    const requestedOrganizationId = input?.organizationId ?? activeOrganizationId ?? undefined;
    const organizationIds = await getUserOrganizationIds(userId);

    if (organizationIds.length === 0) {
      return [];
    }

    if (requestedOrganizationId && !organizationIds.includes(requestedOrganizationId)) {
      throw new ORPCError("FORBIDDEN");
    }

    const rows = await db
      .select()
      .from(agentRun)
      .where(
        requestedOrganizationId
          ? and(
              eq(agentRun.organizationId, requestedOrganizationId),
              inArray(agentRun.organizationId, organizationIds),
            )
          : inArray(agentRun.organizationId, organizationIds),
      )
      .orderBy(desc(agentRun.createdAt));

    return rows.map(mapAgentRun);
  }),
  agentRunEvents: protectedProcedure
    .input(agentRunEventsInput)
    .handler(async ({ input, context }) => {
      const userId = context.session.user.id;
      await assertCanReadAgentRun(userId, input);

      const rows = await db
        .select()
        .from(agentRunEvent)
        .where(eq(agentRunEvent.runId, input.runId))
        .orderBy(asc(agentRunEvent.sequence));

      return rows.map(mapAgentRunEvent);
    }),
  agentRunArtifacts: protectedProcedure
    .input(agentRunArtifactsInput)
    .handler(async ({ input, context }) => {
      const userId = context.session.user.id;
      await assertCanReadAgentRun(userId, input);

      const rows = await db
        .select()
        .from(agentRunArtifact)
        .where(eq(agentRunArtifact.runId, input.runId))
        .orderBy(asc(agentRunArtifact.createdAt));

      return rows.map(mapAgentRunArtifact);
    }),
  providerCredentials: protectedProcedure
    .input(organizationScopedInput)
    .handler(async ({ input, context }) => {
      const userId = context.session.user.id;
      const activeOrganizationId = (context.session as SessionWithActiveOrganization).session
        ?.activeOrganizationId;
      const organizationId = await resolveOrganizationId(
        userId,
        input?.organizationId ?? activeOrganizationId ?? undefined,
      );

      if (!organizationId) {
        return [];
      }

      const rows = await db
        .select()
        .from(agentProviderCredential)
        .where(eq(agentProviderCredential.organizationId, organizationId))
        .orderBy(desc(agentProviderCredential.updatedAt));

      return rows.map(mapProviderCredential);
    }),
  githubAppInstallUrl: protectedProcedure
    .input(organizationScopedInput)
    .handler(async ({ input, context }) => {
      const userId = context.session.user.id;
      const activeOrganizationId = (context.session as SessionWithActiveOrganization).session
        ?.activeOrganizationId;
      const organizationId = await resolveOrganizationId(
        userId,
        input?.organizationId ?? activeOrganizationId ?? undefined,
      );

      if (!organizationId) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Create or select an organization before installing the GitHub App.",
        });
      }

      await assertCanManageOrganizationCredentials(userId, organizationId);

      if (!isGitHubAppConfigured()) {
        return {
          configured: false,
          installUrl: null,
        };
      }

      return {
        configured: true,
        installUrl: createGitHubAppInstallUrl(organizationId),
      };
    }),
  githubInstallations: protectedProcedure
    .input(organizationScopedInput)
    .handler(async ({ input, context }) => {
      const userId = context.session.user.id;
      const activeOrganizationId = (context.session as SessionWithActiveOrganization).session
        ?.activeOrganizationId;
      const organizationId = await resolveOrganizationId(
        userId,
        input?.organizationId ?? activeOrganizationId ?? undefined,
      );

      if (!organizationId) {
        return [];
      }

      const rows = await db
        .select()
        .from(githubInstallation)
        .where(eq(githubInstallation.organizationId, organizationId))
        .orderBy(desc(githubInstallation.updatedAt));
      const installationIds = rows.map((row) => row.id);
      const repositoryRows = installationIds.length
        ? await db
            .select()
            .from(githubRepository)
            .where(inArray(githubRepository.installationId, installationIds))
        : [];

      return rows.map((row) =>
        mapGitHubInstallation(
          row,
          repositoryRows.filter((repository) => repository.installationId === row.id),
        ),
      );
    }),
  availableGitHubInstallations: protectedProcedure
    .input(organizationScopedInput)
    .handler(async ({ input, context }) => {
      const userId = context.session.user.id;
      const activeOrganizationId = (context.session as SessionWithActiveOrganization).session
        ?.activeOrganizationId;
      const organizationId = await resolveOrganizationId(
        userId,
        input?.organizationId ?? activeOrganizationId ?? undefined,
      );

      if (!organizationId) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Create or select an organization before checking GitHub installations.",
        });
      }

      await assertCanManageOrganizationCredentials(userId, organizationId);

      if (!isGitHubAppConfigured()) {
        return {
          configured: false,
          installations: [],
        };
      }

      try {
        return {
          configured: true,
          installations: await listAvailableGitHubInstallations({ organizationId }),
        };
      } catch (error) {
        throw new ORPCError("BAD_REQUEST", {
          message:
            error instanceof Error ? error.message : "Failed to check GitHub App installations.",
        });
      }
    }),
  claimGitHubInstallation: protectedProcedure
    .input(claimGitHubInstallationInput)
    .handler(async ({ input, context }) => {
      const userId = context.session.user.id;
      const activeOrganizationId = (context.session as SessionWithActiveOrganization).session
        ?.activeOrganizationId;
      const organizationId = await resolveOrganizationId(
        userId,
        input.organizationId ?? input.state ?? activeOrganizationId ?? undefined,
      );

      if (!organizationId) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Create or select an organization before linking a GitHub installation.",
        });
      }

      await assertCanManageOrganizationCredentials(userId, organizationId);

      try {
        return await claimGitHubInstallation({
          organizationId,
          userId,
          installationId: input.installationId,
          setupAction: input.setupAction,
        });
      } catch (error) {
        throw new ORPCError("BAD_REQUEST", {
          message: error instanceof Error ? error.message : "Failed to claim GitHub installation.",
        });
      }
    }),
  startOpenAICodexCredentialConnection: protectedProcedure
    .input(organizationScopedInput)
    .handler(async ({ input, context }) => {
      const userId = context.session.user.id;
      const activeOrganizationId = (context.session as SessionWithActiveOrganization).session
        ?.activeOrganizationId;
      const organizationId = await resolveOrganizationId(
        userId,
        input?.organizationId ?? activeOrganizationId ?? undefined,
      );

      if (!organizationId) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Create or select an organization before connecting OpenAI Codex.",
        });
      }

      await assertCanManageOrganizationCredentials(userId, organizationId);

      const id = crypto.randomUUID();
      const record: PendingOpenAICodexConnection = {
        id,
        organizationId,
        userId,
        status: "pending",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      pendingOpenAICodexConnections.set(id, record);
      startOpenAICodexConnection(record);
      await waitForDeviceCode(record);

      return mapConnection(record);
    }),
  openAICodexCredentialConnection: protectedProcedure
    .input(credentialConnectionInput)
    .handler(({ input, context }) => {
      const record = pendingOpenAICodexConnections.get(input.connectionId);

      if (!record) {
        throw new ORPCError("NOT_FOUND");
      }

      if (record.userId !== context.session.user.id) {
        throw new ORPCError("FORBIDDEN");
      }

      return mapConnection(record);
    }),
  revokeProviderCredential: protectedProcedure
    .input(revokeProviderCredentialInput)
    .handler(async ({ input, context }) => {
      const userId = context.session.user.id;
      const activeOrganizationId = (context.session as SessionWithActiveOrganization).session
        ?.activeOrganizationId;
      const organizationId = await resolveOrganizationId(
        userId,
        input.organizationId ?? activeOrganizationId ?? undefined,
      );

      if (!organizationId) {
        throw new ORPCError("BAD_REQUEST");
      }

      await assertCanManageOrganizationCredentials(userId, organizationId);

      const [row] = await db
        .select()
        .from(agentProviderCredential)
        .where(
          and(
            eq(agentProviderCredential.id, input.id),
            eq(agentProviderCredential.organizationId, organizationId),
          ),
        )
        .limit(1);

      if (!row) {
        throw new ORPCError("NOT_FOUND");
      }

      await db
        .update(agentProviderCredential)
        .set({
          status: "revoked",
          updatedAt: new Date(),
        })
        .where(eq(agentProviderCredential.id, input.id));

      return mapProviderCredential({ ...row, status: "revoked", updatedAt: new Date() });
    }),
  createReviewRun: protectedProcedure
    .input(createReviewRunInput)
    .handler(async ({ input, context }) => {
      const userId = context.session.user.id;
      const activeOrganizationId = (context.session as SessionWithActiveOrganization).session
        ?.activeOrganizationId;
      const organizationId = await resolveOrganizationId(
        userId,
        input.organizationId ?? activeOrganizationId ?? undefined,
      );

      if (!organizationId) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Create or select an organization before starting a review.",
        });
      }

      const id = crypto.randomUUID();
      const repositoryUrl = input.repositoryUrl || null;
      const providerCredential = await getConnectedOpenAICodexCredential(organizationId);

      if (!providerCredential && env.NODE_ENV === "production") {
        throw new ORPCError("BAD_REQUEST", {
          message: "Connect OpenAI Codex before starting a review.",
        });
      }

      await db.insert(reviewRun).values({
        id,
        organizationId,
        userId,
        providerCredentialId: providerCredential?.id ?? null,
        repositoryOwner: input.repositoryOwner || null,
        repositoryName: input.repositoryName || null,
        repositoryUrl,
        branch: input.branch,
        baseBranch: input.baseBranch || null,
        reviewContext: input.reviewContext || null,
        status: "queued",
      });

      try {
        const receipt = await context.reviewRunInvoker({
          reviewRunId: id,
          repositoryUrl: repositoryUrl ?? undefined,
          repositoryOwner: input.repositoryOwner || undefined,
          repositoryName: input.repositoryName || undefined,
          branch: input.branch,
          baseBranch: input.baseBranch || undefined,
          reviewContext: input.reviewContext || undefined,
          providerCredentialId: providerCredential?.id,
        });

        await db
          .update(reviewRun)
          .set({
            status: "running",
            flueRunId: receipt.flueRunId,
            startedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(reviewRun.id, id));
      } catch (error) {
        await db
          .update(reviewRun)
          .set({
            status: "failed",
            errorMessage: error instanceof Error ? error.message : "Failed to start review run",
            completedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(reviewRun.id, id));
      }

      const [row] = await db.select().from(reviewRun).where(eq(reviewRun.id, id)).limit(1);

      if (!row) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }

      return mapReviewRun(row);
    }),
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
