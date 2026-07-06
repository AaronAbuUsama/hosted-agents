import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";
import { Hono } from "hono";

import type { GitHubWebhookDelivery as FlueGitHubWebhookDelivery } from "@flue/github";
import type { db as productionDb } from "@hosted-agents/db";
import * as schema from "@hosted-agents/db/schema/index";
import type { GitHubWebhookAdmission } from "./github-webhook";

process.env.SKIP_ENV_VALIDATION = "true";
process.env.DATABASE_URL = ":memory:";
process.env.BETTER_AUTH_SECRET = "test-better-auth-secret-32-bytes";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.CORS_ORIGIN = "http://localhost:3000";
process.env.NODE_ENV = "test";

// github-webhook creates the production db/env singletons at module load, so this
// test imports it only after installing hermetic environment variables above.
const { admitGitHubWebhookDelivery, createGitHubWebhookChannel } = await import("./github-webhook");

type TestDatabase = typeof productionDb;
type TestClient = {
  close(): void;
  executeMultiple(sql: string): Promise<void>;
};
type PullRequestWebhookDelivery = Extract<FlueGitHubWebhookDelivery, { name: "pull_request" }>;

const WEBHOOK_SECRET = "slice-1-webhook-secret";
const INSTALLATION_ID = 123_456;
const GITHUB_REPOSITORY_ID = 987_654;
const ADMITTED_PULL_REQUEST_ACTIONS = [
  "opened",
  "reopened",
  "synchronize",
  "ready_for_review",
] as const;

async function createTestDatabase() {
  const testDatabaseDirectory = mkdtempSync(join(tmpdir(), "github-webhook-test-"));
  const databaseUrl = `file:${join(testDatabaseDirectory, "test.sqlite")}`;
  const database = drizzle({ connection: { url: databaseUrl }, schema }) as TestDatabase & {
    $client: TestClient;
  };
  const client = database.$client;
  const cleanupClient: TestClient = {
    executeMultiple: (sql) => client.executeMultiple(sql),
    close() {
      client.close();
      rmSync(testDatabaseDirectory, { recursive: true, force: true });
    },
  };
  await createTables(cleanupClient);

  return {
    client: cleanupClient,
    database,
  };
}

async function createTables(client: TestClient) {
  await client.executeMultiple(`
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

    CREATE TABLE "github_installation" (
      "id" text PRIMARY KEY,
      "organization_id" text NOT NULL,
      "installation_id" text NOT NULL,
      "app_slug" text NOT NULL,
      "account_id" text,
      "account_login" text,
      "account_type" text,
      "repository_selection" text,
      "status" text DEFAULT 'connected' NOT NULL,
      "setup_action" text,
      "installed_by_user_id" text,
      "suspended_at" integer,
      "created_at" integer DEFAULT 0 NOT NULL,
      "updated_at" integer DEFAULT 0 NOT NULL
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
      "created_at" integer DEFAULT 0 NOT NULL,
      "updated_at" integer DEFAULT 0 NOT NULL
    );

    CREATE TABLE "github_webhook_delivery" (
      "id" text PRIMARY KEY,
      "event" text NOT NULL,
      "action" text,
      "installation_id" text,
      "repository_full_name" text,
      "pull_request_number" integer,
      "status" text DEFAULT 'claimed' NOT NULL,
      "agent_run_id" text,
      "review_run_id" text,
      "received_at" integer DEFAULT 0 NOT NULL,
      "updated_at" integer DEFAULT 0 NOT NULL
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
      "created_at" integer DEFAULT 0 NOT NULL,
      "updated_at" integer DEFAULT 0 NOT NULL
    );

    CREATE TABLE "review_run" (
      "id" text PRIMARY KEY,
      "organization_id" text NOT NULL,
      "user_id" text NOT NULL,
      "provider_credential_id" text,
      "agent_name" text DEFAULT 'code-review' NOT NULL,
      "repository_provider" text DEFAULT 'manual' NOT NULL,
      "repository_owner" text,
      "repository_name" text,
      "repository_url" text,
      "branch" text NOT NULL,
      "base_branch" text,
      "review_context" text,
      "github_delivery_id" text,
      "github_installation_id" text,
      "github_repository_id" text,
      "pull_request_number" integer,
      "pull_request_base_ref" text,
      "pull_request_base_sha" text,
      "pull_request_head_ref" text,
      "pull_request_head_sha" text,
      "status" text DEFAULT 'queued' NOT NULL,
      "flue_run_id" text,
      "sandbox_provider" text,
      "sandbox_id" text,
      "sandbox_started_at" integer,
      "sandbox_completed_at" integer,
      "summary" text,
      "findings_json" text,
      "artifacts_json" text,
      "execution_logs" text,
      "error_message" text,
      "started_at" integer,
      "completed_at" integer,
      "created_at" integer DEFAULT 0 NOT NULL,
      "updated_at" integer DEFAULT 0 NOT NULL
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
  `);
}

