import type { RouterClient } from "@orpc/server";
import { ORPCError } from "@orpc/server";
import {
  loginOpenAICodexDeviceCode,
  type OAuthCredentials,
  type OAuthDeviceCodeInfo,
} from "@earendil-works/pi-ai/oauth";
import { db } from "@hosted-agents/db";
import { member } from "@hosted-agents/db/schema/auth";
import { agentProviderCredential } from "@hosted-agents/db/schema/provider-credentials";
import { reviewRun } from "@hosted-agents/db/schema/reviews";
import { env } from "@hosted-agents/env/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

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

const organizationScopedInput = z
  .object({
    organizationId: z.string().optional(),
  })
  .optional();

const credentialConnectionInput = z.object({
  connectionId: z.string(),
});

const revokeProviderCredentialInput = z.object({
  id: z.string(),
  organizationId: z.string().optional(),
});

type SessionWithActiveOrganization = {
  session?: {
    activeOrganizationId?: string | null;
  };
};

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
    summary: row.summary,
    findings: parseFindings(row.findingsJson),
    errorMessage: row.errorMessage,
    startedAt: toIsoString(row.startedAt),
    completedAt: toIsoString(row.completedAt),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
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
