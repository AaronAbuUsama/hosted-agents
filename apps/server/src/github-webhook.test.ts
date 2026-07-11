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
import { loadIssueOverlays, loadRepositoryIssuesRevision } from "@hosted-agents/api/issues/sync";
import type { GitHubWebhookAdmission } from "./github-webhook";

process.env.SKIP_ENV_VALIDATION = "true";
process.env.DATABASE_URL = ":memory:";
process.env.BETTER_AUTH_SECRET = "test-better-auth-secret-32-bytes";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.CORS_ORIGIN = "http://localhost:3000";
process.env.NODE_ENV = "test";
// The Coder app shares this webhook channel; admission maps an installation's
// recorded app slug to its worker role, so configure the Coder app slug here.
process.env.GITHUB_CODER_APP_SLUG = "coder-app";

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
const CODER_INSTALLATION_ID = 654_321;
const CODER_GITHUB_REPOSITORY_ID = 456_789;
const ADMITTED_PULL_REQUEST_ACTIONS = [
  "opened",
  "reopened",
  "synchronize",
  "ready_for_review",
] as const;

// The delivery-ledger row is keyed per (delivery GUID, receiving installation), so a
// repo installed under both apps yields two independent rows for one GUID. Tests that
// read the ledger row back look it up by this composite id — mirrors deliveryLedgerId
// in github-webhook.ts.
function ledgerId(deliveryId: string, installationId: number | string): string {
  return `${deliveryId}:${installationId}`;
}

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
      "babysit_round" integer DEFAULT 0 NOT NULL,
      "babysit_blocked_reason" text,
      "github_created_at" integer,
      "github_updated_at" integer,
      "created_at" integer DEFAULT 0 NOT NULL,
      "updated_at" integer DEFAULT 0 NOT NULL
    );
    CREATE UNIQUE INDEX "github_issue_repo_number_idx" ON "github_issue" ("github_repository_id","number");

    CREATE TABLE "github_issue_comment" (
      "id" text PRIMARY KEY,
      "organization_id" text NOT NULL,
      "github_repository_id" text NOT NULL,
      "repository_full_name" text NOT NULL,
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
      "created_at" integer DEFAULT 0 NOT NULL,
      "updated_at" integer DEFAULT 0 NOT NULL
    );
    CREATE UNIQUE INDEX "github_issue_comment_githubCommentId_idx" ON "github_issue_comment" ("github_comment_id");
    CREATE INDEX "github_issue_comment_repositoryFullName_idx" ON "github_issue_comment" ("repository_full_name");
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

// Seeds the same repository linked through the Coder app's installation (its
// app slug is GITHUB_CODER_APP_SLUG), so a pull_request delivery arrives from an
// installation whose worker role is implementation rather than code_review.
async function seedCoderInstallationTarget(database: TestDatabase) {
  await database.insert(schema.githubInstallation).values({
    id: "installation-record-coder",
    organizationId: "org-1",
    installationId: String(CODER_INSTALLATION_ID),
    appSlug: "coder-app",
    accountId: "111",
    accountLogin: "octo-org",
    accountType: "Organization",
    repositorySelection: "selected",
    status: "connected",
    installedByUserId: "user-1",
  });

  await database.insert(schema.githubRepository).values({
    id: "repository-record-coder",
    installationId: "installation-record-coder",
    githubRepositoryId: String(CODER_GITHUB_REPOSITORY_ID),
    owner: "octo-org",
    name: "widgets",
    fullName: "octo-org/widgets",
    htmlUrl: "https://github.com/octo-org/widgets",
    defaultBranch: "main",
    private: false,
    selected: true,
  });
}

function createWebhookApp(
  database: TestDatabase,
  deps?: NonNullable<Parameters<typeof createGitHubWebhookChannel>[0]>["deps"],
) {
  const channel = createGitHubWebhookChannel({
    database,
    webhookSecret: WEBHOOK_SECRET,
    deps,
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

function pullRequestPayload(
  action: string,
  overrides: { senderType?: string; headRef?: string; pullRequestNumber?: number } = {},
) {
  const login = overrides.senderType === "User" ? "octo-maintainer" : "coworker-coder[bot]";
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
      number: overrides.pullRequestNumber ?? 42,
      base: {
        ref: "main",
        sha: "base-sha-123",
      },
      head: {
        ref: overrides.headRef ?? "feature/slice-1",
        sha: "head-sha-456",
      },
    },
    // Only attach a sender when a test opts in — the base pull_request cases assert
    // the review-run path, which must stay untouched by the human-push yield.
    ...(overrides.senderType ? { sender: { login, type: overrides.senderType } } : {}),
  };
}

function coderPullRequestPayload(action: string) {
  return {
    ...pullRequestPayload(action),
    installation: { id: CODER_INSTALLATION_ID },
    repository: {
      id: CODER_GITHUB_REPOSITORY_ID,
      full_name: "octo-org/widgets",
      owner: { login: "octo-org" },
      name: "widgets",
      html_url: "https://github.com/octo-org/widgets",
      private: false,
      default_branch: "main",
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
          .where(eq(schema.githubWebhookDelivery.id, ledgerId(deliveryId, INSTALLATION_ID)));
        expect(delivery).toMatchObject({
          id: ledgerId(deliveryId, INSTALLATION_ID),
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
        .where(eq(schema.githubWebhookDelivery.id, ledgerId(deliveryId, INSTALLATION_ID)));
      expect(delivery).toMatchObject({
        id: ledgerId(deliveryId, INSTALLATION_ID),
        status: "ignored:installation_not_connected",
        agentRunId: null,
        reviewRunId: null,
      });
    } finally {
      client.close();
    }
  });

  test("ignores a pull_request delivery from the Coder app installation without creating a review run", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      const app = createWebhookApp(database);
      const deliveryId = "delivery-coder-app-installation";

      const response = await postGitHubWebhook({
        app,
        event: "pull_request",
        deliveryId,
        payload: coderPullRequestPayload("opened"),
      });

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({
        ok: true,
        accepted: false,
        duplicate: false,
        event: "pull_request",
        action: "opened",
        deliveryId,
        reason: "installation_app_not_reviewer",
      });
      // No review run is queued for the Coder app's copy of the delivery.
      expect(await database.select().from(schema.agentRun)).toHaveLength(0);

      const [delivery] = await database
        .select()
        .from(schema.githubWebhookDelivery)
        .where(eq(schema.githubWebhookDelivery.id, ledgerId(deliveryId, CODER_INSTALLATION_ID)));
      expect(delivery).toMatchObject({
        id: ledgerId(deliveryId, CODER_INSTALLATION_ID),
        status: "ignored:installation_app_not_reviewer",
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
        id: ledgerId(deliveryId, INSTALLATION_ID),
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
        .where(eq(schema.githubWebhookDelivery.id, ledgerId(deliveryId, INSTALLATION_ID)));
      expect(delivery).toMatchObject({
        id: ledgerId(deliveryId, INSTALLATION_ID),
        status: "claimed",
        agentRunId: null,
        reviewRunId: null,
      });
    } finally {
      client.close();
    }
  });

  // Regression (#21): GitHub delivers ONE delivery GUID to BOTH the Reviewer and Coder
  // apps for a repo installed under both, and both copies forward to this single
  // endpoint. Keying the ledger row on the GUID alone made whichever copy landed SECOND
  // collide on the primary key and get swallowed as a duplicate — live, the Coder's
  // (correctly) ignored copy landed FIRST and swallowed the Reviewer's copy, so no
  // review run was ever created. The same GUID to two DIFFERENT installations must be
  // two independent admissions.
  test("the same delivery GUID from two installations admits both independently (the second copy is not swallowed)", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      const app = createWebhookApp(database);
      const sharedDeliveryId = "delivery-shared-guid";

      // The Coder app's copy arrives FIRST (the live ordering) and is correctly ignored.
      const coderResponse = await postGitHubWebhook({
        app,
        event: "pull_request",
        deliveryId: sharedDeliveryId,
        payload: coderPullRequestPayload("opened"),
      });
      expect(coderResponse.status).toBe(202);
      expect((await coderResponse.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        duplicate: false,
        deliveryId: sharedDeliveryId,
        reason: "installation_app_not_reviewer",
      });

      // The Reviewer app's copy of the SAME GUID must still be admitted — not swallowed
      // as a duplicate — and queue the review run.
      const reviewerResponse = await postGitHubWebhook({
        app,
        event: "pull_request",
        deliveryId: sharedDeliveryId,
        payload: pullRequestPayload("opened"),
      });
      expect(reviewerResponse.status).toBe(202);
      const reviewerAdmission = (await reviewerResponse.json()) as GitHubWebhookAdmission;
      expect(reviewerAdmission).toMatchObject({
        accepted: true,
        duplicate: false,
        deliveryId: sharedDeliveryId,
      });
      expect(reviewerAdmission.agentRunId).toBeTruthy();

      // Exactly one review run (the Reviewer's), and two independent ledger rows keyed
      // per (GUID, installation): the Coder's ignored copy and the Reviewer's accepted
      // copy coexist under one GUID.
      expect(await database.select().from(schema.agentRun)).toHaveLength(1);
      expect(await database.select().from(schema.githubWebhookDelivery)).toHaveLength(2);

      const [coderRow] = await database
        .select()
        .from(schema.githubWebhookDelivery)
        .where(
          eq(schema.githubWebhookDelivery.id, ledgerId(sharedDeliveryId, CODER_INSTALLATION_ID)),
        );
      expect(coderRow).toMatchObject({
        installationId: String(CODER_INSTALLATION_ID),
        status: "ignored:installation_app_not_reviewer",
        agentRunId: null,
      });

      const [reviewerRow] = await database
        .select()
        .from(schema.githubWebhookDelivery)
        .where(eq(schema.githubWebhookDelivery.id, ledgerId(sharedDeliveryId, INSTALLATION_ID)));
      expect(reviewerRow).toMatchObject({
        installationId: String(INSTALLATION_ID),
        status: "accepted",
        agentRunId: reviewerAdmission.agentRunId,
      });
    } finally {
      client.close();
    }
  });

  // The dedup that MUST survive the fix: the same GUID redelivered to the SAME
  // installation is still a duplicate (a genuine GitHub redelivery), leaving exactly one
  // ledger row and one run.
  test("the same delivery GUID redelivered to the SAME installation is still deduplicated", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      const app = createWebhookApp(database);
      const sharedDeliveryId = "delivery-same-guid-same-install";
      const payload = pullRequestPayload("opened");

      const first = (await (
        await postGitHubWebhook({
          app,
          event: "pull_request",
          deliveryId: sharedDeliveryId,
          payload,
        })
      ).json()) as GitHubWebhookAdmission;
      expect(first.accepted).toBe(true);

      const second = await postGitHubWebhook({
        app,
        event: "pull_request",
        deliveryId: sharedDeliveryId,
        payload,
      });
      expect((await second.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        duplicate: true,
        agentRunId: first.agentRunId,
        reason: "duplicate_delivery",
      });

      // One run, one ledger row — the redelivery to the same installation changed nothing.
      expect(await database.select().from(schema.agentRun)).toHaveLength(1);
      expect(await database.select().from(schema.githubWebhookDelivery)).toHaveLength(1);
    } finally {
      client.close();
    }
  });
});