async function seedLinkedPullRequestTarget(database: TestDatabase) {
  await database.insert(schema.user).values({
    id: "user-1",
    name: "Ada Reviewer",
    email: "ada@example.test",
  });

  await database.insert(schema.organization).values({
    id: "org-1",
    name: "Octo Org",
    slug: "octo-org",
  });

  await database.insert(schema.githubInstallation).values({
    id: "installation-record-1",
    organizationId: "org-1",
    installationId: String(INSTALLATION_ID),
    appSlug: "hosted-agents",
    accountId: "111",
    accountLogin: "octo-org",
    accountType: "Organization",
    repositorySelection: "selected",
    status: "connected",
    installedByUserId: "user-1",
  });

  await database.insert(schema.githubRepository).values({
    id: "repository-record-1",
    installationId: "installation-record-1",
    githubRepositoryId: String(GITHUB_REPOSITORY_ID),
    owner: "octo-org",
    name: "widgets",
    fullName: "octo-org/widgets",
    htmlUrl: "https://github.com/octo-org/widgets",
    defaultBranch: "main",
    private: false,
    selected: true,
  });

  await database.insert(schema.agentProviderCredential).values({
    id: "credential-1",
    organizationId: "org-1",
    userId: "user-1",
    provider: "openai-codex",
    credentialType: "api-key",
    encryptedCredential: "encrypted-test-credential",
    status: "connected",
  });
}

function createWebhookApp(database: TestDatabase) {
  const channel = createGitHubWebhookChannel({
    database,
    webhookSecret: WEBHOOK_SECRET,
  });
  if (!channel) {
    throw new Error("expected test webhook channel to be configured");
  }

  const route = channel.routes[0];
  if (!route) {
    throw new Error("expected test webhook channel route");
  }

  const app = new Hono();
  type GitHubRouteContext = Parameters<typeof route.handler>[0];
  app.post("/webhook", (c, next) => route.handler(c as unknown as GitHubRouteContext, next));

  return app;
}

async function postGitHubWebhook({
  app,
  event,
  deliveryId,
  payload,
  signature,
}: {
  app: Hono;
  event: string;
  deliveryId: string;
  payload: unknown;
  signature?: string;
}) {
  const body = JSON.stringify(payload);

  return app.request("/webhook", {
    method: "POST",
    body,
    headers: {
      "content-type": "application/json",
      "x-github-delivery": deliveryId,
      "x-github-event": event,
      "x-hub-signature-256": signature ?? (await signBody(body)),
    },
  });
}

