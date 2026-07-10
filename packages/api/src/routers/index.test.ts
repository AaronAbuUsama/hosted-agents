import { afterAll, describe, expect, test } from "bun:test";
import { generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ORPCError, createProcedureClient } from "@orpc/server";
import { eq } from "drizzle-orm";
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
      "pull_request_number" integer,
      "pull_request_base_ref" text,
      "pull_request_base_sha" text,
      "pull_request_head_ref" text,
      "pull_request_head_sha" text,
      "status" text DEFAULT 'queued' NOT NULL,
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

    CREATE TABLE "agent_run_artifact" (
      "id" text PRIMARY KEY,
      "run_id" text NOT NULL,
      "name" text NOT NULL,
      "content_type" text NOT NULL,
      "content" text,
      "payload_json" text,
      "created_at" integer DEFAULT 0 NOT NULL
    );
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
    }) as typeof fetch;

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