const BABYSIT_ISSUE_NUMBER = 7;
const BABYSIT_PR_NUMBER = 42;
const BABYSIT_BRANCH = `coder/issue-${BABYSIT_ISSUE_NUMBER}-add-a-widget`;

// A `pull_request_review.submitted` delivery from the Coder app's installation on
// the Coder-linked repository — the copy the babysit admission acts on. Defaults to
// the Reviewer bot requesting changes on the Coder's PR; overrides drive the other
// cases (approved, human actor, a different PR/branch).
function pullRequestReviewPayload(
  overrides: {
    reviewState?: string;
    senderType?: string;
    reviewId?: number;
    pullRequestNumber?: number;
    headRef?: string;
    baseRef?: string;
    installationId?: number;
    repositoryId?: number;
  } = {},
) {
  const login = overrides.senderType === "User" ? "octo-maintainer" : "coworker-reviewer[bot]";
  return {
    action: "submitted",
    installation: { id: overrides.installationId ?? CODER_INSTALLATION_ID },
    repository: {
      id: overrides.repositoryId ?? CODER_GITHUB_REPOSITORY_ID,
      full_name: "octo-org/widgets",
      owner: { login: "octo-org" },
      name: "widgets",
      html_url: "https://github.com/octo-org/widgets",
      private: false,
      default_branch: "main",
    },
    pull_request: {
      number: overrides.pullRequestNumber ?? BABYSIT_PR_NUMBER,
      state: "open",
      head: { ref: overrides.headRef ?? BABYSIT_BRANCH },
      base: { ref: overrides.baseRef ?? "main" },
    },
    review: {
      id: overrides.reviewId ?? 5001,
      state: overrides.reviewState ?? "changes_requested",
      user: { login, type: overrides.senderType ?? "Bot" },
    },
    sender: { login, type: overrides.senderType ?? "Bot" },
  };
}

// Seed a Coder-claimed issue on the Coder-linked repository, with its babysit
// bookkeeping, so a review admission has a claim to match + increment.
async function seedCoderClaimedIssue(
  database: TestDatabase,
  overrides: {
    number?: number;
    linkedPullRequestNumber?: number | null;
    babysitRound?: number;
    babysitBlockedReason?: string | null;
    // Which `github_repository` row the claim is stamped on. Defaults to the Coder
    // app's row; kick-off actually stamps it on whichever row the board project is
    // linked through, which may be the Reviewer app's row (see the cross-installation
    // review-admission test).
    githubRepositoryId?: string;
    githubInstallationId?: string;
  } = {},
) {
  const number = overrides.number ?? BABYSIT_ISSUE_NUMBER;
  await database.insert(schema.githubIssue).values({
    id: `issue-record-${number}`,
    organizationId: "org-1",
    githubInstallationId: overrides.githubInstallationId ?? "installation-record-coder",
    githubRepositoryId: overrides.githubRepositoryId ?? "repository-record-coder",
    repositoryFullName: "octo-org/widgets",
    number,
    title: "Add a Widget!",
    state: "open",
    claimedByWorkerRole: "implementation",
    claimedByRunId: `run-${number}`,
    claimedAt: new Date(0),
    linkedPullRequestNumber:
      overrides.linkedPullRequestNumber === undefined
        ? BABYSIT_PR_NUMBER
        : overrides.linkedPullRequestNumber,
    linkedPullRequestState: "open",
    linkedPullRequestMerged: false,
    babysitRound: overrides.babysitRound ?? 0,
    babysitBlockedReason: overrides.babysitBlockedReason ?? null,
  });
}

