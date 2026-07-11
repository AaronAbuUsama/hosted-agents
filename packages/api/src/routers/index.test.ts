import { afterAll, describe, expect, mock, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ORPCError, createProcedureClient } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import type { Context } from "../context";
import type { db as productionDb } from "@hosted-agents/db";
import * as schema from "@hosted-agents/db/schema/index";

const testDatabaseDirectory = mkdtempSync(join(tmpdir(), "artifact-router-test-"));
const databaseUrl = `file:${join(testDatabaseDirectory, "test.sqlite")}`;

process.env.SKIP_ENV_VALIDATION = "true";
process.env.DATABASE_URL = databaseUrl;
process.env.BETTER_AUTH_SECRET = "test-better-auth-secret-32-bytes";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.CORS_ORIGIN = "http://localhost:3000";
process.env.NODE_ENV = "test";

const { privateKey: gitHubAppPrivateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
process.env.GITHUB_APP_ID = "12345";
process.env.GITHUB_APP_SLUG = "hosted-agents-test";
process.env.GITHUB_APP_PRIVATE_KEY = gitHubAppPrivateKey
  .export({ format: "pem", type: "pkcs1" })
  .toString();

let mockedCodexCredentials = {
  accessToken: "synthetic-access-token",
  refreshToken: "synthetic-refresh-token",
  expires: new Date("2026-12-31T00:00:00.000Z").getTime(),
};

mock.module("@earendil-works/pi-ai/oauth", () => ({
  loginOpenAICodexDeviceCode: async ({
    onDeviceCode,
  }: {
    onDeviceCode?: (deviceCode: {
      userCode: string;
      verificationUri: string;
      intervalSeconds: number;
      expiresInSeconds: number;
    }) => void;
  }) => {
    onDeviceCode?.({
      userCode: "TEST-CODEX-CODE",
      verificationUri: "https://example.test/device",
      intervalSeconds: 1,
      expiresInSeconds: 900,
    });

    return mockedCodexCredentials;
  },
}));

type TestDatabase = typeof productionDb;
type TestClient = {
  close(): void;
  executeMultiple(sql: string): Promise<void>;
};

const database = drizzle({ connection: { url: databaseUrl }, schema }) as TestDatabase & {
  $client: TestClient;
};
const client = database.$client;

await createTables(client);

// The router imports the production db/env singletons at module load; this test must
// install its hermetic DATABASE_URL before loading that known module.
const { appRouter } = await import("./index");

const memberContext = (
  userId: string,
  options: { activeOrganizationId?: string | null } = {},
): Context =>
  ({
    auth: null,
    session: {
      user: {
        id: userId,
        name: "Test User",
        email: `${userId}@example.test`,
      },
      session: {
        id: `session-${userId}`,
        userId,
        activeOrganizationId: options.activeOrganizationId ?? null,
      },
    } as Context["session"],
    reviewRunInvoker: async () => ({ flueRunId: "unused-in-artifact-tests" }),
  }) as Context;

const callCreateOrganization = (context: Context) =>
  createProcedureClient(appRouter.createOrganization, {
    context,
  });

const callAgentRunArtifacts = (userId: string) =>
  createProcedureClient(appRouter.agentRunArtifacts, {
    context: memberContext(userId),
  });

async function createTables(testClient: TestClient) {
  await testClient.executeMultiple(`
    CREATE TABLE "user" (
      "id" text PRIMARY KEY,
      "name" text NOT NULL,
      "email" text NOT NULL UNIQUE,
      "username" text UNIQUE,
      "display_username" text,
      "email_verified" integer DEFAULT 0 NOT NULL,
      "image" text,
      "created_at" integer DEFAULT 0 NOT NULL,
      "updated_at" integer DEFAULT 0 NOT NULL
    );

    CREATE TABLE "session" (
      "id" text PRIMARY KEY,
      "expires_at" integer NOT NULL,
      "token" text NOT NULL UNIQUE,
      "created_at" integer DEFAULT 0 NOT NULL,
      "updated_at" integer NOT NULL,
      "ip_address" text,
      "user_agent" text,
      "active_organization_id" text,
      "active_team_id" text,
      "user_id" text NOT NULL
    );

    CREATE TABLE "organization" (
      "id" text PRIMARY KEY,
      "name" text NOT NULL,
      "slug" text NOT NULL UNIQUE,
      "logo" text,
      "metadata" text,
      "created_at" integer DEFAULT 0 NOT NULL
    );

    CREATE TABLE "member" (
      "id" text PRIMARY KEY,
      "user_id" text NOT NULL,
      "organization_id" text NOT NULL,
      "role" text NOT NULL,
      "created_at" integer DEFAULT 0 NOT NULL
    );

    CREATE TABLE "github_installation" (
      "id" text PRIMARY KEY,
      "organization_id" text NOT NULL,
      "installation_id" text NOT NULL UNIQUE,
      "app_slug" text NOT NULL,
      "account_id" text,
      "account_login" text,
      "account_type" text,
      "repository_selection" text,
      "status" text DEFAULT 'connected' NOT NULL,
      "setup_action" text,
      "installed_by_user_id" text,
      "suspended_at" integer,
      "created_at" integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
      "updated_at" integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
    );

    CREATE TABLE "github_repository" (
      "id" text PRIMARY KEY,
      "installation_id" text NOT NULL,
      "github_repository_id" text NOT NULL,
      "owner" text NOT NULL,
      "name" text NOT NULL,
      "full_name" text NOT NULL,
      "html_url" text,
      "default_branch" text,
      "private" integer DEFAULT 0 NOT NULL,
      "selected" integer DEFAULT 1 NOT NULL,
      "created_at" integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
      "updated_at" integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
      UNIQUE ("installation_id", "github_repository_id")
    );

    CREATE TABLE "agent_run" (
      "id" text PRIMARY KEY,
      "organization_id" text NOT NULL,
      "user_id" text NOT NULL,
      "provider_credential_id" text,
      "coworker_slug" text NOT NULL,
      "worker_role" text DEFAULT 'code_review' NOT NULL,
      "worker_display_name" text,
      "run_type" text NOT NULL,
      "source_provider" text NOT NULL,
      "source_delivery_id" text,
      "github_installation_id" text,
      "github_repository_id" text,
      "repository_owner" text,
      "repository_name" text,
      "repository_url" text,
      "branch" text,
      "base_branch" text,
      "issue_number" integer,
      "pull_request_number" integer,
      "pull_request_base_ref" text,
      "pull_request_base_sha" text,
      "pull_request_head_ref" text,
      "pull_request_head_sha" text,
      "status" text DEFAULT 'queued' NOT NULL,
      "model" text,
      "flue_run_id" text,
      "sandbox_provider" text,
      "sandbox_id" text,
      "current_stage" text,
      "last_heartbeat_at" integer,
      "summary" text,
      "findings_json" text,
      "error_message" text,
      "started_at" integer,
      "completed_at" integer,
      "created_at" integer DEFAULT 0 NOT NULL,
      "updated_at" integer DEFAULT 0 NOT NULL
    );

    CREATE TABLE "agent_run_event" (
      "id" text PRIMARY KEY,
      "run_id" text NOT NULL,
      "sequence" integer NOT NULL,
      "category" text NOT NULL,
      "type" text NOT NULL,
      "stage" text,
      "message" text NOT NULL,
      "payload_json" text,
      "flue_event_index" integer,
      "flue_event_type" text,
      "created_at" integer DEFAULT 0 NOT NULL
    );
    CREATE UNIQUE INDEX "agent_run_event_runSequence_idx" ON "agent_run_event" ("run_id","sequence");

    CREATE TABLE "agent_run_artifact" (
      "id" text PRIMARY KEY,
      "run_id" text NOT NULL,
      "name" text NOT NULL,
      "content_type" text NOT NULL,
      "content" text,
      "payload_json" text,
      "created_at" integer DEFAULT 0 NOT NULL
    );

    CREATE TABLE "agent_provider_credential" (
      "id" text PRIMARY KEY,
      "organization_id" text NOT NULL,
      "user_id" text NOT NULL,
      "provider" text NOT NULL,
      "credential_type" text NOT NULL,
      "encrypted_credential" text NOT NULL,
      "expires_at" integer,
      "status" text DEFAULT 'connected' NOT NULL,
      "last_error" text,
      "last_used_at" integer,
      "created_at" integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
      "updated_at" integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
    );

    CREATE TABLE "worker_config" (
      "id" text PRIMARY KEY,
      "organization_id" text NOT NULL,
      "worker_role" text NOT NULL,
      "display_name" text,
      "model" text,
      "reasoning_effort" text,
      "instructions" text,
      "created_at" integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
      "updated_at" integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
    );

    CREATE TABLE "worker_skill" (
      "id" text PRIMARY KEY,
      "organization_id" text NOT NULL,
      "worker_role" text NOT NULL,
      "name" text NOT NULL,
      "description" text,
      "enabled" integer DEFAULT 1 NOT NULL,
      "created_at" integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
      "updated_at" integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
    );

    CREATE TABLE "worker_skill_file" (
      "id" text PRIMARY KEY,
      "skill_id" text NOT NULL,
      "path" text NOT NULL,
      "content" text NOT NULL,
      "created_at" integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
      "updated_at" integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
    );

    CREATE TABLE "github_issue" (
      "id" text PRIMARY KEY,
      "organization_id" text NOT NULL,
      "github_installation_id" text,
      "github_repository_id" text NOT NULL,
      "repository_full_name" text NOT NULL,
      "number" integer NOT NULL,
      "github_issue_id" text,
      "node_id" text,
      "title" text NOT NULL,
      "body" text,
      "state" text DEFAULT 'open' NOT NULL,
      "author_login" text,
      "author_avatar_url" text,
      "labels_json" text DEFAULT '[]' NOT NULL,
      "html_url" text,
      "comment_count" integer DEFAULT 0 NOT NULL,
      "linked_pull_request_number" integer,
      "linked_pull_request_state" text,
      "linked_pull_request_merged" integer,
      "closed_by_merge" integer DEFAULT 0 NOT NULL,
      "claimed_by_worker_role" text,
      "claimed_by_run_id" text,
      "claimed_at" integer,
      "github_created_at" integer,
      "github_updated_at" integer,
      "created_at" integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
      "updated_at" integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
    );
    CREATE UNIQUE INDEX "github_issue_repo_number_idx" ON "github_issue" ("github_repository_id","number");

    CREATE TABLE "github_issue_comment" (
      "id" text PRIMARY KEY,
      "organization_id" text NOT NULL,
      "github_repository_id" text NOT NULL,
      "issue_id" text,
      "issue_number" integer NOT NULL,
      "github_comment_id" text,
      "author_login" text,
      "author_avatar_url" text,
      "author_kind" text DEFAULT 'external' NOT NULL,
      "author_worker_role" text,
      "author_user_id" text,
      "body" text NOT NULL,
      "html_url" text,
      "github_created_at" integer,
      "github_updated_at" integer,
      "created_at" integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL,
      "updated_at" integer DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)) NOT NULL
    );
    CREATE UNIQUE INDEX "github_issue_comment_githubCommentId_idx" ON "github_issue_comment" ("github_comment_id");
  `);
}

async function seedUser(userId: string) {
  await database.insert(schema.user).values({
    id: userId,
    name: `User ${userId}`,
    email: `${userId}@example.test`,
  });
}

async function seedSession(userId: string, activeOrganizationId?: string | null) {
  await database.insert(schema.session).values({
    id: `session-${userId}`,
    token: `token-${userId}`,
    userId,
    activeOrganizationId: activeOrganizationId ?? null,
    expiresAt: new Date("2026-12-31T00:00:00.000Z"),
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  });
}

async function seedOrganization(organizationId: string) {
  await database.insert(schema.organization).values({
    id: organizationId,
    name: `Organization ${organizationId}`,
    slug: organizationId,
  });
}

async function seedMembership(userId: string, organizationId: string, role = "member") {
  await database.insert(schema.member).values({
    id: `member-${userId}-${organizationId}`,
    userId,
    organizationId,
    role,
  });
}

async function seedAgentRun(runId: string, organizationId: string, userId: string) {
  await database.insert(schema.agentRun).values({
    id: runId,
    organizationId,
    userId,
    coworkerSlug: "code-review",
    workerRole: "code_review",
    runType: "github.pull_request_review",
    sourceProvider: "github",
    status: "completed",
  });
}

async function expectOrpcCode(promise: Promise<unknown>, code: string) {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ORPCError);
    expect((error as ORPCError<string, unknown>).code).toBe(code);
    return;
  }

  throw new Error(`Expected ORPC error code ${code}`);
}