async function signBody(body: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(WEBHOOK_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(body)),
  );

  return `sha256=${Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

function pullRequestPayload(action: string) {
  return {
    action,
    installation: { id: INSTALLATION_ID },
    repository: {
      id: GITHUB_REPOSITORY_ID,
      full_name: "octo-org/widgets",
      owner: { login: "octo-org" },
      name: "widgets",
      html_url: "https://github.com/octo-org/widgets",
      private: false,
      default_branch: "main",
    },
    pull_request: {
      number: 42,
      base: {
        ref: "main",
        sha: "base-sha-123",
      },
      head: {
        ref: "feature/slice-1",
        sha: "head-sha-456",
      },
    },
  };
}

describe("GitHub webhook admission", () => {
  test("rejects an invalid GitHub signature before writing admission rows", async () => {
    const { client, database } = await createTestDatabase();
    try {
      const app = createWebhookApp(database);

      const response = await postGitHubWebhook({
        app,
        event: "pull_request",
        deliveryId: "delivery-invalid-signature",
        payload: pullRequestPayload("opened"),
        signature: `sha256=${"0".repeat(64)}`,
      });

      expect(response.status).toBe(401);
      expect(await database.select().from(schema.githubWebhookDelivery)).toHaveLength(0);
      expect(await database.select().from(schema.agentRun)).toHaveLength(0);
    } finally {
      client.close();
    }
  });

  test("acknowledges a verified non-admitted event without creating a run", async () => {
    const { client, database } = await createTestDatabase();
    try {
      const app = createWebhookApp(database);

      const response = await postGitHubWebhook({
        app,
        event: "issues",
        deliveryId: "delivery-ignored-event",
        payload: { action: "opened", issue: { number: 42 } },
      });

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({
        ok: true,
        accepted: false,
        duplicate: false,
        event: "issues",
        action: "opened",
        deliveryId: "delivery-ignored-event",
        reason: "event_not_admitted",
      });
      expect(await database.select().from(schema.githubWebhookDelivery)).toHaveLength(0);
      expect(await database.select().from(schema.agentRun)).toHaveLength(0);
    } finally {
      client.close();
    }
  });

  for (const action of ADMITTED_PULL_REQUEST_ACTIONS) {
    test(`queues one agent run for pull_request.${action} and treats a redelivery as duplicate`, async () => {
      const { client, database } = await createTestDatabase();
      try {
        await seedLinkedPullRequestTarget(database);
        const app = createWebhookApp(database);
        const deliveryId = `delivery-accepted-pr-${action}`;
        const payload = pullRequestPayload(action);

        const acceptedResponse = await postGitHubWebhook({
          app,
          event: "pull_request",
          deliveryId,
          payload,
        });

        expect(acceptedResponse.status).toBe(202);
        const acceptedAdmission = (await acceptedResponse.json()) as GitHubWebhookAdmission;
        expect(acceptedAdmission).toEqual({
          ok: true,
          accepted: true,
          duplicate: false,
          event: "pull_request",
          action,
          deliveryId,
          agentRunId: acceptedAdmission.agentRunId,
        });
        expect(acceptedAdmission.agentRunId).toBeTruthy();

        const firstRuns = await database.select().from(schema.agentRun);
        expect(firstRuns).toHaveLength(1);
        expect(firstRuns[0]).toMatchObject({
          id: acceptedAdmission.agentRunId,
          organizationId: "org-1",
          userId: "user-1",
          providerCredentialId: "credential-1",
          coworkerSlug: "code-review",
          workerRole: "code_review",
          workerDisplayName: "Code Review Worker",
          runType: "github.pull_request_review",
          sourceProvider: "github",
          sourceDeliveryId: deliveryId,
          repositoryOwner: "octo-org",
          repositoryName: "widgets",
          repositoryUrl: "https://github.com/octo-org/widgets",
          branch: "feature/slice-1",
          baseBranch: "main",
          githubInstallationId: "installation-record-1",
          githubRepositoryId: "repository-record-1",
          pullRequestNumber: 42,
          pullRequestBaseRef: "main",
          pullRequestBaseSha: "base-sha-123",
          pullRequestHeadRef: "feature/slice-1",
          pullRequestHeadSha: "head-sha-456",
          status: "queued",
          currentStage: "queued",
        });

        const runEvents = await database
          .select()
          .from(schema.agentRunEvent)
          .where(eq(schema.agentRunEvent.runId, acceptedAdmission.agentRunId ?? ""));
        expect(runEvents.map((event) => event.type)).toEqual([
          "github.webhook.accepted",
          "queue.created",
        ]);
        expect(runEvents.find((event) => event.type === "queue.created")).toMatchObject({
          message: "Queued code review worker run",
        });
        expect(
          JSON.parse(
            runEvents.find((event) => event.type === "queue.created")?.payloadJson ?? "{}",
          ),
        ).toMatchObject({
          workerRole: "code_review",
          workerDisplayName: "Code Review Worker",
          runType: "github.pull_request_review",
        });

        const [delivery] = await database
          .select()
          .from(schema.githubWebhookDelivery)
          .where(eq(schema.githubWebhookDelivery.id, deliveryId));
        expect(delivery).toMatchObject({
          id: deliveryId,
          event: "pull_request",
          action,
          installationId: String(INSTALLATION_ID),
          repositoryFullName: "octo-org/widgets",
          pullRequestNumber: 42,
          status: "accepted",
          agentRunId: acceptedAdmission.agentRunId,
        });

        const duplicateResponse = await postGitHubWebhook({
          app,
          event: "pull_request",
          deliveryId,
          payload,
        });

        expect(duplicateResponse.status).toBe(202);
        expect(await duplicateResponse.json()).toEqual({
          ok: true,
          accepted: false,
          duplicate: true,
          event: "pull_request",
          action,
          deliveryId,
          agentRunId: acceptedAdmission.agentRunId,
          reason: "duplicate_delivery",
        });
        expect(await database.select().from(schema.agentRun)).toHaveLength(1);
        expect(await database.select().from(schema.githubWebhookDelivery)).toHaveLength(1);
      } finally {
        client.close();
      }
    });
  }

  test("ignores a suspended linked installation without creating an agent run", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await database
        .update(schema.githubInstallation)
        .set({ status: "suspended", suspendedAt: new Date(0) })
        .where(eq(schema.githubInstallation.id, "installation-record-1"));
      const app = createWebhookApp(database);
      const deliveryId = "delivery-suspended-installation";

      const response = await postGitHubWebhook({
        app,
        event: "pull_request",
        deliveryId,
        payload: pullRequestPayload("opened"),
      });

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({
        ok: true,
        accepted: false,
        duplicate: false,
        event: "pull_request",
        action: "opened",
        deliveryId,
        reason: "installation_not_connected",
      });
      expect(await database.select().from(schema.agentRun)).toHaveLength(0);

      const [delivery] = await database
        .select()
        .from(schema.githubWebhookDelivery)
        .where(eq(schema.githubWebhookDelivery.id, deliveryId));
      expect(delivery).toMatchObject({
        id: deliveryId,
        status: "ignored:installation_not_connected",
        agentRunId: null,
        reviewRunId: null,
      });
    } finally {
      client.close();
    }
  });

  test("does not acknowledge an incomplete claimed delivery as a duplicate", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      const deliveryId = "delivery-incomplete-claimed";
      await database.insert(schema.githubWebhookDelivery).values({
        id: deliveryId,
        event: "pull_request",
        action: "opened",
        installationId: String(INSTALLATION_ID),
        repositoryFullName: "octo-org/widgets",
        pullRequestNumber: 42,
        status: "claimed",
      });

      const webhookDelivery: PullRequestWebhookDelivery = {
        name: "pull_request",
        deliveryId,
        payload: pullRequestPayload("opened") as PullRequestWebhookDelivery["payload"],
      };

      await expect(admitGitHubWebhookDelivery(webhookDelivery, database)).rejects.toThrow(
        "incomplete",
      );
      expect(await database.select().from(schema.agentRun)).toHaveLength(0);

      const [delivery] = await database
        .select()
        .from(schema.githubWebhookDelivery)
        .where(eq(schema.githubWebhookDelivery.id, deliveryId));
      expect(delivery).toMatchObject({
        id: deliveryId,
        status: "claimed",
        agentRunId: null,
        reviewRunId: null,
      });
    } finally {
      client.close();
    }
  });
});