describe("GitHub webhook babysit admission", () => {
  test("a Reviewer changes_requested review under the cap enqueues one fix run on the same branch and bumps the round", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      // One fix round already done; this review is round 2.
      await seedCoderClaimedIssue(database, { babysitRound: 1 });
      const app = createWebhookApp(database);
      const deliveryId = "delivery-babysit-round-2";

      const response = await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId,
        payload: pullRequestReviewPayload({ reviewState: "changes_requested" }),
      });

      expect(response.status).toBe(202);
      const admission = (await response.json()) as GitHubWebhookAdmission;
      expect(admission).toMatchObject({
        ok: true,
        accepted: true,
        duplicate: false,
        event: "pull_request_review",
        action: "submitted",
        deliveryId,
        issueNumber: BABYSIT_ISSUE_NUMBER,
      });
      expect(admission.agentRunId).toBeTruthy();

      const runs = await database.select().from(schema.agentRun);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        id: admission.agentRunId,
        organizationId: "org-1",
        userId: "user-1",
        providerCredentialId: "credential-1",
        workerRole: "implementation",
        workerDisplayName: "The Coder",
        runType: "github.issue_implementation",
        sourceProvider: "github",
        sourceDeliveryId: deliveryId,
        // The EXISTING Coder branch + PR — the runner resumes it, no new branch/PR.
        branch: BABYSIT_BRANCH,
        baseBranch: "main",
        issueNumber: BABYSIT_ISSUE_NUMBER,
        githubInstallationId: "installation-record-coder",
        githubRepositoryId: "repository-record-coder",
        pullRequestNumber: BABYSIT_PR_NUMBER,
        pullRequestHeadRef: BABYSIT_BRANCH,
        status: "queued",
        currentStage: "queued",
      });

      // The round counter advanced 1 → 2 on the claim.
      const [issue] = await database
        .select()
        .from(schema.githubIssue)
        .where(eq(schema.githubIssue.number, BABYSIT_ISSUE_NUMBER));
      expect(issue).toMatchObject({ babysitRound: 2, babysitBlockedReason: null });

      const runEvents = await database
        .select()
        .from(schema.agentRunEvent)
        .where(eq(schema.agentRunEvent.runId, admission.agentRunId ?? ""));
      expect(runEvents.map((event) => event.type)).toEqual([
        "github.webhook.accepted",
        "queue.created",
      ]);

      const [delivery] = await database
        .select()
        .from(schema.githubWebhookDelivery)
        .where(eq(schema.githubWebhookDelivery.id, ledgerId(deliveryId, CODER_INSTALLATION_ID)));
      expect(delivery).toMatchObject({
        id: ledgerId(deliveryId, CODER_INSTALLATION_ID),
        event: "pull_request_review",
        action: "submitted",
        status: "accepted",
        agentRunId: admission.agentRunId,
      });
    } finally {
      client.close();
    }
  });

  test("matches the Coder claim by branch name when the linked PR is not yet stamped", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      // No linked-PR stamp yet; the claim is matched by the coder/issue-<n> branch.
      await seedCoderClaimedIssue(database, { babysitRound: 0, linkedPullRequestNumber: null });
      const app = createWebhookApp(database);

      const response = await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId: "delivery-babysit-branch-match",
        payload: pullRequestReviewPayload({ pullRequestNumber: 99, headRef: BABYSIT_BRANCH }),
      });

      const admission = (await response.json()) as GitHubWebhookAdmission;
      expect(admission).toMatchObject({ accepted: true, issueNumber: BABYSIT_ISSUE_NUMBER });
      const runs = await database.select().from(schema.agentRun);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        branch: BABYSIT_BRANCH,
        pullRequestNumber: 99,
        issueNumber: BABYSIT_ISSUE_NUMBER,
      });
      const [issue] = await database
        .select()
        .from(schema.githubIssue)
        .where(eq(schema.githubIssue.number, BABYSIT_ISSUE_NUMBER));
      expect(issue?.babysitRound).toBe(1);
    } finally {
      client.close();
    }
  });

  test("at the round cap, no run is enqueued: the issue is blocked and the Coder posts an explanation comment", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      await seedCoderClaimedIssue(database, { babysitRound: 3 });

      const postedComments: Array<{
        installationId: string;
        owner: string;
        repo: string;
        issueNumber: number;
        body: string;
      }> = [];
      const app = createWebhookApp(database, {
        async postCoderIssueComment(input) {
          postedComments.push(input);
        },
      });

      const response = await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId: "delivery-babysit-cap",
        payload: pullRequestReviewPayload({ reviewState: "changes_requested" }),
      });

      expect(response.status).toBe(202);
      expect((await response.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        duplicate: false,
        event: "pull_request_review",
        issueNumber: BABYSIT_ISSUE_NUMBER,
        reason: "round_cap_reached",
      });

      // No fix run — the cap is exhausted.
      expect(await database.select().from(schema.agentRun)).toHaveLength(0);

      // The issue is parked Failed / Blocked (the overlay reads this reason).
      const [issue] = await database
        .select()
        .from(schema.githubIssue)
        .where(eq(schema.githubIssue.number, BABYSIT_ISSUE_NUMBER));
      expect(issue).toMatchObject({
        babysitRound: 3,
        babysitBlockedReason: "round_cap_reached",
      });

      // The Coder posted exactly one explanation comment on the issue.
      expect(postedComments).toHaveLength(1);
      expect(postedComments[0]).toMatchObject({
        installationId: String(CODER_INSTALLATION_ID),
        owner: "octo-org",
        repo: "widgets",
        issueNumber: BABYSIT_ISSUE_NUMBER,
      });
      expect(postedComments[0]?.body).toContain("round cap");

      const [delivery] = await database
        .select()
        .from(schema.githubWebhookDelivery)
        .where(
          eq(
            schema.githubWebhookDelivery.id,
            ledgerId("delivery-babysit-cap", CODER_INSTALLATION_ID),
          ),
        );
      expect(delivery).toMatchObject({
        status: "blocked:round_cap_reached",
        agentRunId: null,
      });
    } finally {
      client.close();
    }
  });

  test("a human review yields: no run, the PR is dropped to human-in-the-loop, no comment", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      await seedCoderClaimedIssue(database, { babysitRound: 1 });

      const postedComments: unknown[] = [];
      const app = createWebhookApp(database, {
        async postCoderIssueComment(input) {
          postedComments.push(input);
        },
      });

      const response = await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId: "delivery-babysit-human",
        payload: pullRequestReviewPayload({ reviewState: "changes_requested", senderType: "User" }),
      });

      expect(response.status).toBe(202);
      expect((await response.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        event: "pull_request_review",
        issueNumber: BABYSIT_ISSUE_NUMBER,
        reason: "human_in_the_loop",
      });

      // Humans always win: no fix run, and no cap comment.
      expect(await database.select().from(schema.agentRun)).toHaveLength(0);
      expect(postedComments).toHaveLength(0);

      const [issue] = await database
        .select()
        .from(schema.githubIssue)
        .where(eq(schema.githubIssue.number, BABYSIT_ISSUE_NUMBER));
      expect(issue).toMatchObject({
        // The round is untouched; the stop reason records the human takeover.
        babysitRound: 1,
        babysitBlockedReason: "human_in_the_loop",
      });

      const [delivery] = await database
        .select()
        .from(schema.githubWebhookDelivery)
        .where(
          eq(
            schema.githubWebhookDelivery.id,
            ledgerId("delivery-babysit-human", CODER_INSTALLATION_ID),
          ),
        );
      expect(delivery?.status).toBe("yielded:human_in_the_loop");
    } finally {
      client.close();
    }
  });

  test("once yielded to a human, a later Reviewer changes_requested is a no-op", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      await seedCoderClaimedIssue(database, {
        babysitRound: 1,
        babysitBlockedReason: "human_in_the_loop",
      });
      const app = createWebhookApp(database);

      const response = await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId: "delivery-babysit-after-yield",
        payload: pullRequestReviewPayload({ reviewState: "changes_requested" }),
      });

      expect((await response.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        reason: "babysit_already_stopped",
      });
      expect(await database.select().from(schema.agentRun)).toHaveLength(0);
    } finally {
      client.close();
    }
  });

  // C7: a bot approval on a repo that is NOT on the auto-merge allow-list (the empty
  // default) comments that the PR is ready and stops — merging stays human.
  test("a bot approved review on a non-allow-listed repo comments ready-to-merge and never merges", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      await seedCoderClaimedIssue(database, { babysitRound: 1 });

      const merges: unknown[] = [];
      const postedComments: Array<{ issueNumber: number; body: string }> = [];
      const app = createWebhookApp(database, {
        async mergeCoderPullRequest(input) {
          merges.push(input);
          return { merged: true, sha: "sha" };
        },
        async postCoderIssueComment(input) {
          postedComments.push(input);
        },
      });

      const response = await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId: "delivery-babysit-approved",
        payload: pullRequestReviewPayload({ reviewState: "approved" }),
      });

      expect((await response.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        issueNumber: BABYSIT_ISSUE_NUMBER,
        reason: "ready_to_merge",
      });
      // Not on the allow-list: never merged, and no run — but a ready-to-merge comment.
      expect(merges).toHaveLength(0);
      expect(await database.select().from(schema.agentRun)).toHaveLength(0);
      expect(postedComments).toHaveLength(1);
      expect(postedComments[0]?.body).toContain("ready to merge");

      // The PR stays open + unmerged (In PR lane), bookkeeping otherwise untouched.
      const [issue] = await database
        .select()
        .from(schema.githubIssue)
        .where(eq(schema.githubIssue.number, BABYSIT_ISSUE_NUMBER));
      expect(issue).toMatchObject({
        babysitRound: 1,
        babysitBlockedReason: null,
        linkedPullRequestMerged: false,
      });

      const [delivery] = await database
        .select()
        .from(schema.githubWebhookDelivery)
        .where(
          eq(
            schema.githubWebhookDelivery.id,
            ledgerId("delivery-babysit-approved", CODER_INSTALLATION_ID),
          ),
        );
      expect(delivery?.status).toBe(`ready_to_merge:${BABYSIT_PR_NUMBER}`);
    } finally {
      client.close();
    }
  });

  test("a HUMAN approval on a non-allow-listed repo stops babysitting, comments ready, and never merges", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      await seedCoderClaimedIssue(database, { babysitRound: 1 });

      const merges: unknown[] = [];
      const app = createWebhookApp(database, {
        async mergeCoderPullRequest(input) {
          merges.push(input);
          return { merged: true, sha: "sha" };
        },
        async postCoderIssueComment() {},
      });

      const response = await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId: "delivery-babysit-human-approved",
        payload: pullRequestReviewPayload({ reviewState: "approved", senderType: "User" }),
      });

      expect(response.status).toBe(202);
      expect((await response.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        event: "pull_request_review",
        issueNumber: BABYSIT_ISSUE_NUMBER,
        // Not allow-listed → ready-to-merge comment, not a merge.
        reason: "ready_to_merge",
      });

      // Humans always win: no fix run, and (non-allow-listed) no merge either.
      expect(await database.select().from(schema.agentRun)).toHaveLength(0);
      expect(merges).toHaveLength(0);

      // The stop is recorded so a later bot changes_requested cannot resume the loop.
      const [issue] = await database
        .select()
        .from(schema.githubIssue)
        .where(eq(schema.githubIssue.number, BABYSIT_ISSUE_NUMBER));
      expect(issue).toMatchObject({ babysitRound: 1, babysitBlockedReason: "human_approved" });

      const [delivery] = await database
        .select()
        .from(schema.githubWebhookDelivery)
        .where(
          eq(
            schema.githubWebhookDelivery.id,
            ledgerId("delivery-babysit-human-approved", CODER_INSTALLATION_ID),
          ),
        );
      expect(delivery?.status).toBe(`ready_to_merge:${BABYSIT_PR_NUMBER}`);

      // Crucially, the board overlay keeps the approved PR OUT of Failed / Blocked —
      // it stays In PR (mergeable) so a human can merge it.
      const overlays = await loadIssueOverlays(database, "repository-record-coder");
      expect(overlays.get(BABYSIT_ISSUE_NUMBER)).toMatchObject({
        blocked: false,
        linkedPullRequest: { state: "open", merged: false },
      });
    } finally {
      client.close();
    }
  });

  // Regression: a later bot changes_requested after a human approval must not resume.
  test("after a human approval, a later Reviewer changes_requested is a no-op (loop stays stopped)", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      await seedCoderClaimedIssue(database, {
        babysitRound: 1,
        babysitBlockedReason: "human_approved",
      });
      const app = createWebhookApp(database);

      const response = await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId: "delivery-babysit-after-approval",
        payload: pullRequestReviewPayload({ reviewState: "changes_requested" }),
      });

      expect((await response.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        reason: "babysit_already_stopped",
      });
      expect(await database.select().from(schema.agentRun)).toHaveLength(0);
    } finally {
      client.close();
    }
  });

  // Finding 3: the claim is stamped by kick-off on whichever repo row the board
  // project is linked through — here the Reviewer app's row (repository-record-1),
  // NOT the Coder app's row the review resolves under. A repo-row-id scoped lookup
  // would miss it and drop the review as no_matching_coder_issue, leaving the whole
  // loop inert. The (org, repo full name) finder matches it across installations.
  test("matches a claim stamped on a DIFFERENT installation's repo row (cross-installation topology)", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      // Claim lives on the Reviewer app's repo row, not the Coder app's.
      await seedCoderClaimedIssue(database, {
        babysitRound: 1,
        githubRepositoryId: "repository-record-1",
        githubInstallationId: "installation-record-1",
      });
      const app = createWebhookApp(database);

      const response = await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId: "delivery-babysit-cross-install",
        payload: pullRequestReviewPayload({ reviewState: "changes_requested" }),
      });

      const admission = (await response.json()) as GitHubWebhookAdmission;
      expect(admission).toMatchObject({
        accepted: true,
        issueNumber: BABYSIT_ISSUE_NUMBER,
      });
      // The fix run was enqueued and the round advanced on the claim, despite the
      // claim living on the other installation's repo row.
      const runs = await database.select().from(schema.agentRun);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({
        branch: BABYSIT_BRANCH,
        issueNumber: BABYSIT_ISSUE_NUMBER,
        pullRequestNumber: BABYSIT_PR_NUMBER,
      });
      const [issue] = await database
        .select()
        .from(schema.githubIssue)
        .where(eq(schema.githubIssue.number, BABYSIT_ISSUE_NUMBER));
      expect(issue?.babysitRound).toBe(2);
    } finally {
      client.close();
    }
  });

  test("a redelivery of the same review is a duplicate — one run, round bumped once", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      await seedCoderClaimedIssue(database, { babysitRound: 1 });
      const app = createWebhookApp(database);
      const deliveryId = "delivery-babysit-dup";
      const payload = pullRequestReviewPayload({ reviewState: "changes_requested" });

      const first = (await (
        await postGitHubWebhook({ app, event: "pull_request_review", deliveryId, payload })
      ).json()) as GitHubWebhookAdmission;
      expect(first.accepted).toBe(true);

      const second = await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId,
        payload,
      });
      expect((await second.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        duplicate: true,
        agentRunId: first.agentRunId,
        reason: "duplicate_delivery",
      });

      // Exactly one run, and the round advanced exactly once.
      expect(await database.select().from(schema.agentRun)).toHaveLength(1);
      const [issue] = await database
        .select()
        .from(schema.githubIssue)
        .where(eq(schema.githubIssue.number, BABYSIT_ISSUE_NUMBER));
      expect(issue?.babysitRound).toBe(2);
    } finally {
      client.close();
    }
  });

  test("a second distinct review while a fix run is still queued does not stack a second run or spend a round", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      await seedCoderClaimedIssue(database, { babysitRound: 1 });
      const app = createWebhookApp(database);

      // First review enqueues the fix run (still queued — the worker hasn't run).
      await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId: "delivery-babysit-inflight-1",
        payload: pullRequestReviewPayload({ reviewState: "changes_requested", reviewId: 6001 }),
      });

      // A second, DISTINCT review delivery for the same PR arrives before the fix
      // lands (a distinct delivery id, so the ledger does not dedup it).
      const second = await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId: "delivery-babysit-inflight-2",
        payload: pullRequestReviewPayload({ reviewState: "changes_requested", reviewId: 6002 }),
      });
      expect((await second.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        reason: "babysit_run_in_flight",
      });

      // Still exactly one run, and the round advanced only once (1 → 2).
      expect(await database.select().from(schema.agentRun)).toHaveLength(1);
      const [issue] = await database
        .select()
        .from(schema.githubIssue)
        .where(eq(schema.githubIssue.number, BABYSIT_ISSUE_NUMBER));
      expect(issue?.babysitRound).toBe(2);
    } finally {
      client.close();
    }
  });

  test("ignores the Reviewer app's copy of the review — only the Coder app's copy babysits", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      await seedCoderClaimedIssue(database, { babysitRound: 1 });
      const app = createWebhookApp(database);

      // The reviewer app (installation-record-1 / hosted-agents slug) delivers its
      // copy on the reviewer-linked repository — its worker role is code_review.
      const response = await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId: "delivery-babysit-reviewer-copy",
        payload: pullRequestReviewPayload({
          installationId: INSTALLATION_ID,
          repositoryId: GITHUB_REPOSITORY_ID,
        }),
      });

      expect((await response.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        reason: "installation_app_not_coder",
      });
      expect(await database.select().from(schema.agentRun)).toHaveLength(0);
      const [delivery] = await database
        .select()
        .from(schema.githubWebhookDelivery)
        .where(
          eq(
            schema.githubWebhookDelivery.id,
            ledgerId("delivery-babysit-reviewer-copy", INSTALLATION_ID),
          ),
        );
      expect(delivery?.status).toBe("ignored:installation_app_not_coder");
    } finally {
      client.close();
    }
  });

  test("ignores a review on a PR that no Coder-claimed issue owns", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      // No claimed issue seeded for this PR/branch.
      const app = createWebhookApp(database);

      const response = await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId: "delivery-babysit-no-claim",
        payload: pullRequestReviewPayload({
          pullRequestNumber: 777,
          headRef: "feature/human-work",
        }),
      });

      expect((await response.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        reason: "no_matching_coder_issue",
      });
      expect(await database.select().from(schema.agentRun)).toHaveLength(0);
    } finally {
      client.close();
    }
  });

  test("acknowledges a non-submitted review action without side effects", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      await seedCoderClaimedIssue(database, { babysitRound: 1 });
      const app = createWebhookApp(database);

      const response = await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId: "delivery-babysit-dismissed",
        payload: { ...pullRequestReviewPayload(), action: "dismissed" },
      });

      expect(response.status).toBe(202);
      expect((await response.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        reason: "event_not_admitted",
      });
      expect(await database.select().from(schema.agentRun)).toHaveLength(0);
      // A non-submitted action never claims a delivery-ledger row.
      expect(await database.select().from(schema.githubWebhookDelivery)).toHaveLength(0);
    } finally {
      client.close();
    }
  });

  // Humans always win (spec #21 story 8): a human push to a Coder-owned PR ends
  // babysitting. Without this the Reviewer's re-review of the human push would
  // dispatch the Coder onto the human's branch for the remaining rounds.
  test("a human push (synchronize) to a Coder-owned PR yields: no review run, PR dropped to human-in-the-loop", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      await seedCoderClaimedIssue(database, { babysitRound: 1 });
      const app = createWebhookApp(database);

      const response = await postGitHubWebhook({
        app,
        event: "pull_request",
        deliveryId: "delivery-human-push",
        payload: pullRequestPayload("synchronize", {
          senderType: "User",
          headRef: BABYSIT_BRANCH,
          pullRequestNumber: BABYSIT_PR_NUMBER,
        }),
      });

      expect(response.status).toBe(202);
      expect((await response.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        event: "pull_request",
        issueNumber: BABYSIT_ISSUE_NUMBER,
        reason: "human_in_the_loop",
      });

      // Humans always win: no Reviewer run is queued for the human's push.
      expect(await database.select().from(schema.agentRun)).toHaveLength(0);

      const [issue] = await database
        .select()
        .from(schema.githubIssue)
        .where(eq(schema.githubIssue.number, BABYSIT_ISSUE_NUMBER));
      expect(issue).toMatchObject({
        // The round is untouched; the stop reason records the human takeover.
        babysitRound: 1,
        babysitBlockedReason: "human_in_the_loop",
      });

      const [delivery] = await database
        .select()
        .from(schema.githubWebhookDelivery)
        .where(
          eq(schema.githubWebhookDelivery.id, ledgerId("delivery-human-push", INSTALLATION_ID)),
        );
      expect(delivery?.status).toBe("yielded:human_in_the_loop");
    } finally {
      client.close();
    }
  });

  test("the Coder's own fix push (bot synchronize) still triggers a re-review — the loop is untouched", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      await seedCoderClaimedIssue(database, { babysitRound: 1 });
      const app = createWebhookApp(database);

      const response = await postGitHubWebhook({
        app,
        event: "pull_request",
        deliveryId: "delivery-bot-push",
        payload: pullRequestPayload("synchronize", {
          senderType: "Bot",
          headRef: BABYSIT_BRANCH,
          pullRequestNumber: BABYSIT_PR_NUMBER,
        }),
      });

      const admission = (await response.json()) as GitHubWebhookAdmission;
      expect(admission.accepted).toBe(true);
      expect(admission.agentRunId).toBeTruthy();

      // A bot push is the intended re-review trigger — one review run, no yield.
      const runs = await database.select().from(schema.agentRun);
      expect(runs).toHaveLength(1);
      expect(runs[0]).toMatchObject({ workerRole: "code_review" });

      const [issue] = await database
        .select()
        .from(schema.githubIssue)
        .where(eq(schema.githubIssue.number, BABYSIT_ISSUE_NUMBER));
      expect(issue).toMatchObject({ babysitRound: 1, babysitBlockedReason: null });
    } finally {
      client.close();
    }
  });

  test("a human push to a PR no Coder-claimed issue owns still queues a review (Reviewer runs freely)", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      // No Coder claim for this PR/branch — it is an ordinary human PR.
      const app = createWebhookApp(database);

      const response = await postGitHubWebhook({
        app,
        event: "pull_request",
        deliveryId: "delivery-human-push-no-claim",
        payload: pullRequestPayload("synchronize", {
          senderType: "User",
          headRef: "feature/human-work",
          pullRequestNumber: 999,
        }),
      });

      const admission = (await response.json()) as GitHubWebhookAdmission;
      expect(admission.accepted).toBe(true);
      expect(await database.select().from(schema.agentRun)).toHaveLength(1);
    } finally {
      client.close();
    }
  });

  test("a human comment on a Coder-owned PR yields babysitting: no run, PR dropped to human-in-the-loop", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      await seedCoderClaimedIssue(database, { babysitRound: 1 });
      const app = createWebhookApp(database);

      const response = await postGitHubWebhook({
        app,
        event: "issue_comment",
        deliveryId: "delivery-human-comment",
        payload: issueCommentPayload("created", {
          number: BABYSIT_PR_NUMBER,
          prShaped: true,
          senderType: "User",
        }),
      });

      expect(response.status).toBe(202);
      expect((await response.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        event: "issue_comment",
        issueNumber: BABYSIT_ISSUE_NUMBER,
        reason: "human_in_the_loop",
      });

      expect(await database.select().from(schema.agentRun)).toHaveLength(0);
      // A PR comment is never synced to the issues board.
      expect(await database.select().from(schema.githubIssueComment)).toHaveLength(0);

      const [issue] = await database
        .select()
        .from(schema.githubIssue)
        .where(eq(schema.githubIssue.number, BABYSIT_ISSUE_NUMBER));
      expect(issue).toMatchObject({ babysitRound: 1, babysitBlockedReason: "human_in_the_loop" });

      const [delivery] = await database
        .select()
        .from(schema.githubWebhookDelivery)
        .where(
          eq(schema.githubWebhookDelivery.id, ledgerId("delivery-human-comment", INSTALLATION_ID)),
        );
      expect(delivery?.status).toBe("yielded:human_in_the_loop");
    } finally {
      client.close();
    }
  });

  test("a human comment once yielded is a no-op (already stopped), never re-recorded", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      await seedCoderClaimedIssue(database, {
        babysitRound: 2,
        babysitBlockedReason: "round_cap_reached",
      });
      const app = createWebhookApp(database);

      const response = await postGitHubWebhook({
        app,
        event: "issue_comment",
        deliveryId: "delivery-human-comment-stopped",
        payload: issueCommentPayload("created", {
          number: BABYSIT_PR_NUMBER,
          prShaped: true,
          senderType: "User",
        }),
      });

      expect((await response.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        reason: "babysit_already_stopped",
      });
      expect(await database.select().from(schema.agentRun)).toHaveLength(0);

      // The prior stop reason is left intact — the human comment does not clobber it.
      const [issue] = await database
        .select()
        .from(schema.githubIssue)
        .where(eq(schema.githubIssue.number, BABYSIT_ISSUE_NUMBER));
      expect(issue?.babysitBlockedReason).toBe("round_cap_reached");
    } finally {
      client.close();
    }
  });

  test("a human comment on a PR no Coder-claimed issue owns is off-board (pull_request_shaped, no ledger row)", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      // No Coder claim — an ordinary human PR comment is off the issues board.
      const app = createWebhookApp(database);

      const response = await postGitHubWebhook({
        app,
        event: "issue_comment",
        deliveryId: "delivery-human-comment-no-claim",
        payload: issueCommentPayload("created", {
          number: BABYSIT_PR_NUMBER,
          prShaped: true,
          senderType: "User",
        }),
      });

      expect((await response.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        reason: "pull_request_shaped",
      });
      // Same as any other PR comment: nothing synced, no ledger row claimed.
      expect(await database.select().from(schema.agentRun)).toHaveLength(0);
      expect(await database.select().from(schema.githubWebhookDelivery)).toHaveLength(0);
    } finally {
      client.close();
    }
  });
});