async function waitForConnectionStatus(
  context: Context,
  connectionId: string,
  status: "pending" | "connected" | "failed",
) {
  const connectionClient = createProcedureClient(appRouter.openAICodexCredentialConnection, {
    context,
  });

  for (let attempt = 0; attempt < 20; attempt += 1) {
    const connection = await connectionClient({ connectionId });

    if (connection.status === status) {
      return connection;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Connection ${connectionId} did not reach ${status}`);
}

type MockGitHubInstallation = {
  id: number;
  account: {
    id: number;
    login: string;
    type: string;
  };
  repository_selection: string;
  suspended_at: string | null;
};

type MockGitHubRepository = {
  id: number;
  name: string;
  full_name: string;
  html_url: string;
  default_branch: string;
  private: boolean;
  owner: {
    login: string;
  };
};

function createMockGitHubAppFetch({
  installations,
  repositoriesByInstallationId,
}: {
  installations: MockGitHubInstallation[];
  repositoriesByInstallationId: Record<string, MockGitHubRepository[]>;
}) {
  return (async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";

    if (url.pathname === "/app/installations" && method === "GET") {
      return Response.json(installations);
    }

    const installationMatch = url.pathname.match(/^\/app\/installations\/(\d+)$/);
    if (installationMatch && method === "GET") {
      const installation = installations.find(
        (candidate) => String(candidate.id) === installationMatch[1],
      );

      if (!installation) {
        return new Response("installation not found", { status: 404 });
      }

      return Response.json(installation);
    }

    const tokenMatch = url.pathname.match(/^\/app\/installations\/(\d+)\/access_tokens$/);
    if (tokenMatch && method === "POST") {
      return Response.json({ token: `installation-token-${tokenMatch[1]}` });
    }

    if (url.pathname === "/installation/repositories" && method === "GET") {
      const headers = init?.headers as Record<string, string> | undefined;
      const installationId = headers?.authorization?.replace(/^Bearer installation-token-/, "");

      return Response.json({
        repositories: installationId ? (repositoriesByInstallationId[installationId] ?? []) : [],
      });
    }

    return new Response(`unexpected GitHub API request: ${method} ${url.toString()}`, {
      status: 500,
    });
  }) as typeof fetch;
}

afterAll(() => {
  client.close();
  rmSync(testDatabaseDirectory, { recursive: true, force: true });
});

describe("organization router procedures", () => {
  test("rejects createOrganization without an authenticated session", async () => {
    await expectOrpcCode(
      callCreateOrganization({
        auth: null,
        session: null,
        reviewRunInvoker: async () => ({ flueRunId: "unused-in-organization-tests" }),
      } as Context)({ name: "Acme Labs" }),
      "UNAUTHORIZED",
    );
  });

  test("rejects blank organization names before creating rows", async () => {
    await seedUser("org-invalid-user");
    await seedSession("org-invalid-user");

    await expectOrpcCode(
      callCreateOrganization(memberContext("org-invalid-user"))({ name: "   " }),
      "BAD_REQUEST",
    );

    const organizations = await database
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.name, ""));

    expect(organizations).toEqual([]);

    const memberships = await database
      .select()
      .from(schema.member)
      .where(eq(schema.member.userId, "org-invalid-user"));
    expect(memberships).toEqual([]);
  });

  test("creates an organization, owner membership, and active session organization", async () => {
    await seedUser("org-create-user");
    await seedSession("org-create-user");
    const context = memberContext("org-create-user");

    const organization = await callCreateOrganization(context)({ name: "  Acme   Labs  " });

    expect(organization).toEqual({
      id: expect.any(String),
      name: "Acme Labs",
      slug: "acme-labs",
      role: "owner",
    });

    const [persistedOrganization] = await database
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.id, organization.id));
    expect(persistedOrganization).toMatchObject({
      id: organization.id,
      name: "Acme Labs",
      slug: "acme-labs",
    });

    const [persistedMember] = await database
      .select()
      .from(schema.member)
      .where(eq(schema.member.organizationId, organization.id));
    expect(persistedMember).toMatchObject({
      userId: "org-create-user",
      organizationId: organization.id,
      role: "owner",
    });

    const [persistedSession] = await database
      .select()
      .from(schema.session)
      .where(eq(schema.session.id, "session-org-create-user"));
    expect(persistedSession?.activeOrganizationId).toBe(organization.id);
    expect(context.session?.session.activeOrganizationId).toBe(organization.id);
  });

  test("activeOrganization resolves the member organization and persists fallback active org", async () => {
    await seedUser("org-active-user");
    await seedSession("org-active-user");
    await seedOrganization("org-active-target");
    await seedMembership("org-active-user", "org-active-target");
    const context = memberContext("org-active-user");

    const activeOrganization = await createProcedureClient(appRouter.activeOrganization, {
      context,
    })();
    const expectedActiveOrganization = {
      id: "org-active-target",
      name: "Organization org-active-target",
      slug: "org-active-target",
      role: "member",
    };

    expect(activeOrganization).toEqual(expectedActiveOrganization);

    const organizationSummary = await createProcedureClient(appRouter.organizations, {
      context,
    })();
    expect(organizationSummary).toEqual({
      organizations: [expectedActiveOrganization],
      activeOrganization: expectedActiveOrganization,
    });

    const [persistedSession] = await database
      .select()
      .from(schema.session)
      .where(eq(schema.session.id, "session-org-active-user"));
    expect(persistedSession?.activeOrganizationId).toBe("org-active-target");
    expect(context.session?.session.activeOrganizationId).toBe("org-active-target");
  });

  test("retries with the same normalized name return existing membership without duplicates", async () => {
    await seedUser("org-retry-user");
    await seedSession("org-retry-user");
    const context = memberContext("org-retry-user");

    const firstOrganization = await callCreateOrganization(context)({ name: "  Retry   Team " });
    const retriedOrganization = await callCreateOrganization(context)({ name: "Retry Team" });

    expect(retriedOrganization).toEqual(firstOrganization);

    const organizations = await database
      .select()
      .from(schema.organization)
      .where(eq(schema.organization.name, "Retry Team"));
    expect(organizations).toHaveLength(1);

    const memberships = await database
      .select()
      .from(schema.member)
      .where(eq(schema.member.userId, "org-retry-user"));
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({
      organizationId: firstOrganization.id,
      role: "owner",
    });
  });
});

describe("GitHub App router procedures", () => {
  test("githubAppInstallUrl uses the active organization as install state", async () => {
    await seedUser("github-install-url-user");
    await seedSession("github-install-url-user", "github-install-url-org");
    await seedOrganization("github-install-url-org");
    await seedMembership("github-install-url-user", "github-install-url-org", "owner");

    const result = await createProcedureClient(appRouter.githubAppInstallUrl, {
      context: memberContext("github-install-url-user", {
        activeOrganizationId: "github-install-url-org",
      }),
    })({});

    expect(result.configured).toBe(true);
    const installUrl = new URL(result.installUrl ?? "");
    expect(installUrl.origin).toBe("https://github.com");
    expect(installUrl.pathname).toBe("/apps/hosted-agents-test/installations/new");
    expect(installUrl.searchParams.get("state")).toBe("github-install-url-org");
  });

  test("claimGitHubInstallation persists installation repositories and lists them for the active organization", async () => {
    await seedUser("github-claim-user");
    await seedSession("github-claim-user", "github-claim-org");
    await seedOrganization("github-claim-org");
    await seedMembership("github-claim-user", "github-claim-org", "owner");
    const context = memberContext("github-claim-user", {
      activeOrganizationId: "github-claim-org",
    });
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input, init) => {
      const url = String(input);
      const method = init?.method ?? "GET";

      if (url === "https://api.github.com/app/installations/98765" && method === "GET") {
        return Response.json({
          id: 98765,
          account: {
            id: 12345,
            login: "acme-labs",
            type: "Organization",
          },
          repository_selection: "selected",
          suspended_at: null,
        });
      }

      if (
        url === "https://api.github.com/app/installations/98765/access_tokens" &&
        method === "POST"
      ) {
        return Response.json({ token: "installation-access-token" });
      }

      if (
        url === "https://api.github.com/installation/repositories?per_page=100" &&
        method === "GET"
      ) {
        return Response.json({
          repositories: [
            {
              id: 111,
              name: "alpha",
              full_name: "acme-labs/alpha",
              html_url: "https://github.com/acme-labs/alpha",
              default_branch: "main",
              private: false,
              owner: { login: "acme-labs" },
            },
            {
              id: 222,
              name: "private-tools",
              full_name: "acme-labs/private-tools",
              html_url: "https://github.com/acme-labs/private-tools",
              default_branch: "trunk",
              private: true,
              owner: { login: "acme-labs" },
            },
          ],
        });
      }

      return new Response(`unexpected GitHub API request: ${method} ${url}`, { status: 500 });
    }) as typeof fetch;

    try {
      const claimResult = await createProcedureClient(appRouter.claimGitHubInstallation, {
        context,
      })({
        installationId: "98765",
        setupAction: "install",
      });

      expect(claimResult).toEqual({
        installationId: "98765",
        repositoryCount: 2,
      });

      const installations = await createProcedureClient(appRouter.githubInstallations, {
        context,
      })({});

      expect(installations).toHaveLength(1);
      expect(installations[0]).toMatchObject({
        organizationId: "github-claim-org",
        installationId: "98765",
        appSlug: "hosted-agents-test",
        // Server-resolved role lets non-admin members (who cannot call the
        // admin-gated githubCoderAppInstallUrl) still classify the reviewer app.
        workerRole: "code_review",
        accountId: "12345",
        accountLogin: "acme-labs",
        accountType: "Organization",
        repositorySelection: "selected",
        status: "connected",
        setupAction: "install",
        installedByUserId: "github-claim-user",
        suspendedAt: null,
        repositoryCount: 2,
      });

      const repositories = [...installations[0]!.repositories].sort((left, right) =>
        left.fullName.localeCompare(right.fullName),
      );
      expect(repositories).toEqual([
        expect.objectContaining({
          githubRepositoryId: "111",
          owner: "acme-labs",
          name: "alpha",
          fullName: "acme-labs/alpha",
          htmlUrl: "https://github.com/acme-labs/alpha",
          defaultBranch: "main",
          private: false,
          selected: true,
        }),
        expect.objectContaining({
          githubRepositoryId: "222",
          owner: "acme-labs",
          name: "private-tools",
          fullName: "acme-labs/private-tools",
          htmlUrl: "https://github.com/acme-labs/private-tools",
          defaultBranch: "trunk",
          private: true,
          selected: true,
        }),
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("availableGitHubInstallations lists personal and organization installs that are not locally linked yet", async () => {
    await seedUser("github-available-user");
    await seedSession("github-available-user", "github-available-org");
    await seedOrganization("github-available-org");
    await seedMembership("github-available-user", "github-available-org", "owner");
    const context = memberContext("github-available-user", {
      activeOrganizationId: "github-available-org",
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = createMockGitHubAppFetch({
      installations: [
        {
          id: 101,
          account: { id: 1001, login: "AaronAbuUsama", type: "User" },
          repository_selection: "selected",
          suspended_at: null,
        },
        {
          id: 202,
          account: { id: 2002, login: "Xelmar-tech", type: "Organization" },
          repository_selection: "selected",
          suspended_at: null,
        },
      ],
      repositoriesByInstallationId: {
        "101": [
          {
            id: 10101,
            name: "personal-repo",
            full_name: "AaronAbuUsama/personal-repo",
            html_url: "https://github.com/AaronAbuUsama/personal-repo",
            default_branch: "main",
            private: false,
            owner: { login: "AaronAbuUsama" },
          },
        ],
        "202": [
          {
            id: 20201,
            name: "org-repo",
            full_name: "Xelmar-tech/org-repo",
            html_url: "https://github.com/Xelmar-tech/org-repo",
            default_branch: "main",
            private: true,
            owner: { login: "Xelmar-tech" },
          },
        ],
      },
    });

    try {
      const result = await createProcedureClient(appRouter.availableGitHubInstallations, {
        context,
      })({});

      expect(result.configured).toBe(true);
      expect(result.installations).toEqual([
        expect.objectContaining({
          installationId: "101",
          accountLogin: "AaronAbuUsama",
          accountType: "User",
          linkStatus: "available",
          repositoryCount: 1,
        }),
        expect.objectContaining({
          installationId: "202",
          accountLogin: "Xelmar-tech",
          accountType: "Organization",
          linkStatus: "available",
          repositoryCount: 1,
        }),
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("claimGitHubInstallation can link personal and organization installs into the same Coworker organization", async () => {
    await seedUser("github-multi-link-user");
    await seedSession("github-multi-link-user", "github-multi-link-org");
    await seedOrganization("github-multi-link-org");
    await seedMembership("github-multi-link-user", "github-multi-link-org", "owner");
    const context = memberContext("github-multi-link-user", {
      activeOrganizationId: "github-multi-link-org",
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = createMockGitHubAppFetch({
      installations: [
        {
          id: 303,
          account: { id: 3003, login: "AaronAbuUsama", type: "User" },
          repository_selection: "selected",
          suspended_at: null,
        },
        {
          id: 404,
          account: { id: 4004, login: "Xelmar-tech", type: "Organization" },
          repository_selection: "selected",
          suspended_at: null,
        },
      ],
      repositoriesByInstallationId: {
        "303": [
          {
            id: 30301,
            name: "personal-alpha",
            full_name: "AaronAbuUsama/personal-alpha",
            html_url: "https://github.com/AaronAbuUsama/personal-alpha",
            default_branch: "main",
            private: false,
            owner: { login: "AaronAbuUsama" },
          },
        ],
        "404": [
          {
            id: 40401,
            name: "org-alpha",
            full_name: "Xelmar-tech/org-alpha",
            html_url: "https://github.com/Xelmar-tech/org-alpha",
            default_branch: "trunk",
            private: true,
            owner: { login: "Xelmar-tech" },
          },
        ],
      },
    });

    try {
      const claim = createProcedureClient(appRouter.claimGitHubInstallation, {
        context,
      });

      await expect(
        claim({ installationId: "303", setupAction: "manual_link" }),
      ).resolves.toMatchObject({
        installationId: "303",
        repositoryCount: 1,
      });
      await expect(
        claim({ installationId: "404", setupAction: "manual_link" }),
      ).resolves.toMatchObject({
        installationId: "404",
        repositoryCount: 1,
      });

      const linkedInstallations = await createProcedureClient(appRouter.githubInstallations, {
        context,
      })({});
      const linkedAccounts = linkedInstallations.map((installation) => installation.accountLogin);

      expect(linkedInstallations).toHaveLength(2);
      expect(linkedAccounts).toContain("AaronAbuUsama");
      expect(linkedAccounts).toContain("Xelmar-tech");

      const available = await createProcedureClient(appRouter.availableGitHubInstallations, {
        context,
      })({});
      expect(available.installations).toEqual([
        expect.objectContaining({
          installationId: "303",
          linkStatus: "linked",
          localInstallationId: expect.any(String),
        }),
        expect.objectContaining({
          installationId: "404",
          linkStatus: "linked",
          localInstallationId: expect.any(String),
        }),
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("claimGitHubInstallation sync removes repositories no longer selected on GitHub", async () => {
    await seedUser("github-sync-user");
    await seedSession("github-sync-user", "github-sync-org");
    await seedOrganization("github-sync-org");
    await seedMembership("github-sync-user", "github-sync-org", "owner");
    const context = memberContext("github-sync-user", {
      activeOrganizationId: "github-sync-org",
    });
    const repositoriesByInstallationId: Record<string, MockGitHubRepository[]> = {
      "505": [
        {
          id: 50501,
          name: "kept-repo",
          full_name: "Xelmar-tech/kept-repo",
          html_url: "https://github.com/Xelmar-tech/kept-repo",
          default_branch: "main",
          private: true,
          owner: { login: "Xelmar-tech" },
        },
        {
          id: 50502,
          name: "removed-repo",
          full_name: "Xelmar-tech/removed-repo",
          html_url: "https://github.com/Xelmar-tech/removed-repo",
          default_branch: "main",
          private: true,
          owner: { login: "Xelmar-tech" },
        },
      ],
    };
    const originalFetch = globalThis.fetch;
    globalThis.fetch = createMockGitHubAppFetch({
      installations: [
        {
          id: 505,
          account: { id: 5005, login: "Xelmar-tech", type: "Organization" },
          repository_selection: "selected",
          suspended_at: null,
        },
      ],
      repositoriesByInstallationId,
    });

    try {
      const claim = createProcedureClient(appRouter.claimGitHubInstallation, {
        context,
      });

      await claim({ installationId: "505", setupAction: "manual_link" });
      repositoriesByInstallationId["505"] = [repositoriesByInstallationId["505"]![0]!];
      await claim({ installationId: "505", setupAction: "sync" });

      const linkedInstallations = await createProcedureClient(appRouter.githubInstallations, {
        context,
      })({});
      expect(linkedInstallations).toHaveLength(1);
      expect(linkedInstallations[0]?.repositoryCount).toBe(1);
      expect(linkedInstallations[0]?.repositories).toEqual([
        expect.objectContaining({
          fullName: "Xelmar-tech/kept-repo",
        }),
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("claimGitHubInstallation rejects an explicit organization outside the user's memberships", async () => {
    await seedUser("github-cross-org-user");
    await seedSession("github-cross-org-user", "github-cross-org-owned");
    await seedOrganization("github-cross-org-owned");
    await seedOrganization("github-cross-org-outside");
    await seedMembership("github-cross-org-user", "github-cross-org-owned", "owner");
    const context = memberContext("github-cross-org-user", {
      activeOrganizationId: "github-cross-org-owned",
    });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async () => {
      throw new Error("GitHub API should not be called for a forbidden organization.");
    }) as unknown as typeof fetch;

    try {
      await expectOrpcCode(
        createProcedureClient(appRouter.claimGitHubInstallation, {
          context,
        })({
          installationId: "112233",
          organizationId: "github-cross-org-outside",
        }),
        "FORBIDDEN",
      );
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("listRepositoryIssues router procedure", () => {
  // Seed a connected installation + selected repository the board can read, then
  // let each test control the GitHub App HTTP responses.
  async function seedRepository(options: {
    slug: string;
    installationId: string;
    owner?: string;
    name?: string;
  }) {
    const { slug, installationId } = options;
    const owner = options.owner ?? "acme";
    const name = options.name ?? "widgets";
    await seedUser(`${slug}-user`);
    await seedSession(`${slug}-user`, `${slug}-org`);
    await seedOrganization(`${slug}-org`);
    await seedMembership(`${slug}-user`, `${slug}-org`, "owner");
    await database.insert(schema.githubInstallation).values({
      id: `${slug}-installation`,
      organizationId: `${slug}-org`,
      installationId,
      appSlug: "hosted-agents-test",
      accountLogin: owner,
      accountType: "Organization",
      status: "connected",
    });
    await database.insert(schema.githubRepository).values({
      id: `${slug}-repository`,
      installationId: `${slug}-installation`,
      githubRepositoryId: `${slug}-github-id`,
      owner,
      name,
      fullName: `${owner}/${name}`,
      selected: true,
    });
    return {
      context: memberContext(`${slug}-user`, { activeOrganizationId: `${slug}-org` }),
      repositoryId: `${slug}-repository`,
      organizationId: `${slug}-org`,
      owner,
      name,
    };
  }

  // Stub the two GitHub calls the board makes: mint the installation token (with the
  // given `permissions`) and GET the shared issues endpoint (returns `issuesResponse`).
  function stubBoardFetch(options: {
    installationId: string;
    permissions?: Record<string, string> | null;
    issuesResponse: unknown[];
  }) {
    return (async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";

      if (
        url.pathname === `/app/installations/${options.installationId}/access_tokens` &&
        method === "POST"
      ) {
        const body: Record<string, unknown> = { token: "installation-access-token" };
        if (options.permissions !== undefined) {
          body.permissions = options.permissions;
        }
        return Response.json(body);
      }

      if (/^\/repos\/[^/]+\/[^/]+\/issues$/.test(url.pathname) && method === "GET") {
        return Response.json(options.issuesResponse);
      }

      return new Response(`unexpected GitHub API request: ${method} ${url.toString()}`, {
        status: 500,
      });
    }) as typeof fetch;
  }

  test("surfaces the named Issues-access failure when the installation lacks issues:read but has pull_requests:read", async () => {
    // The documented silent failure (memory: issues-board-github-app-permission):
    // GET /issues answers 200 with only PRs, which the filter empties. The board
    // must instead name the cause so its client error branch shows the fix CTA.
    const seeded = await seedRepository({ slug: "board-forbidden", installationId: "701" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubBoardFetch({
      installationId: "701",
      permissions: { pull_requests: "read", metadata: "read" },
      issuesResponse: [{ number: 8, title: "A PR", state: "open", pull_request: { url: "…" } }],
    });

    try {
      const call = createProcedureClient(appRouter.listRepositoryIssues, {
        context: seeded.context,
      })({ organizationId: seeded.organizationId, repositoryId: seeded.repositoryId });

      await expectOrpcCode(call, "BAD_REQUEST");
      // The message the client (apps/web board-load-error) keys off to render the
      // Issues-access copy + fix CTA rather than a generic "couldn't load" state.
      await call.catch((error: unknown) => {
        expect((error as ORPCError<string, unknown>).message.toLowerCase()).toContain(
          "resource not accessible by integration",
        );
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("returns the board with pull requests filtered out when the installation has Issues access", async () => {
    const seeded = await seedRepository({ slug: "board-ok", installationId: "702" });
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubBoardFetch({
      installationId: "702",
      permissions: { issues: "read", pull_requests: "read" },
      issuesResponse: [
        { number: 7, title: "A real issue", state: "open", labels: [] },
        { number: 8, title: "A PR", state: "open", pull_request: { url: "…" } },
      ],
    });

    try {
      const board = await createProcedureClient(appRouter.listRepositoryIssues, {
        context: seeded.context,
      })({ organizationId: seeded.organizationId, repositoryId: seeded.repositoryId });

      const allIssues = board.flatMap((columnEntry) => columnEntry.issues.map((i) => i.number));
      expect(allIssues).toEqual([7]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("reflects stored claim + linked-PR state in the Executing and In PR lanes", async () => {
    // Two ready-for-agent issues come live from GitHub; the store overlay says one
    // is claimed (→ Executing) and one has an open linked PR (→ In PR). The board
    // must move both out of Ready for agent into the lanes their stored state
    // dictates — the store, not the label, decides once work has been picked up.
    const seeded = await seedRepository({ slug: "board-overlay", installationId: "703" });
    await database.insert(schema.githubIssue).values([
      {
        id: "overlay-issue-claimed",
        organizationId: seeded.organizationId,
        githubRepositoryId: seeded.repositoryId,
        repositoryFullName: `${seeded.owner}/${seeded.name}`,
        number: 11,
        title: "Claimed issue",
        claimedByRunId: "run-11",
        claimedByWorkerRole: "implementation",
      },
      {
        id: "overlay-issue-in-pr",
        organizationId: seeded.organizationId,
        githubRepositoryId: seeded.repositoryId,
        repositoryFullName: `${seeded.owner}/${seeded.name}`,
        number: 12,
        title: "In-PR issue",
        linkedPullRequestNumber: 40,
        linkedPullRequestState: "open",
        linkedPullRequestMerged: false,
      },
    ]);

    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubBoardFetch({
      installationId: "703",
      permissions: { issues: "read" },
      issuesResponse: [
        {
          number: 11,
          title: "Claimed issue",
          state: "open",
          labels: [{ name: "ready for agent" }],
        },
        { number: 12, title: "In-PR issue", state: "open", labels: [{ name: "ready for agent" }] },
      ],
    });

    try {
      const board = await createProcedureClient(appRouter.listRepositoryIssues, {
        context: seeded.context,
      })({ organizationId: seeded.organizationId, repositoryId: seeded.repositoryId });

      const lane = (stage: string) =>
        board.find((columnEntry) => columnEntry.stage === stage)?.issues.map((i) => i.number) ?? [];

      expect(lane("ready_for_agent")).toEqual([]);
      expect(lane("executing")).toEqual([11]);
      expect(lane("in_pr")).toEqual([12]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("getRepositoryIssue router procedure", () => {
  async function seedRepository(slug: string, installationId: string) {
    const owner = "acme";
    const name = "widgets";
    await seedUser(`${slug}-user`);
    await seedSession(`${slug}-user`, `${slug}-org`);
    await seedOrganization(`${slug}-org`);
    await seedMembership(`${slug}-user`, `${slug}-org`, "owner");
    await database.insert(schema.githubInstallation).values({
      id: `${slug}-installation`,
      organizationId: `${slug}-org`,
      installationId,
      appSlug: "hosted-agents-test",
      accountLogin: owner,
      accountType: "Organization",
      status: "connected",
    });
    await database.insert(schema.githubRepository).values({
      id: `${slug}-repository`,
      installationId: `${slug}-installation`,
      githubRepositoryId: `${slug}-github-id`,
      owner,
      name,
      fullName: `${owner}/${name}`,
      selected: true,
    });
    return {
      context: memberContext(`${slug}-user`, { activeOrganizationId: `${slug}-org` }),
      repositoryId: `${slug}-repository`,
      organizationId: `${slug}-org`,
      owner,
      name,
    };
  }

  // Stub the three GitHub calls the detail makes: mint the token, GET the issue,
  // GET its comments.
  function stubIssueFetch(options: {
    installationId: string;
    issueNumber: number;
    issue: Record<string, unknown>;
    comments?: unknown[];
  }) {
    return (async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";

      if (
        url.pathname === `/app/installations/${options.installationId}/access_tokens` &&
        method === "POST"
      ) {
        return Response.json({ token: "installation-access-token" });
      }
      if (
        url.pathname === `/repos/acme/widgets/issues/${options.issueNumber}` &&
        method === "GET"
      ) {
        return Response.json(options.issue);
      }
      if (
        url.pathname === `/repos/acme/widgets/issues/${options.issueNumber}/comments` &&
        method === "GET"
      ) {
        return Response.json(options.comments ?? []);
      }
      return new Response(`unexpected GitHub API request: ${method} ${url.toString()}`, {
        status: 500,
      });
    }) as typeof fetch;
  }

  test("derives the stage from the store overlay so a claimed issue reads as Executing", async () => {
    const seeded = await seedRepository("detail-overlay", "704");
    await database.insert(schema.githubIssue).values({
      id: "detail-overlay-issue",
      organizationId: seeded.organizationId,
      githubRepositoryId: seeded.repositoryId,
      repositoryFullName: `${seeded.owner}/${seeded.name}`,
      number: 21,
      title: "Claimed detail issue",
      claimedByRunId: "run-21",
      claimedByWorkerRole: "implementation",
    });

    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubIssueFetch({
      installationId: "704",
      issueNumber: 21,
      issue: {
        number: 21,
        title: "Claimed detail issue",
        state: "open",
        labels: [{ name: "ready for agent" }],
      },
    });

    try {
      const detail = await createProcedureClient(appRouter.getRepositoryIssue, {
        context: seeded.context,
      })({
        organizationId: seeded.organizationId,
        repositoryId: seeded.repositoryId,
        issueNumber: 21,
      });

      // Live labels say "ready for agent", but the store says it is claimed, so the
      // detail's stage is Executing — matching the board lane, and the kick-off
      // affordance is no longer offered.
      expect(detail.stage).toBe("executing");
      expect(detail.claimable).toBe(false);
      expect(detail.issue.number).toBe(21);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("kickOffIssue router procedure", () => {
  // Seed a connected installation + selected repository the owner can kick off on.
  // owner/name are acme/widgets so the stubbed issue endpoint path matches.
  async function seedRepository(slug: string, installationId: string) {
    const owner = "acme";
    const name = "widgets";
    await seedUser(`${slug}-user`);
    await seedSession(`${slug}-user`, `${slug}-org`);
    await seedOrganization(`${slug}-org`);
    await seedMembership(`${slug}-user`, `${slug}-org`, "owner");
    await database.insert(schema.githubInstallation).values({
      id: `${slug}-installation`,
      organizationId: `${slug}-org`,
      installationId,
      appSlug: "hosted-agents-test",
      accountLogin: owner,
      accountType: "Organization",
      status: "connected",
    });
    await database.insert(schema.githubRepository).values({
      id: `${slug}-repository`,
      installationId: `${slug}-installation`,
      githubRepositoryId: `${slug}-github-id`,
      owner,
      name,
      fullName: `${owner}/${name}`,
      defaultBranch: "main",
      selected: true,
    });
    return {
      context: memberContext(`${slug}-user`, { activeOrganizationId: `${slug}-org` }),
      repositoryId: `${slug}-repository`,
      organizationId: `${slug}-org`,
      owner,
      name,
    };
  }

  // Stub the two GitHub calls kick-off makes: mint the installation token and GET
  // the issue it is kicking off.
  function stubKickOffFetch(options: {
    installationId: string;
    issueNumber: number;
    issue: Record<string, unknown>;
  }) {
    return (async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";

      if (
        url.pathname === `/app/installations/${options.installationId}/access_tokens` &&
        method === "POST"
      ) {
        return Response.json({ token: "installation-access-token" });
      }
      if (
        url.pathname === `/repos/acme/widgets/issues/${options.issueNumber}` &&
        method === "GET"
      ) {
        return Response.json(options.issue);
      }
      // The detail transport (getRepositoryIssue) also reads comments; kick-off
      // itself does not, but the test re-reads the detail to confirm Executing.
      if (
        url.pathname === `/repos/acme/widgets/issues/${options.issueNumber}/comments` &&
        method === "GET"
      ) {
        return Response.json([]);
      }
      return new Response(`unexpected GitHub API request: ${method} ${url.toString()}`, {
        status: 500,
      });
    }) as typeof fetch;
  }

  const readyIssue = (issueNumber: number) => ({
    number: issueNumber,
    title: "Ready issue",
    state: "open",
    labels: [{ name: "ready for agent" }],
  });

  async function runsForRepository(repositoryId: string) {
    return database
      .select()
      .from(schema.agentRun)
      .where(eq(schema.agentRun.githubRepositoryId, repositoryId));
  }

  test("claims the issue, queues exactly one implementation run, and moves it to Executing", async () => {
    const seeded = await seedRepository("kickoff-ok", "801");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubKickOffFetch({
      installationId: "801",
      issueNumber: 5,
      issue: readyIssue(5),
    });

    try {
      const result = await createProcedureClient(appRouter.kickOffIssue, {
        context: seeded.context,
      })({
        organizationId: seeded.organizationId,
        repositoryId: seeded.repositoryId,
        issueNumber: 5,
      });

      expect(result.alreadyQueued).toBe(false);
      expect(result.stage).toBe("executing");
      expect(result.run.runType).toBe("github.issue_implementation");
      expect(result.run.workerRole).toBe("implementation");
      expect(result.run.status).toBe("queued");
      expect(result.run.issueNumber).toBe(5);

      // Exactly one queued run for this repository.
      const runs = await runsForRepository(seeded.repositoryId);
      expect(runs).toHaveLength(1);
      expect(runs[0]?.id).toBe(result.run.id);
      expect(runs[0]?.baseBranch).toBe("main");

      // The issue row is claimed by that run (Executing lane bookkeeping).
      const [claimed] = await database
        .select()
        .from(schema.githubIssue)
        .where(
          and(
            eq(schema.githubIssue.githubRepositoryId, seeded.repositoryId),
            eq(schema.githubIssue.number, 5),
          ),
        )
        .limit(1);
      expect(claimed?.claimedByRunId).toBe(result.run.id);
      expect(claimed?.claimedByWorkerRole).toBe("implementation");

      // The detail transport now reads the issue as claimed → Executing, not claimable.
      const detail = await createProcedureClient(appRouter.getRepositoryIssue, {
        context: seeded.context,
      })({
        organizationId: seeded.organizationId,
        repositoryId: seeded.repositoryId,
        issueNumber: 5,
      });
      expect(detail.stage).toBe("executing");
      expect(detail.claimable).toBe(false);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("a second kick-off while claimed is an idempotent no-op returning the existing run", async () => {
    const seeded = await seedRepository("kickoff-idempotent", "802");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubKickOffFetch({
      installationId: "802",
      issueNumber: 9,
      issue: readyIssue(9),
    });

    try {
      const call = () =>
        createProcedureClient(appRouter.kickOffIssue, { context: seeded.context })({
          organizationId: seeded.organizationId,
          repositoryId: seeded.repositoryId,
          issueNumber: 9,
        });

      const first = await call();
      const second = await call();

      expect(first.alreadyQueued).toBe(false);
      expect(second.alreadyQueued).toBe(true);
      // Same run — the double kick-off did not double-claim or double-queue.
      expect(second.run.id).toBe(first.run.id);

      const runs = await runsForRepository(seeded.repositoryId);
      expect(runs).toHaveLength(1);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects an issue that is not labelled ready for an agent", async () => {
    const seeded = await seedRepository("kickoff-not-ready", "803");
    const originalFetch = globalThis.fetch;
    globalThis.fetch = stubKickOffFetch({
      installationId: "803",
      issueNumber: 3,
      issue: { number: 3, title: "Backlog issue", state: "open", labels: [] },
    });

    try {
      const call = createProcedureClient(appRouter.kickOffIssue, { context: seeded.context })({
        organizationId: seeded.organizationId,
        repositoryId: seeded.repositoryId,
        issueNumber: 3,
      });

      await expectOrpcCode(call, "BAD_REQUEST");
      // Nothing was claimed or queued for a non-ready issue.
      const runs = await runsForRepository(seeded.repositoryId);
      expect(runs).toHaveLength(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  test("rejects a caller who cannot manage the organization", async () => {
    // A plain member (not owner/admin) is a member of the org but may not spend a
    // run — the transport rejects the kick-off before any GitHub call.
    const seeded = await seedRepository("kickoff-forbidden", "804");
    await seedUser("kickoff-forbidden-member");
    await seedSession("kickoff-forbidden-member", "kickoff-forbidden-org");
    await seedMembership("kickoff-forbidden-member", "kickoff-forbidden-org", "member");

    const call = createProcedureClient(appRouter.kickOffIssue, {
      context: memberContext("kickoff-forbidden-member", {
        activeOrganizationId: "kickoff-forbidden-org",
      }),
    })({
      organizationId: seeded.organizationId,
      repositoryId: seeded.repositoryId,
      issueNumber: 1,
    });

    await expectOrpcCode(call, "FORBIDDEN");
    const runs = await runsForRepository(seeded.repositoryId);
    expect(runs).toHaveLength(0);
  });
});

describe("provider credential router procedures", () => {
  test("owner can list organization provider credential metadata without secret fields", async () => {
    await seedUser("provider-list-owner");
    await seedSession("provider-list-owner", "provider-list-org");
    await seedOrganization("provider-list-org");
    await seedMembership("provider-list-owner", "provider-list-org", "owner");
    await database.insert(schema.agentProviderCredential).values({
      id: "provider-list-credential",
      organizationId: "provider-list-org",
      userId: "provider-list-owner",
      provider: "openai-codex",
      credentialType: "oauth",
      encryptedCredential: "encrypted-synthetic-token-payload",
      expiresAt: new Date("2026-12-31T00:00:00.000Z"),
      status: "connected",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });

    const credentials = await createProcedureClient(appRouter.providerCredentials, {
      context: memberContext("provider-list-owner", {
        activeOrganizationId: "provider-list-org",
      }),
    })({});

    expect(credentials).toEqual([
      {
        id: "provider-list-credential",
        organizationId: "provider-list-org",
        userId: "provider-list-owner",
        provider: "openai-codex",
        credentialType: "oauth",
        status: "connected",
        expiresAt: "2026-12-31T00:00:00.000Z",
        lastError: null,
        lastUsedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
    const serialized = JSON.stringify(credentials);
    expect(serialized).not.toContain("encryptedCredential");
    expect(serialized).not.toContain("encrypted-synthetic-token-payload");
    expect(serialized).not.toContain("access_token");
    expect(serialized).not.toContain("refresh_token");
    expect(serialized).not.toContain("api_key");
    expect(serialized).not.toContain("TEST-CODEX-CODE");
  });

  test("wrong-org access cannot list or revoke provider credentials", async () => {
    await seedUser("provider-wrong-org-user");
    await seedSession("provider-wrong-org-user", "provider-wrong-org-owned");
    await seedOrganization("provider-wrong-org-owned");
    await seedOrganization("provider-wrong-org-outside");
    await seedMembership("provider-wrong-org-user", "provider-wrong-org-owned", "owner");
    await database.insert(schema.agentProviderCredential).values({
      id: "provider-wrong-org-credential",
      organizationId: "provider-wrong-org-outside",
      userId: "provider-wrong-org-user",
      provider: "openai-codex",
      credentialType: "oauth",
      encryptedCredential: "encrypted-outside-org-payload",
      status: "connected",
    });
    const context = memberContext("provider-wrong-org-user", {
      activeOrganizationId: "provider-wrong-org-owned",
    });

    await expectOrpcCode(
      createProcedureClient(appRouter.providerCredentials, {
        context,
      })({ organizationId: "provider-wrong-org-outside" }),
      "FORBIDDEN",
    );

    await expectOrpcCode(
      createProcedureClient(appRouter.revokeProviderCredential, {
        context,
      })({
        id: "provider-wrong-org-credential",
        organizationId: "provider-wrong-org-outside",
      }),
      "FORBIDDEN",
    );
  });

  test("non-admin organization members cannot start or revoke provider credentials", async () => {
    await seedUser("provider-member-user");
    await seedSession("provider-member-user", "provider-member-org");
    await seedOrganization("provider-member-org");
    await seedMembership("provider-member-user", "provider-member-org", "member");
    await database.insert(schema.agentProviderCredential).values({
      id: "provider-member-credential",
      organizationId: "provider-member-org",
      userId: "provider-member-user",
      provider: "openai-codex",
      credentialType: "oauth",
      encryptedCredential: "encrypted-member-payload",
      status: "connected",
    });
    const context = memberContext("provider-member-user", {
      activeOrganizationId: "provider-member-org",
    });

    await expectOrpcCode(
      createProcedureClient(appRouter.startOpenAICodexCredentialConnection, {
        context,
      })({}),
      "FORBIDDEN",
    );

    await expectOrpcCode(
      createProcedureClient(appRouter.revokeProviderCredential, {
        context,
      })({ id: "provider-member-credential" }),
      "FORBIDDEN",
    );
  });

  test("starting a connection without an active or selectable organization returns BAD_REQUEST", async () => {
    await seedUser("provider-no-org-user");
    await seedSession("provider-no-org-user");

    await expectOrpcCode(
      createProcedureClient(appRouter.startOpenAICodexCredentialConnection, {
        context: memberContext("provider-no-org-user"),
      })({}),
      "BAD_REQUEST",
    );
  });

  test("mocked device-flow success stores encrypted credentials and replaces prior connected rows", async () => {
    mockedCodexCredentials = {
      accessToken: "synthetic-access-token-rotation",
      refreshToken: "synthetic-refresh-token-rotation",
      expires: new Date("2027-01-01T00:00:00.000Z").getTime(),
    };
    await seedUser("provider-connect-owner");
    await seedSession("provider-connect-owner", "provider-connect-org");
    await seedOrganization("provider-connect-org");
    await seedMembership("provider-connect-owner", "provider-connect-org", "owner");
    await database.insert(schema.agentProviderCredential).values({
      id: "provider-connect-prior",
      organizationId: "provider-connect-org",
      userId: "provider-connect-owner",
      provider: "openai-codex",
      credentialType: "oauth",
      encryptedCredential: "encrypted-prior-payload",
      status: "connected",
    });
    const context = memberContext("provider-connect-owner", {
      activeOrganizationId: "provider-connect-org",
    });

    const pendingConnection = await createProcedureClient(
      appRouter.startOpenAICodexCredentialConnection,
      {
        context,
      },
    )({});

    expect(pendingConnection).toMatchObject({
      organizationId: "provider-connect-org",
      status: "pending",
      deviceCode: {
        userCode: "TEST-CODEX-CODE",
        verificationUri: "https://example.test/device",
        intervalSeconds: 1,
        expiresInSeconds: 900,
      },
    });

    const connection = await waitForConnectionStatus(context, pendingConnection.id, "connected");

    expect(connection).toMatchObject({
      organizationId: "provider-connect-org",
      status: "connected",
    });

    const rows = await database
      .select()
      .from(schema.agentProviderCredential)
      .where(eq(schema.agentProviderCredential.organizationId, "provider-connect-org"));
    const prior = rows.find((row) => row.id === "provider-connect-prior");
    const connected = rows.find(
      (row) =>
        row.id === connection.credentialId ||
        (row.provider === "openai-codex" && row.status === "connected"),
    );

    expect(prior?.status).toBe("replaced");
    expect(connected).toMatchObject({
      organizationId: "provider-connect-org",
      userId: "provider-connect-owner",
      provider: "openai-codex",
      credentialType: "oauth",
      status: "connected",
    });
    expect(connected?.encryptedCredential).toContain("ciphertext");
    expect(connected?.encryptedCredential).not.toContain("synthetic-access-token-rotation");
    expect(connected?.encryptedCredential).not.toContain("synthetic-refresh-token-rotation");

    const credentials = await createProcedureClient(appRouter.providerCredentials, {
      context,
    })({});
    const serializedCredentials = JSON.stringify(credentials);
    expect(serializedCredentials).not.toContain("encryptedCredential");
    expect(serializedCredentials).not.toContain("synthetic-access-token-rotation");
    expect(serializedCredentials).not.toContain("synthetic-refresh-token-rotation");
    expect(serializedCredentials).not.toContain("TEST-CODEX-CODE");
  });
});

describe("agentRunArtifacts router procedure", () => {
  test("lists persisted artifacts for an organization member and parses payload JSON", async () => {
    await seedUser("artifact-user-1");
    await seedOrganization("artifact-org-1");
    await seedMembership("artifact-user-1", "artifact-org-1");
    await seedAgentRun("artifact-run-1", "artifact-org-1", "artifact-user-1");
    await seedAgentRun("artifact-run-other", "artifact-org-1", "artifact-user-1");

    await database.insert(schema.agentRunArtifact).values([
      {
        id: "artifact-second",
        runId: "artifact-run-1",
        name: "review.md",
        contentType: "text/markdown",
        content: "# Review\nLooks good.",
        payloadJson: null,
        createdAt: new Date("2026-01-02T00:00:02.000Z"),
      },
      {
        id: "artifact-first",
        runId: "artifact-run-1",
        name: "github/pull-request-review.json",
        contentType: "application/json",
        content: null,
        payloadJson: JSON.stringify({ reviewId: 123, verdict: "approved" }),
        createdAt: new Date("2026-01-02T00:00:01.000Z"),
      },
      {
        id: "artifact-other-run",
        runId: "artifact-run-other",
        name: "other-run.md",
        contentType: "text/markdown",
        content: "wrong run",
        payloadJson: null,
        createdAt: new Date("2026-01-02T00:00:00.000Z"),
      },
    ]);

    const artifacts = await callAgentRunArtifacts("artifact-user-1")({ runId: "artifact-run-1" });

    expect(artifacts).toEqual([
      {
        id: "artifact-first",
        runId: "artifact-run-1",
        name: "github/pull-request-review.json",
        contentType: "application/json",
        content: null,
        payload: { reviewId: 123, verdict: "approved" },
        createdAt: "2026-01-02T00:00:01.000Z",
      },
      {
        id: "artifact-second",
        runId: "artifact-run-1",
        name: "review.md",
        contentType: "text/markdown",
        content: "# Review\nLooks good.",
        payload: null,
        createdAt: "2026-01-02T00:00:02.000Z",
      },
    ]);
  });

  test("returns NOT_FOUND when the requested run does not exist", async () => {
    await seedUser("artifact-user-2");
    await seedOrganization("artifact-org-2");
    await seedMembership("artifact-user-2", "artifact-org-2");

    await expectOrpcCode(
      callAgentRunArtifacts("artifact-user-2")({ runId: "missing-artifact-run" }),
      "NOT_FOUND",
    );
  });

  test("returns FORBIDDEN when the run belongs to an organization outside the user's memberships", async () => {
    await seedUser("artifact-user-3");
    await seedUser("artifact-owner-3");
    await seedOrganization("artifact-member-org-3");
    await seedOrganization("artifact-outside-org-3");
    await seedMembership("artifact-user-3", "artifact-member-org-3");
    await seedAgentRun("artifact-outside-run-3", "artifact-outside-org-3", "artifact-owner-3");

    await expectOrpcCode(
      callAgentRunArtifacts("artifact-user-3")({ runId: "artifact-outside-run-3" }),
      "FORBIDDEN",
    );
  });
});

describe("worker configuration procedures", () => {
  test("round-trips the reasoning-effort override and exposes the policy default", async () => {
    await seedUser("wc-user-1");
    await seedOrganization("wc-org-1");
    await seedMembership("wc-user-1", "wc-org-1", "owner");
    await seedSession("wc-user-1", "wc-org-1");

    const context = memberContext("wc-user-1", { activeOrganizationId: "wc-org-1" });
    const update = createProcedureClient(appRouter.updateWorkerConfiguration, { context });
    const read = createProcedureClient(appRouter.workerConfiguration, { context });

    const saved = await update({
      organizationId: "wc-org-1",
      model: "gpt-5.4",
      reasoningEffort: "high",
    });
    expect(saved.model).toBe("gpt-5.4");
    expect(saved.reasoningEffort).toBe("high");

    const config = await read({ organizationId: "wc-org-1" });
    expect(config.defaults.model).toBe("gpt-5.5");
    expect(config.defaults.reasoningEffort).toBe("minimal");
    expect(config.config?.reasoningEffort).toBe("high");

    // Clearing only the effort persists null and leaves the model untouched.
    const cleared = await update({ organizationId: "wc-org-1", reasoningEffort: null });
    expect(cleared.reasoningEffort).toBeNull();
    expect(cleared.model).toBe("gpt-5.4");
  });

  test("rejects an unrecognized reasoning-effort value", async () => {
    await seedUser("wc-user-2");
    await seedOrganization("wc-org-2");
    await seedMembership("wc-user-2", "wc-org-2", "admin");
    await seedSession("wc-user-2", "wc-org-2");

    const context = memberContext("wc-user-2", { activeOrganizationId: "wc-org-2" });
    const update = createProcedureClient(appRouter.updateWorkerConfiguration, { context });

    await expect(
      update({ organizationId: "wc-org-2", reasoningEffort: "lowest" as never }),
    ).rejects.toBeInstanceOf(Error);
  });
});
