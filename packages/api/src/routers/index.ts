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
  CODE_REVIEW_WORKER_ROLE,
  GITHUB_ISSUE_IMPLEMENTATION_RUN_TYPE,
  GITHUB_PULL_REQUEST_REVIEW_RUN_TYPE,
  IMPLEMENTATION_WORKER_DISPLAY_NAME,
  IMPLEMENTATION_WORKER_ROLE,
  LEGACY_CODE_REVIEW_COWORKER_SLUG,
  LEGACY_IMPLEMENTATION_COWORKER_SLUG,
  agentRun,
  agentRunArtifact,
  agentRunEvent,
} from "@hosted-agents/db/schema/agent-runs";
import { workerConfig, workerSkill, workerSkillFile } from "@hosted-agents/db/schema/worker-config";
import {
  member,
  organization as authOrganization,
  session as authSession,
} from "@hosted-agents/db/schema/auth";
import { githubInstallation, githubRepository } from "@hosted-agents/db/schema/github";
import { agentProviderCredential } from "@hosted-agents/db/schema/provider-credentials";
import { reviewRun } from "@hosted-agents/db/schema/reviews";
import { env } from "@hosted-agents/env/server";
import {
  DEFAULT_CODEX_MODEL_ID,
  DEFAULT_CODEX_REASONING_EFFORT,
  REASONING_EFFORTS,
} from "../codex-model-policy";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import {
  claimGitHubInstallation,
  createGitHubAppInstallUrl,
  getGitHubAppSlug,
  getGitHubPullRequest,
  isGitHubAppConfigured,
  listAvailableGitHubInstallations,
  listOpenGitHubPullRequests,
  listGitHubIssues,
  getGitHubIssue,
  listGitHubIssueComments,
  createGitHubIssueComment,
  resolveGitHubAppWorkerRole,
} from "../github-app";
import { claimIssueForWorker } from "../issues/claim";
import { deriveIssueStage, listBoard, type GitHubIssuesClient } from "../issues/service";
import { loadIssueOverlay, loadIssueOverlays, upsertSyncedIssue } from "../issues/sync";
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
    issueNumber: row.issueNumber,
    pullRequestNumber: row.pullRequestNumber,
    pullRequestBaseRef: row.pullRequestBaseRef,
    pullRequestBaseSha: row.pullRequestBaseSha,
    pullRequestHeadRef: row.pullRequestHeadRef,
    pullRequestHeadSha: row.pullRequestHeadSha,
    status: row.status,
    model: row.model,
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
    // Authoritative reviewer-vs-Coder classification, resolved server-side from
    // env config (never gated on the caller's org role). Clients rely on this to
    // separate the reviewer installation from the Coder app's without having to
    // load the admin-only Coder install-config endpoint.
    workerRole: resolveGitHubAppWorkerRole(row.appSlug),
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

const updateWorkerConfigurationInput = z.object({
  organizationId: z.string().optional(),
  displayName: z.string().trim().max(80).nullable().optional(),
  model: z.string().trim().max(120).nullable().optional(),
  reasoningEffort: z.enum(REASONING_EFFORTS).nullable().optional(),
  instructions: z.string().max(20_000).nullable().optional(),
});

const workerSkillNamePattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

// Bundle-relative markdown paths like "SKILL.md" or "checklists/security.md":
// plain segments only, no leading slash, no "..", and a .md suffix.
const workerSkillFilePathPattern =
  /^[A-Za-z0-9][A-Za-z0-9._ -]*(\/[A-Za-z0-9][A-Za-z0-9._ -]*)*\.md$/i;

const workerSkillFileInput = z.object({
  path: z
    .string()
    .max(200)
    .regex(
      workerSkillFilePathPattern,
      "Skill files must be bundle-relative markdown paths like SKILL.md or checklists/security.md.",
    )
    .refine((path) => !path.split("/").includes(".."), "Skill file paths cannot traverse upward."),
  content: z.string().max(100_000),
});

const SKILL_ENTRY_FILE = "SKILL.md";

const saveWorkerSkillInput = z.object({
  organizationId: z.string().optional(),
  name: z
    .string()
    .regex(
      workerSkillNamePattern,
      "Skill names must be plain directory names like review-standards (letters, digits, dot, dash, underscore).",
    ),
  description: z.string().trim().max(300).optional(),
  enabled: z.boolean().optional(),
  files: z
    .array(workerSkillFileInput)
    .min(1)
    .max(50)
    .refine(
      (files) => files.some((file) => file.path === SKILL_ENTRY_FILE),
      `A skill bundle needs a ${SKILL_ENTRY_FILE} entry file.`,
    )
    .refine(
      (files) => new Set(files.map((file) => file.path)).size === files.length,
      "Skill bundle file paths must be unique.",
    ),
});