// The auto-merge allow-list injected in these tests so `octo-org/widgets` (the
// seeded repo) is allow-listed — the default env allow-list is empty.
const AUTOMERGE_ALLOW_LIST = new Set(["octo-org/widgets"]);

describe("GitHub webhook auto-merge (C7)", () => {
  test("an approved review on an allow-listed Coder PR squash-merges it and stamps the Merged lane", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      await seedCoderClaimedIssue(database, { babysitRound: 1 });

      const merges: Array<{
        installationId: string;
        owner: string;
        repo: string;
        pullRequestNumber: number;
      }> = [];
      const postedComments: Array<{ issueNumber: number; body: string }> = [];
      const app = createWebhookApp(database, {
        automergeRepositories: AUTOMERGE_ALLOW_LIST,
        async mergeCoderPullRequest(input) {
          merges.push(input);
          return { merged: true, sha: "merge-sha-42" };
        },
        async postCoderIssueComment(input) {
          postedComments.push(input);
        },
      });

      const response = await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId: "delivery-automerge",
        payload: pullRequestReviewPayload({ reviewState: "approved" }),
      });

      expect(response.status).toBe(202);
      expect((await response.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        event: "pull_request_review",
        issueNumber: BABYSIT_ISSUE_NUMBER,
        reason: "merged",
      });

      // The Coder squash-merged its own PR via the Coder installation.
      expect(merges).toEqual([
        {
          installationId: String(CODER_INSTALLATION_ID),
          owner: "octo-org",
          repo: "widgets",
          pullRequestNumber: BABYSIT_PR_NUMBER,
        },
      ]);
      // No fix run enqueued on an approval.
      expect(await database.select().from(schema.agentRun)).toHaveLength(0);

      // The issue row is stamped merged → Merged lane.
      const [issue] = await database
        .select()
        .from(schema.githubIssue)
        .where(eq(schema.githubIssue.number, BABYSIT_ISSUE_NUMBER));
      expect(issue).toMatchObject({
        linkedPullRequestNumber: BABYSIT_PR_NUMBER,
        linkedPullRequestState: "closed",
        linkedPullRequestMerged: true,
      });
      const overlays = await loadIssueOverlays(database, "repository-record-coder");
      expect(overlays.get(BABYSIT_ISSUE_NUMBER)).toMatchObject({
        blocked: false,
        linkedPullRequest: { state: "closed", merged: true },
      });

      // A Coder comment on the issue announced the merge.
      expect(postedComments).toHaveLength(1);
      expect(postedComments[0]).toMatchObject({ issueNumber: BABYSIT_ISSUE_NUMBER });
      expect(postedComments[0]?.body).toContain("Merged pull request");

      const [delivery] = await database
        .select()
        .from(schema.githubWebhookDelivery)
        .where(
          eq(
            schema.githubWebhookDelivery.id,
            ledgerId("delivery-automerge", CODER_INSTALLATION_ID),
          ),
        );
      expect(delivery?.status).toBe(`merged:${BABYSIT_PR_NUMBER}`);
    } finally {
      client.close();
    }
  });

  test("a HUMAN approval on an allow-listed Coder PR merges AND records the human_approved stop", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      await seedCoderClaimedIssue(database, { babysitRound: 1 });

      const merges: unknown[] = [];
      const app = createWebhookApp(database, {
        automergeRepositories: AUTOMERGE_ALLOW_LIST,
        async mergeCoderPullRequest(input) {
          merges.push(input);
          return { merged: true, sha: "merge-sha-42" };
        },
        async postCoderIssueComment() {},
      });

      const response = await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId: "delivery-automerge-human",
        payload: pullRequestReviewPayload({ reviewState: "approved", senderType: "User" }),
      });

      expect((await response.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        reason: "merged",
      });
      // A human approval on an allow-listed Coder PR SHOULD merge (that is the point).
      expect(merges).toHaveLength(1);

      const [issue] = await database
        .select()
        .from(schema.githubIssue)
        .where(eq(schema.githubIssue.number, BABYSIT_ISSUE_NUMBER));
      // The human_approved stop is still recorded (humans always win — no later bot
      // review resumes), and the PR is merged (Merged lane, not Failed / Blocked).
      expect(issue).toMatchObject({
        babysitBlockedReason: "human_approved",
        linkedPullRequestMerged: true,
      });
      const overlays = await loadIssueOverlays(database, "repository-record-coder");
      expect(overlays.get(BABYSIT_ISSUE_NUMBER)).toMatchObject({ blocked: false });
    } finally {
      client.close();
    }
  });

  test("a human-STOPPED (takeover) claim never auto-merges, even on an approved review", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      // A human already took the PR over (Failed / Blocked). A later approval (bot or
      // human-after-stop → noop:approved_review) must NOT merge.
      await seedCoderClaimedIssue(database, {
        babysitRound: 1,
        babysitBlockedReason: "human_in_the_loop",
      });

      const merges: unknown[] = [];
      const postedComments: unknown[] = [];
      const app = createWebhookApp(database, {
        automergeRepositories: AUTOMERGE_ALLOW_LIST,
        async mergeCoderPullRequest(input) {
          merges.push(input);
          return { merged: true, sha: "sha" };
        },
        async postCoderIssueComment(input) {
          postedComments.push(input);
        },
      });

      const response = await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId: "delivery-automerge-human-stopped",
        payload: pullRequestReviewPayload({ reviewState: "approved" }),
      });

      expect((await response.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        reason: "babysit_stopped",
      });
      // Humans took over: no merge, no ready-to-merge comment.
      expect(merges).toHaveLength(0);
      expect(postedComments).toHaveLength(0);

      const [issue] = await database
        .select()
        .from(schema.githubIssue)
        .where(eq(schema.githubIssue.number, BABYSIT_ISSUE_NUMBER));
      expect(issue?.linkedPullRequestMerged).toBeFalsy();
      const [delivery] = await database
        .select()
        .from(schema.githubWebhookDelivery)
        .where(
          eq(
            schema.githubWebhookDelivery.id,
            ledgerId("delivery-automerge-human-stopped", CODER_INSTALLATION_ID),
          ),
        );
      expect(delivery?.status).toBe("ignored:babysit_stopped");
    } finally {
      client.close();
    }
  });

  test("a redelivered approval after the merge already landed is an idempotent no-op", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      await seedCoderClaimedIssue(database, { babysitRound: 1 });

      const merges: unknown[] = [];
      const app = createWebhookApp(database, {
        automergeRepositories: AUTOMERGE_ALLOW_LIST,
        async mergeCoderPullRequest(input) {
          merges.push(input);
          return { merged: true, sha: "sha" };
        },
        async postCoderIssueComment() {},
      });

      // First approval merges (mock records one call, issue stamped merged).
      const first = await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId: "delivery-automerge-first",
        payload: pullRequestReviewPayload({ reviewState: "approved", reviewId: 7001 }),
      });
      expect((await first.json()) as GitHubWebhookAdmission).toMatchObject({ reason: "merged" });
      expect(merges).toHaveLength(1);

      // A SECOND, distinct approval delivery (e.g. a re-approval) arrives. The linked
      // PR is already stamped merged, so decideAutoMerge skips — no second merge call.
      const second = await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId: "delivery-automerge-second",
        payload: pullRequestReviewPayload({ reviewState: "approved", reviewId: 7002 }),
      });
      expect((await second.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        reason: "already_merged",
      });
      // The merge was called exactly once across both deliveries.
      expect(merges).toHaveLength(1);
      const [delivery] = await database
        .select()
        .from(schema.githubWebhookDelivery)
        .where(
          eq(
            schema.githubWebhookDelivery.id,
            ledgerId("delivery-automerge-second", CODER_INSTALLATION_ID),
          ),
        );
      expect(delivery?.status).toBe("ignored:already_merged");
    } finally {
      client.close();
    }
  });

  test("a merge API failure records the failure durably and never crash-loops", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      await seedCoderClaimedIssue(database, { babysitRound: 1 });

      const app = createWebhookApp(database, {
        automergeRepositories: AUTOMERGE_ALLOW_LIST,
        async mergeCoderPullRequest() {
          throw new Error("GitHub merge failed: base branch was modified");
        },
        async postCoderIssueComment() {},
      });

      const response = await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId: "delivery-automerge-fail",
        payload: pullRequestReviewPayload({ reviewState: "approved" }),
      });

      // No crash / 500 — a normal 202 admission that records the failure.
      expect(response.status).toBe(202);
      expect((await response.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        issueNumber: BABYSIT_ISSUE_NUMBER,
        reason: "merge_failed",
      });

      // The issue is NOT stamped merged — it stays In PR for a human / retry.
      const [issue] = await database
        .select()
        .from(schema.githubIssue)
        .where(eq(schema.githubIssue.number, BABYSIT_ISSUE_NUMBER));
      expect(issue?.linkedPullRequestMerged).toBeFalsy();

      // The failure is durably recorded on the delivery ledger.
      const [delivery] = await database
        .select()
        .from(schema.githubWebhookDelivery)
        .where(
          eq(
            schema.githubWebhookDelivery.id,
            ledgerId("delivery-automerge-fail", CODER_INSTALLATION_ID),
          ),
        );
      expect(delivery?.status).toBe(`merge_failed:${BABYSIT_PR_NUMBER}`);
    } finally {
      client.close();
    }
  });

  test("an approved review on a CLOSED pull request does not merge (skip)", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      await seedCoderInstallationTarget(database);
      await seedCoderClaimedIssue(database, { babysitRound: 1 });

      const merges: unknown[] = [];
      const app = createWebhookApp(database, {
        automergeRepositories: AUTOMERGE_ALLOW_LIST,
        async mergeCoderPullRequest(input) {
          merges.push(input);
          return { merged: true, sha: "sha" };
        },
        async postCoderIssueComment() {},
      });

      const payload = pullRequestReviewPayload({ reviewState: "approved" });
      // The PR reads closed on this delivery (e.g. merged/closed out-of-band).
      (payload.pull_request as { state: string }).state = "closed";

      const response = await postGitHubWebhook({
        app,
        event: "pull_request_review",
        deliveryId: "delivery-automerge-closed",
        payload,
      });

      expect((await response.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: false,
        reason: "pull_request_not_open",
      });
      expect(merges).toHaveLength(0);
    } finally {
      client.close();
    }
  });
});

