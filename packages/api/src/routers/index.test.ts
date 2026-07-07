import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ORPCError, createProcedureClient } from "@orpc/server";
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

const memberContext = (userId: string): Context =>
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
        activeOrganizationId: null,
      },
    } as Context["session"],
    reviewRunInvoker: async () => ({ flueRunId: "unused-in-artifact-tests" }),
  }) as Context;

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

async function seedOrganization(organizationId: string) {
  await database.insert(schema.organization).values({
    id: organizationId,
    name: `Organization ${organizationId}`,
    slug: organizationId,
  });
}

async function seedMembership(userId: string, organizationId: string) {
  await database.insert(schema.member).values({
    id: `member-${userId}-${organizationId}`,
    userId,
    organizationId,
    role: "member",
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