const deleteWorkerSkillInput = z.object({
  organizationId: z.string().optional(),
  name: z.string().min(1),
});

const setRepositorySelectedInput = z.object({
  organizationId: z.string().optional(),
  repositoryId: z.string().min(1),
  selected: z.boolean(),
});

const repositoryScopedInput = z.object({
  organizationId: z.string().optional(),
  repositoryId: z.string().min(1),
});

const issueScopedInput = repositoryScopedInput.extend({
  issueNumber: z.number().int().positive(),
});

const postIssueCommentInput = issueScopedInput.extend({
  body: z.string().min(1),
});

const triggerCodeReviewRunInput = z.object({
  organizationId: z.string().optional(),
  repositoryId: z.string().min(1),
  pullRequestNumber: z.number().int().positive(),
});

type ProcedureContext = {
  session: ({ user: { id: string } } & SessionWithActiveOrganization) | null;
};

async function requireOrganizationId(
  context: ProcedureContext,
  requestedOrganizationId?: string,
): Promise<string> {
  const session = context.session;

  if (!session) {
    throw new ORPCError("UNAUTHORIZED");
  }

  const organizationId = await resolveOrganizationId(
    session.user.id,
    requestedOrganizationId ?? session.session?.activeOrganizationId ?? undefined,
  );

  if (!organizationId) {
    throw new ORPCError("BAD_REQUEST", {
      message: "Create or select an organization first.",
    });
  }

  return organizationId;
}

async function requireOrganizationRepository(organizationId: string, repositoryId: string) {
  const [row] = await db
    .select({ repository: githubRepository, installation: githubInstallation })
    .from(githubRepository)
    .innerJoin(githubInstallation, eq(githubRepository.installationId, githubInstallation.id))
    .where(eq(githubRepository.id, repositoryId))
    .limit(1);

  if (!row || row.installation.organizationId !== organizationId) {
    throw new ORPCError("NOT_FOUND", {
      message: "Repository is not linked to this organization.",
    });
  }

  return { repository: row.repository, installation: row.installation };
}

function mapWorkerConfig(row: typeof workerConfig.$inferSelect) {
  return {
    id: row.id,
    workerRole: row.workerRole,
    displayName: row.displayName,
    model: row.model,
    reasoningEffort: row.reasoningEffort,
    instructions: row.instructions,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function mapWorkerSkill(
  row: typeof workerSkill.$inferSelect,
  files: (typeof workerSkillFile.$inferSelect)[],
) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    updatedAt: row.updatedAt.toISOString(),
    files: files.map((file) => ({
      path: file.path,
      content: file.content,
      updatedAt: file.updatedAt.toISOString(),
    })),
  };
}

// Entry file (SKILL.md) first, then the rest alphabetically — the order the
// bundle reads in every surface.
function sortSkillFiles<T extends { path: string }>(files: T[]): T[] {
  return [...files].sort((left, right) => {
    if (left.path === SKILL_ENTRY_FILE) return -1;
    if (right.path === SKILL_ENTRY_FILE) return 1;
    return left.path.localeCompare(right.path);
  });
}