const ISSUE_NODE_GITHUB_ID = 555_000;

function issuePayload(
  action: string,
  overrides: {
    number?: number;
    labels?: string[];
    state?: "open" | "closed";
    title?: string;
    body?: string | null;
    comments?: number;
  } = {},
) {
  const number = overrides.number ?? 7;
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
    issue: {
      number,
      id: ISSUE_NODE_GITHUB_ID + number,
      node_id: `I_issue_${number}`,
      title: overrides.title ?? `Issue #${number}`,
      body: overrides.body === undefined ? "An issue body" : overrides.body,
      state: overrides.state ?? "open",
      user: { login: "octocat", avatar_url: "https://avatars.githubusercontent.com/u/1" },
      labels: (overrides.labels ?? []).map((name) => ({ name })),
      html_url: `https://github.com/octo-org/widgets/issues/${number}`,
      comments: overrides.comments ?? 0,
      created_at: "2026-07-08T10:00:00Z",
      updated_at: "2026-07-08T11:00:00Z",
    },
  };
}

function issueCommentPayload(
  action: string,
  overrides: {
    number?: number;
    commentId?: number;
    body?: string;
    prShaped?: boolean;
    senderType?: string;
    installationId?: number;
    repositoryId?: number;
  } = {},
) {
  const number = overrides.number ?? 7;
  const base = issuePayload("opened", { number });
  const issue = overrides.prShaped
    ? {
        ...base.issue,
        pull_request: {
          url: "https://api.github.com/repos/octo-org/widgets/pulls/7",
          html_url: "https://github.com/octo-org/widgets/pull/7",
        },
      }
    : base.issue;

  const installation =
    overrides.installationId === undefined ? base.installation : { id: overrides.installationId };
  const repository =
    overrides.repositoryId === undefined
      ? base.repository
      : { ...base.repository, id: overrides.repositoryId };
  const login = overrides.senderType === "User" ? "octo-maintainer" : "octocat";

  return {
    action,
    installation,
    repository,
    issue,
    comment: {
      id: overrides.commentId ?? 900_100,
      body: overrides.body ?? "A synced comment",
      html_url: `https://github.com/octo-org/widgets/issues/${number}#issuecomment-1`,
      user: { login, avatar_url: "https://avatars.githubusercontent.com/u/1" },
      created_at: "2026-07-08T12:00:00Z",
      updated_at: "2026-07-08T12:00:00Z",
    },
    // Only attach a sender when a test opts in — the base sync cases must keep
    // routing to the board store, not the human-comment yield.
    ...(overrides.senderType ? { sender: { login, type: overrides.senderType } } : {}),
  };
}

describe("GitHub webhook issue sync", () => {
  test("upserts a github_issue row for an issues.opened delivery", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      const app = createWebhookApp(database);
      const deliveryId = "delivery-issue-opened";

      const response = await postGitHubWebhook({
        app,
        event: "issues",
        deliveryId,
        payload: issuePayload("opened", { number: 7, title: "Sync me", comments: 2 }),
      });

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({
        ok: true,
        accepted: true,
        duplicate: false,
        event: "issues",
        action: "opened",
        deliveryId,
        issueNumber: 7,
      });

      const issues = await database.select().from(schema.githubIssue);
      expect(issues).toHaveLength(1);
      expect(issues[0]).toMatchObject({
        organizationId: "org-1",
        githubRepositoryId: "repository-record-1",
        githubInstallationId: "installation-record-1",
        repositoryFullName: "octo-org/widgets",
        number: 7,
        githubIssueId: String(ISSUE_NODE_GITHUB_ID + 7),
        title: "Sync me",
        state: "open",
        authorLogin: "octocat",
        labelsJson: "[]",
        commentCount: 2,
        // Claim / linked-PR bookkeeping is left untouched by a GitHub sync.
        claimedByRunId: null,
        linkedPullRequestState: null,
        closedByMerge: false,
      });

      const [delivery] = await database
        .select()
        .from(schema.githubWebhookDelivery)
        .where(eq(schema.githubWebhookDelivery.id, ledgerId(deliveryId, INSTALLATION_ID)));
      expect(delivery).toMatchObject({
        id: ledgerId(deliveryId, INSTALLATION_ID),
        event: "issues",
        action: "opened",
        status: "accepted",
        agentRunId: null,
        reviewRunId: null,
      });
      // Syncing an issue never queues a review run.
      expect(await database.select().from(schema.agentRun)).toHaveLength(0);
    } finally {
      client.close();
    }
  });

  test("an issues.labeled delivery refreshes labels without clobbering a recorded claim", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      const app = createWebhookApp(database);

      await postGitHubWebhook({
        app,
        event: "issues",
        deliveryId: "delivery-issue-open-first",
        payload: issuePayload("opened", { number: 7 }),
      });

      // Simulate a claim + linked PR our own code recorded after the first sync.
      await database
        .update(schema.githubIssue)
        .set({
          claimedByRunId: "run-7",
          claimedByWorkerRole: "implementation",
          linkedPullRequestState: "open",
          linkedPullRequestMerged: false,
        })
        .where(eq(schema.githubIssue.number, 7));

      const response = await postGitHubWebhook({
        app,
        event: "issues",
        deliveryId: "delivery-issue-labeled",
        payload: issuePayload("labeled", { number: 7, labels: ["ready for agent"] }),
      });

      expect(response.status).toBe(202);
      expect((await response.json()) as GitHubWebhookAdmission).toMatchObject({
        accepted: true,
        event: "issues",
        action: "labeled",
        issueNumber: 7,
      });

      const issues = await database.select().from(schema.githubIssue);
      expect(issues).toHaveLength(1);
      expect(JSON.parse(issues[0]?.labelsJson ?? "[]")).toEqual(["ready for agent"]);
      // The GitHub-sourced label refreshed; the claim + linked PR survived the upsert.
      expect(issues[0]).toMatchObject({
        claimedByRunId: "run-7",
        claimedByWorkerRole: "implementation",
        linkedPullRequestState: "open",
      });
    } finally {
      client.close();
    }
  });

  test("upserts a github_issue_comment row linked to its synced issue", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      const app = createWebhookApp(database);

      await postGitHubWebhook({
        app,
        event: "issues",
        deliveryId: "delivery-issue-open-for-comment",
        payload: issuePayload("opened", { number: 7 }),
      });

      const response = await postGitHubWebhook({
        app,
        event: "issue_comment",
        deliveryId: "delivery-comment-created",
        payload: issueCommentPayload("created", { number: 7, commentId: 900, body: "hello world" }),
      });

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({
        ok: true,
        accepted: true,
        duplicate: false,
        event: "issue_comment",
        action: "created",
        deliveryId: "delivery-comment-created",
        issueNumber: 7,
      });

      const comments = await database.select().from(schema.githubIssueComment);
      expect(comments).toHaveLength(1);
      expect(comments[0]).toMatchObject({
        organizationId: "org-1",
        githubRepositoryId: "repository-record-1",
        issueNumber: 7,
        githubCommentId: "900",
        authorKind: "external",
        authorLogin: "octocat",
        body: "hello world",
      });

      const [issue] = await database
        .select()
        .from(schema.githubIssue)
        .where(eq(schema.githubIssue.number, 7));
      expect(comments[0]?.issueId).toBe(issue?.id ?? "");
    } finally {
      client.close();
    }
  });

  test("treats an issues.opened redelivery as a duplicate", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      const app = createWebhookApp(database);
      const deliveryId = "delivery-issue-dup";
      const payload = issuePayload("opened", { number: 7 });

      const first = await postGitHubWebhook({ app, event: "issues", deliveryId, payload });
      expect(((await first.json()) as GitHubWebhookAdmission).accepted).toBe(true);

      const second = await postGitHubWebhook({ app, event: "issues", deliveryId, payload });
      expect(second.status).toBe(202);
      expect(await second.json()).toEqual({
        ok: true,
        accepted: false,
        duplicate: true,
        event: "issues",
        action: "opened",
        deliveryId,
        reason: "duplicate_delivery",
      });

      // The redelivery neither duplicated the synced row nor the ledger entry.
      expect(await database.select().from(schema.githubIssue)).toHaveLength(1);
      expect(await database.select().from(schema.githubWebhookDelivery)).toHaveLength(1);
    } finally {
      client.close();
    }
  });

  test("ignores an issue_comment delivery on a pull request without syncing it", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      const app = createWebhookApp(database);
      const deliveryId = "delivery-pr-comment";

      const response = await postGitHubWebhook({
        app,
        event: "issue_comment",
        deliveryId,
        payload: issueCommentPayload("created", { number: 7, prShaped: true }),
      });

      expect(response.status).toBe(202);
      expect(await response.json()).toEqual({
        ok: true,
        accepted: false,
        duplicate: false,
        event: "issue_comment",
        action: "created",
        deliveryId,
        reason: "pull_request_shaped",
      });

      // A PR comment is off the issues board: nothing synced, no ledger row claimed.
      expect(await database.select().from(schema.githubIssueComment)).toHaveLength(0);
      expect(await database.select().from(schema.githubWebhookDelivery)).toHaveLength(0);
    } finally {
      client.close();
    }
  });

  // P5 (issue #26): the board/detail refresh themselves off this store-only
  // watermark, polled on an interval instead of polling GitHub. It must flip on
  // every kind of synced change so no change is missed between polls.
  test("the store-only revision watermark flips on every synced issue + comment change", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      const app = createWebhookApp(database);
      const repositoryId = "repository-record-1";

      // Empty store: the stable baseline the board polls before anything syncs.
      const empty = await loadRepositoryIssuesRevision(database, repositoryId);

      // issues.opened → a new row → the watermark moves (row count up).
      await postGitHubWebhook({
        app,
        event: "issues",
        deliveryId: "rev-issue-opened",
        payload: issuePayload("opened", { number: 7 }),
      });
      const afterOpen = await loadRepositoryIssuesRevision(database, repositoryId);
      expect(afterOpen).not.toBe(empty);

      // issues.labeled → the same row re-upserted → the watermark moves (updatedAt up),
      // so an in-place edit (label / stage change) is caught even though the count is flat.
      await postGitHubWebhook({
        app,
        event: "issues",
        deliveryId: "rev-issue-labeled",
        payload: issuePayload("labeled", { number: 7, labels: ["ready for agent"] }),
      });
      const afterLabel = await loadRepositoryIssuesRevision(database, repositoryId);
      expect(afterLabel).not.toBe(afterOpen);

      // issue_comment.created → a new comment row → the watermark moves (comment count up).
      await postGitHubWebhook({
        app,
        event: "issue_comment",
        deliveryId: "rev-comment-created",
        payload: issueCommentPayload("created", { number: 7, commentId: 900, body: "first" }),
      });
      const afterComment = await loadRepositoryIssuesRevision(database, repositoryId);
      expect(afterComment).not.toBe(afterLabel);

      // issue_comment.deleted → the row is removed → the watermark moves (count down),
      // so a deletion refreshes the board too, not only additions.
      await postGitHubWebhook({
        app,
        event: "issue_comment",
        deliveryId: "rev-comment-deleted",
        payload: issueCommentPayload("deleted", { number: 7, commentId: 900 }),
      });
      const afterDelete = await loadRepositoryIssuesRevision(database, repositoryId);
      expect(afterDelete).not.toBe(afterComment);
    } finally {
      client.close();
    }
  });

  test("the issue-scoped revision isolates one issue from another", async () => {
    const { client, database } = await createTestDatabase();
    try {
      await seedLinkedPullRequestTarget(database);
      const app = createWebhookApp(database);
      const repositoryId = "repository-record-1";

      for (const number of [7, 8]) {
        await postGitHubWebhook({
          app,
          event: "issues",
          deliveryId: `rev-scope-open-${number}`,
          payload: issuePayload("opened", { number }),
        });
      }

      const issue7Before = await loadRepositoryIssuesRevision(database, repositoryId, 7);
      const issue8Before = await loadRepositoryIssuesRevision(database, repositoryId, 8);

      // A comment on #7 moves #7's scoped watermark but leaves #8's untouched, so an
      // open detail view for #8 never refetches because an unrelated issue changed.
      await postGitHubWebhook({
        app,
        event: "issue_comment",
        deliveryId: "rev-scope-comment-7",
        payload: issueCommentPayload("created", { number: 7, commentId: 700, body: "on seven" }),
      });

      expect(await loadRepositoryIssuesRevision(database, repositoryId, 7)).not.toBe(issue7Before);
      expect(await loadRepositoryIssuesRevision(database, repositoryId, 8)).toBe(issue8Before);
    } finally {
      client.close();
    }
  });
});