async function loadSkillFilesBySkillId(
  skillIds: string[],
): Promise<Map<string, (typeof workerSkillFile.$inferSelect)[]>> {
  const bySkillId = new Map<string, (typeof workerSkillFile.$inferSelect)[]>();
  if (skillIds.length === 0) {
    return bySkillId;
  }

  const rows = await db
    .select()
    .from(workerSkillFile)
    .where(inArray(workerSkillFile.skillId, skillIds));
  for (const row of rows) {
    const list = bySkillId.get(row.skillId);
    if (list) {
      list.push(row);
    } else {
      bySkillId.set(row.skillId, [row]);
    }
  }
  for (const [skillId, list] of bySkillId) {
    bySkillId.set(skillId, sortSkillFiles(list));
  }

  return bySkillId;
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
        .innerJoin(githubInstallation, eq(githubRepository.installationId, githubInstallation.id))
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
  githubCoderAppInstallUrl: protectedProcedure
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
          message: "Create or select an organization before installing the Coder GitHub App.",
        });
      }

      await assertCanManageOrganizationCredentials(userId, organizationId);

      if (!isGitHubAppConfigured(IMPLEMENTATION_WORKER_ROLE)) {
        return {
          configured: false,
          installUrl: null,
          appSlug: null,
        };
      }

      return {
        configured: true,
        installUrl: createGitHubAppInstallUrl(organizationId, IMPLEMENTATION_WORKER_ROLE),
        appSlug: getGitHubAppSlug(IMPLEMENTATION_WORKER_ROLE),
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
  workerConfiguration: protectedProcedure
    .input(organizationScopedInput)
    .handler(async ({ input, context }) => {
      const organizationId = await requireOrganizationId(context, input?.organizationId);

      const [config] = await db
        .select()
        .from(workerConfig)
        .where(
          and(
            eq(workerConfig.organizationId, organizationId),
            eq(workerConfig.workerRole, CODE_REVIEW_WORKER_ROLE),
          ),
        )
        .limit(1);
      const skills = await db
        .select()
        .from(workerSkill)
        .where(
          and(
            eq(workerSkill.organizationId, organizationId),
            eq(workerSkill.workerRole, CODE_REVIEW_WORKER_ROLE),
          ),
        )
        .orderBy(asc(workerSkill.name));
      const filesBySkillId = await loadSkillFilesBySkillId(skills.map((skill) => skill.id));

      return {
        workerRole: CODE_REVIEW_WORKER_ROLE,
        defaults: {
          displayName: CODE_REVIEW_WORKER_DISPLAY_NAME,
          model: DEFAULT_CODEX_MODEL_ID,
          reasoningEffort: DEFAULT_CODEX_REASONING_EFFORT,
        },
        config: config ? mapWorkerConfig(config) : null,
        skills: skills.map((skill) => mapWorkerSkill(skill, filesBySkillId.get(skill.id) ?? [])),
      };
    }),
  updateWorkerConfiguration: protectedProcedure
    .input(updateWorkerConfigurationInput)
    .handler(async ({ input, context }) => {
      const userId = context.session.user.id;
      const organizationId = await requireOrganizationId(context, input.organizationId);
      await assertCanManageOrganizationCredentials(userId, organizationId);

      const now = new Date();
      const [existing] = await db
        .select()
        .from(workerConfig)
        .where(
          and(
            eq(workerConfig.organizationId, organizationId),
            eq(workerConfig.workerRole, CODE_REVIEW_WORKER_ROLE),
          ),
        )
        .limit(1);

      if (existing) {
        const [updated] = await db
          .update(workerConfig)
          .set({
            displayName: input.displayName === undefined ? existing.displayName : input.displayName,
            model: input.model === undefined ? existing.model : input.model,
            reasoningEffort:
              input.reasoningEffort === undefined
                ? existing.reasoningEffort
                : input.reasoningEffort,
            instructions:
              input.instructions === undefined ? existing.instructions : input.instructions,
            updatedAt: now,
          })
          .where(eq(workerConfig.id, existing.id))
          .returning();

        if (!updated) {
          throw new ORPCError("INTERNAL_SERVER_ERROR");
        }

        return mapWorkerConfig(updated);
      }

      const [created] = await db
        .insert(workerConfig)
        .values({
          id: crypto.randomUUID(),
          organizationId,
          workerRole: CODE_REVIEW_WORKER_ROLE,
          displayName: input.displayName ?? null,
          model: input.model ?? null,
          reasoningEffort: input.reasoningEffort ?? null,
          instructions: input.instructions ?? null,
        })
        .returning();

      if (!created) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }

      return mapWorkerConfig(created);
    }),
  saveWorkerSkill: protectedProcedure
    .input(saveWorkerSkillInput)
    .handler(async ({ input, context }) => {
      const userId = context.session.user.id;
      const organizationId = await requireOrganizationId(context, input.organizationId);
      await assertCanManageOrganizationCredentials(userId, organizationId);

      const now = new Date();
      const [existing] = await db
        .select()
        .from(workerSkill)
        .where(
          and(
            eq(workerSkill.organizationId, organizationId),
            eq(workerSkill.workerRole, CODE_REVIEW_WORKER_ROLE),
            eq(workerSkill.name, input.name),
          ),
        )
        .limit(1);

      let skillRow: typeof workerSkill.$inferSelect | undefined;
      if (existing) {
        const [updated] = await db
          .update(workerSkill)
          .set({
            description: input.description === undefined ? existing.description : input.description,
            enabled: input.enabled ?? existing.enabled,
            updatedAt: now,
          })
          .where(eq(workerSkill.id, existing.id))
          .returning();
        skillRow = updated;
      } else {
        const [created] = await db
          .insert(workerSkill)
          .values({
            id: crypto.randomUUID(),
            organizationId,
            workerRole: CODE_REVIEW_WORKER_ROLE,
            name: input.name,
            description: input.description ?? null,
            enabled: input.enabled ?? true,
          })
          .returning();
        skillRow = created;
      }

      if (!skillRow) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }

      // Saving replaces the whole bundle: the payload is the bundle.
      await db.delete(workerSkillFile).where(eq(workerSkillFile.skillId, skillRow.id));
      const fileRows = sortSkillFiles(input.files).map((file) => ({
        id: crypto.randomUUID(),
        skillId: skillRow.id,
        path: file.path,
        content: file.content,
      }));
      const insertedFiles = await db.insert(workerSkillFile).values(fileRows).returning();

      return mapWorkerSkill(skillRow, sortSkillFiles(insertedFiles));
    }),
  deleteWorkerSkill: protectedProcedure
    .input(deleteWorkerSkillInput)
    .handler(async ({ input, context }) => {
      const userId = context.session.user.id;
      const organizationId = await requireOrganizationId(context, input.organizationId);
      await assertCanManageOrganizationCredentials(userId, organizationId);

      const [existing] = await db
        .select()
        .from(workerSkill)
        .where(
          and(
            eq(workerSkill.organizationId, organizationId),
            eq(workerSkill.workerRole, CODE_REVIEW_WORKER_ROLE),
            eq(workerSkill.name, input.name),
          ),
        )
        .limit(1);

      if (existing) {
        // Explicit file delete first: SQLite only honors the FK cascade when
        // foreign_keys is on, which libsql does not guarantee.
        await db.delete(workerSkillFile).where(eq(workerSkillFile.skillId, existing.id));
        await db.delete(workerSkill).where(eq(workerSkill.id, existing.id));
      }

      return { name: input.name, deleted: true };
    }),
  setRepositorySelected: protectedProcedure
    .input(setRepositorySelectedInput)
    .handler(async ({ input, context }) => {
      const userId = context.session.user.id;
      const organizationId = await requireOrganizationId(context, input.organizationId);
      await assertCanManageOrganizationCredentials(userId, organizationId);

      const repository = await requireOrganizationRepository(organizationId, input.repositoryId);

      const [updated] = await db
        .update(githubRepository)
        .set({ selected: input.selected, updatedAt: new Date() })
        .where(eq(githubRepository.id, repository.repository.id))
        .returning();

      if (!updated) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }

      return {
        id: updated.id,
        fullName: updated.fullName,
        selected: updated.selected,
      };
    }),
  openPullRequests: protectedProcedure
    .input(repositoryScopedInput)
    .handler(async ({ input, context }) => {
      const organizationId = await requireOrganizationId(context, input.organizationId);
      const { repository, installation } = await requireOrganizationRepository(
        organizationId,
        input.repositoryId,
      );

      if (installation.status !== "connected") {
        throw new ORPCError("BAD_REQUEST", {
          message: `GitHub installation is ${installation.status}.`,
        });
      }

      try {
        return await listOpenGitHubPullRequests(
          installation.installationId,
          repository.owner,
          repository.name,
        );
      } catch (error) {
        throw new ORPCError("BAD_REQUEST", {
          message: error instanceof Error ? error.message : "Failed to list open pull requests.",
        });
      }
    }),
  listRepositoryIssues: protectedProcedure
    .input(repositoryScopedInput)
    .handler(async ({ input, context }) => {
      const organizationId = await requireOrganizationId(context, input.organizationId);
      const { repository, installation } = await requireOrganizationRepository(
        organizationId,
        input.repositoryId,
      );

      if (installation.status !== "connected") {
        throw new ORPCError("BAD_REQUEST", {
          message: `GitHub installation is ${installation.status}.`,
        });
      }

      const client: GitHubIssuesClient = {
        listIssues: listGitHubIssues,
        getIssue: getGitHubIssue,
      };

      try {
        // Issues + labels come live from GitHub; the claim + linked-PR overlay
        // comes from our store (kept current by the webhook sync). Layering the
        // two is what lets Executing / In PR / Merged lanes populate for work our
        // agents have picked up, while a repo with no sync history still shows its
        // full issue list.
        const overlays = await loadIssueOverlays(db, repository.id);
        return await listBoard(
          client,
          {
            installationId: installation.installationId,
            owner: repository.owner,
            repo: repository.name,
          },
          overlays,
        );
      } catch (error) {
        throw new ORPCError("BAD_REQUEST", {
          message: error instanceof Error ? error.message : "Failed to list repository issues.",
        });
      }
    }),
  getRepositoryIssue: protectedProcedure
    .input(issueScopedInput)
    .handler(async ({ input, context }) => {
      const organizationId = await requireOrganizationId(context, input.organizationId);
      const { repository, installation } = await requireOrganizationRepository(
        organizationId,
        input.repositoryId,
      );

      if (installation.status !== "connected") {
        throw new ORPCError("BAD_REQUEST", {
          message: `GitHub installation is ${installation.status}.`,
        });
      }

      try {
        const [issue, comments, overlay] = await Promise.all([
          getGitHubIssue(
            installation.installationId,
            repository.owner,
            repository.name,
            input.issueNumber,
          ),
          listGitHubIssueComments(
            installation.installationId,
            repository.owner,
            repository.name,
            input.issueNumber,
          ),
          loadIssueOverlay(db, repository.id, input.issueNumber),
        ]);
        // Derive the stage with the store overlay so the detail's stage reflects a
        // claim or linked PR (Executing / In PR / Merged), matching the board lane.
        const { stage, claimable } = deriveIssueStage(issue, overlay);
        return { issue, comments, stage, claimable };
      } catch (error) {
        throw new ORPCError("BAD_REQUEST", {
          message: error instanceof Error ? error.message : "Failed to load the issue.",
        });
      }
    }),
  postIssueComment: protectedProcedure
    .input(postIssueCommentInput)
    .handler(async ({ input, context }) => {
      const organizationId = await requireOrganizationId(context, input.organizationId);
      const { repository, installation } = await requireOrganizationRepository(
        organizationId,
        input.repositoryId,
      );

      if (installation.status !== "connected") {
        throw new ORPCError("BAD_REQUEST", {
          message: `GitHub installation is ${installation.status}.`,
        });
      }

      // Phase 1 posts through the installation (the app/bot identity). Posting as
      // the member needs user-scoped GitHub auth — the identity follow-up tracked
      // in #19; true authorship is recorded on our side.
      try {
        return await createGitHubIssueComment(
          installation.installationId,
          repository.owner,
          repository.name,
          input.issueNumber,
          input.body,
        );
      } catch (error) {
        throw new ORPCError("BAD_REQUEST", {
          message: error instanceof Error ? error.message : "Failed to post the comment.",
        });
      }
    }),
  triggerCodeReviewRun: protectedProcedure
    .input(triggerCodeReviewRunInput)
    .handler(async ({ input, context }) => {
      const userId = context.session.user.id;
      const organizationId = await requireOrganizationId(context, input.organizationId);
      await assertCanManageOrganizationCredentials(userId, organizationId);

      const { repository, installation } = await requireOrganizationRepository(
        organizationId,
        input.repositoryId,
      );

      if (installation.status !== "connected") {
        throw new ORPCError("BAD_REQUEST", {
          message: `GitHub installation is ${installation.status}.`,
        });
      }

      if (!repository.selected) {
        throw new ORPCError("BAD_REQUEST", {
          message: "Enable this repository before requesting a review.",
        });
      }

      const pullRequest = await getGitHubPullRequest(
        installation.installationId,
        repository.owner,
        repository.name,
        input.pullRequestNumber,
      ).catch((error: unknown) => {
        throw new ORPCError("BAD_REQUEST", {
          message: error instanceof Error ? error.message : "Failed to load the pull request.",
        });
      });

      if (
        !pullRequest.baseRef ||
        !pullRequest.baseSha ||
        !pullRequest.headRef ||
        !pullRequest.headSha
      ) {
        throw new ORPCError("BAD_REQUEST", {
          message: "GitHub did not return complete pull request refs for this pull request.",
        });
      }

      const providerCredential = await getConnectedOpenAICodexCredential(organizationId);

      if (!providerCredential && env.NODE_ENV === "production") {
        throw new ORPCError("BAD_REQUEST", {
          message: "Connect OpenAI Codex before requesting a review.",
        });
      }

      const agentRunId = crypto.randomUUID();

      await db.transaction(async (transaction) => {
        await transaction.insert(agentRun).values({
          id: agentRunId,
          organizationId,
          userId,
          providerCredentialId: providerCredential?.id ?? null,
          coworkerSlug: LEGACY_CODE_REVIEW_COWORKER_SLUG,
          workerRole: CODE_REVIEW_WORKER_ROLE,
          workerDisplayName: CODE_REVIEW_WORKER_DISPLAY_NAME,
          runType: GITHUB_PULL_REQUEST_REVIEW_RUN_TYPE,
          sourceProvider: "github",
          sourceDeliveryId: null,
          repositoryOwner: repository.owner,
          repositoryName: repository.name,
          repositoryUrl: repository.htmlUrl,
          branch: pullRequest.headRef,
          baseBranch: pullRequest.baseRef,
          githubInstallationId: installation.id,
          githubRepositoryId: repository.id,
          pullRequestNumber: pullRequest.number,
          pullRequestBaseRef: pullRequest.baseRef,
          pullRequestBaseSha: pullRequest.baseSha,
          pullRequestHeadRef: pullRequest.headRef,
          pullRequestHeadSha: pullRequest.headSha,
          status: "queued",
          currentStage: "queued",
          lastHeartbeatAt: new Date(),
        });

        await transaction.insert(agentRunEvent).values({
          id: crypto.randomUUID(),
          runId: agentRunId,
          sequence: 1,
          category: "github",
          type: "github.manual.review_requested",
          stage: "manual_trigger",
          message: `Manual review requested for PR #${pullRequest.number}`,
          payloadJson: JSON.stringify({
            requestedByUserId: userId,
            pullRequestNumber: pullRequest.number,
            repositoryFullName: repository.fullName,
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
            workerRole: CODE_REVIEW_WORKER_ROLE,
            workerDisplayName: CODE_REVIEW_WORKER_DISPLAY_NAME,
            runType: GITHUB_PULL_REQUEST_REVIEW_RUN_TYPE,
          }),
        });
      });

      const [row] = await db.select().from(agentRun).where(eq(agentRun.id, agentRunId)).limit(1);

      if (!row) {
        throw new ORPCError("INTERNAL_SERVER_ERROR");
      }

      return mapAgentRun(row);
    }),
  // Kick off the implementation ("Coder") worker on a ready-for-agent issue (spec
  // #21 stories 1–4). Authorization lives in the transport; the atomic claim +
  // single run insert live in one transaction so a double kick-off yields exactly
  // one claim and one queued run, and the issue moves to Executing immediately.
  kickOffIssue: protectedProcedure.input(issueScopedInput).handler(async ({ input, context }) => {
    const userId = context.session.user.id;
    const organizationId = await requireOrganizationId(context, input.organizationId);
    await assertCanManageOrganizationCredentials(userId, organizationId);

    const { repository, installation } = await requireOrganizationRepository(
      organizationId,
      input.repositoryId,
    );

    if (installation.status !== "connected") {
      throw new ORPCError("BAD_REQUEST", {
        message: `GitHub installation is ${installation.status}.`,
      });
    }

    if (!repository.selected) {
      throw new ORPCError("BAD_REQUEST", {
        message: "Enable this repository before kicking off an agent.",
      });
    }

    // Read the issue live so the claim decision is made on GitHub's truth
    // (labels + open/closed), then layered with our store's claim overlay.
    const issue = await getGitHubIssue(
      installation.installationId,
      repository.owner,
      repository.name,
      input.issueNumber,
    ).catch((error: unknown) => {
      throw new ORPCError("BAD_REQUEST", {
        message: error instanceof Error ? error.message : "Failed to load the issue.",
      });
    });

    const overlay = await loadIssueOverlay(db, repository.id, input.issueNumber);
    const { claimable } = deriveIssueStage(issue, overlay);

    // Reject only when the issue is neither already claimed nor claimable — a
    // backlog or human-in-the-loop issue can't be kicked off. An already-claimed
    // issue is not rejected: the atomic claim below returns it idempotently.
    if (!overlay?.claimed && !claimable) {
      throw new ORPCError("BAD_REQUEST", {
        message:
          'This issue is not ready for an agent. Label it "ready for agent" (and remove "human in the loop") first.',
      });
    }

    // Mirror the review trigger: dev proceeds without a connected credential so
    // the loop is exercisable locally; production requires one before spending.
    const providerCredential = await getConnectedOpenAICodexCredential(organizationId);
    if (!providerCredential && env.NODE_ENV === "production") {
      throw new ORPCError("BAD_REQUEST", {
        message: "Connect OpenAI Codex before kicking off an agent.",
      });
    }

    const runId = crypto.randomUUID();
    const baseBranch = repository.defaultBranch ?? "main";

    const claim = await db.transaction(async (transaction) => {
      // Ensure the issue is synced (kick-off can precede any issue webhook) so
      // the claim has a row to stamp; the upsert never clobbers an existing claim.
      await upsertSyncedIssue(transaction, {
        organizationId,
        githubInstallationId: installation.id,
        githubRepositoryId: repository.id,
        repositoryFullName: repository.fullName,
        number: issue.number,
        githubIssueId: issue.githubId,
        nodeId: issue.nodeId,
        title: issue.title,
        body: issue.body,
        state: issue.state,
        authorLogin: issue.authorLogin,
        authorAvatarUrl: issue.authorAvatarUrl,
        labels: issue.labels,
        htmlUrl: issue.htmlUrl,
        commentCount: issue.commentCount,
        githubCreatedAt: issue.createdAt ? new Date(issue.createdAt) : null,
        githubUpdatedAt: issue.updatedAt ? new Date(issue.updatedAt) : null,
      });

      const result = await claimIssueForWorker(transaction, {
        githubRepositoryId: repository.id,
        issueNumber: issue.number,
        workerRole: IMPLEMENTATION_WORKER_ROLE,
        runId,
      });

      // Only the winning claim queues a run — the loser (a concurrent or repeat
      // kick-off) returns the existing claim and inserts nothing.
      if (result.outcome === "claimed") {
        await transaction.insert(agentRun).values({
          id: runId,
          organizationId,
          userId,
          providerCredentialId: providerCredential?.id ?? null,
          coworkerSlug: LEGACY_IMPLEMENTATION_COWORKER_SLUG,
          workerRole: IMPLEMENTATION_WORKER_ROLE,
          workerDisplayName: IMPLEMENTATION_WORKER_DISPLAY_NAME,
          runType: GITHUB_ISSUE_IMPLEMENTATION_RUN_TYPE,
          sourceProvider: "github",
          sourceDeliveryId: null,
          repositoryOwner: repository.owner,
          repositoryName: repository.name,
          repositoryUrl: repository.htmlUrl,
          branch: null,
          baseBranch,
          issueNumber: issue.number,
          githubInstallationId: installation.id,
          githubRepositoryId: repository.id,
          status: "queued",
          currentStage: "queued",
          lastHeartbeatAt: new Date(),
        });

        await transaction.insert(agentRunEvent).values({
          id: crypto.randomUUID(),
          runId,
          sequence: 1,
          category: "github",
          type: "github.issue.kickoff_requested",
          stage: "manual_trigger",
          message: `Kick-off requested for issue #${issue.number}`,
          payloadJson: JSON.stringify({
            requestedByUserId: userId,
            issueNumber: issue.number,
            repositoryFullName: repository.fullName,
          }),
        });
        await transaction.insert(agentRunEvent).values({
          id: crypto.randomUUID(),
          runId,
          sequence: 2,
          category: "queue",
          type: "queue.created",
          stage: "queued",
          message: "Queued implementation worker run",
          payloadJson: JSON.stringify({
            workerRole: IMPLEMENTATION_WORKER_ROLE,
            workerDisplayName: IMPLEMENTATION_WORKER_DISPLAY_NAME,
            runType: GITHUB_ISSUE_IMPLEMENTATION_RUN_TYPE,
          }),
        });
      }

      return result;
    });

    const [row] = await db
      .select()
      .from(agentRun)
      .where(eq(agentRun.id, claim.claim.runId))
      .limit(1);

    if (!row) {
      throw new ORPCError("INTERNAL_SERVER_ERROR");
    }

    // `alreadyQueued` tells the client the click was an idempotent no-op (the
    // issue was already claimed); either way the issue is now Executing.
    return {
      run: mapAgentRun(row),
      alreadyQueued: claim.outcome === "already_claimed",
      stage: "executing" as const,
    };
  }),
};
export type AppRouter = typeof appRouter;
export type AppRouterClient = RouterClient<typeof appRouter>;
