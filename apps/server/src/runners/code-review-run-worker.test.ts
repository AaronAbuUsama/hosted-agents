import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import type { db as productionDb } from "@hosted-agents/db";
import * as schema from "@hosted-agents/db/schema/index";
import {
  CodeReviewSandboxRunError,
  type CodeReviewSandboxRunInput,
  type CodeReviewSandboxRunner,
} from "./code-review-sandbox-runner";

process.env.SKIP_ENV_VALIDATION = "true";
process.env.DATABASE_URL = ":memory:";
process.env.BETTER_AUTH_SECRET = "test-better-auth-secret-32-bytes";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.CORS_ORIGIN = "http://localhost:3000";
process.env.NODE_ENV = "test";

const { drainQueuedCodeReviews, recoverStaleRunningCodeReviews, runNextQueuedCodeReview } =
  await import("./code-review-run-worker");

type TestDatabase = typeof productionDb;
type TestClient = {
  close(): void;
  executeMultiple(sql: string): Promise<void>;
};

async function createTestDatabase() {
  const testDatabaseDirectory = mkdtempSync(join(tmpdir(), "code-review-worker-test-"));
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

    CREATE TABLE "agent_run_sandbox" (
      "id" text PRIMARY KEY,
      "run_id" text NOT NULL,
      "provider" text NOT NULL,
      "sandbox_id" text NOT NULL,
      "status" text NOT NULL,
      "labels_json" text,
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

async function seedBaseRecords(database: TestDatabase) {
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
    installationId: "123456",
    appSlug: "localhost-abu-bakr-at-coworker",
    status: "connected",
    installedByUserId: "user-1",
  });

  await database.insert(schema.githubRepository).values({
    id: "repository-record-1",
    installationId: "installation-record-1",
    githubRepositoryId: "987654",
    owner: "octo-org",
    name: "widgets",
    fullName: "octo-org/widgets",
    selected: true,
  });
}

async function seedGithubRun(
  database: TestDatabase,
  overrides: Partial<typeof schema.agentRun.$inferInsert> = {},
) {
  await seedBaseRecords(database);
  await database.insert(schema.agentRun).values({
    id: "agent-run-1",
    organizationId: "org-1",
    userId: "user-1",
    providerCredentialId: "credential-1",
    coworkerSlug: "code-review",
    workerRole: "code_review",
    workerDisplayName: "Code Review Worker",
    runType: "github.pull_request_review",
    sourceProvider: "github",
    sourceDeliveryId: "delivery-1",
    repositoryOwner: "octo-org",
    repositoryName: "widgets",
    branch: "feature/slice",
    baseBranch: "main",
    githubInstallationId: "installation-record-1",
    githubRepositoryId: "repository-record-1",
    pullRequestNumber: 42,
    pullRequestBaseRef: "main",
    pullRequestBaseSha: "base-sha",
    pullRequestHeadRef: "feature/slice",
    pullRequestHeadSha: "head-sha",
    status: "queued",
    ...overrides,
  });
}

function createFakeTokenFactory() {
  return async (installationId: string) => `fake-token-for-${installationId}`;
}

describe("code review run worker", () => {
  test("claims a queued GitHub agent run, stores lifecycle events, and stores the result", async () => {
    const { client, database } = await createTestDatabase();
    const calls: CodeReviewSandboxRunInput[] = [];
    const runner: CodeReviewSandboxRunner = {
      async run(input) {
        calls.push(input);
        await input.onEvent?.({
          type: "sandbox.created",
          sandboxProvider: "fake-sandbox",
          sandboxId: "sandbox-1",
          labels: { app: "hosted-agents", agentRunId: input.agentRunId },
        });
        await input.onEvent?.({
          type: "stage",
          stage: "repository_cloning",
          message: "Cloning test repository",
        });
        await input.onEvent?.({
          type: "flue.event",
          event: { type: "tool_result", eventIndex: 1, toolName: "shell" },
        });
        await input.onEvent?.({
          type: "github.tool",
          toolName: "submit_pull_request_review",
          status: "completed",
          message: "GitHub pull request review submitted",
          payload: { reviewId: 123, reviewUrl: "https://github.test/review/123" },
        });
        await input.onEvent?.({
          type: "github.artifact",
          name: "github/pull-request-review.json",
          contentType: "application/json",
          payload: { reviewId: 123, reviewUrl: "https://github.test/review/123" },
        });
        await Promise.all(
          Array.from({ length: 5 }, (_, index) =>
            input.onEvent?.({
              type: "flue.event",
              event: { type: "turn", eventIndex: 100 + index },
            }),
          ),
        );
        await input.onEvent?.({ type: "sandbox.deleted", sandboxId: "sandbox-1" });

        return {
          sandboxProvider: "fake-sandbox",
          sandboxId: "sandbox-1",
          summary: "Review completed.",
          findingsJson: JSON.stringify([{ title: "Bug", severity: "high", detail: "Bad bug." }]),
          artifacts: [{ name: "review.md", contentType: "text/markdown", content: "# Review" }],
          logs: "fake logs",
        };
      },
    };

    try {
      await seedGithubRun(database);

      const result = await runNextQueuedCodeReview({
        runner,
        database,
        createInstallationAccessToken: createFakeTokenFactory(),
      });

      expect(result).toEqual({
        status: "completed",
        agentRunId: "agent-run-1",
        sandboxId: "sandbox-1",
      });
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        agentRunId: "agent-run-1",
        organizationId: "org-1",
        workerRole: "code_review",
        workerDisplayName: "Code Review Worker",
        providerCredentialId: "credential-1",
        githubInstallationId: "installation-record-1",
        githubRepositoryId: "repository-record-1",
        installationId: "123456",
        installationAccessToken: "fake-token-for-123456",
        owner: "octo-org",
        repo: "widgets",
        pullRequestNumber: 42,
      });

      const [row] = await database
        .select()
        .from(schema.agentRun)
        .where(eq(schema.agentRun.id, "agent-run-1"));
      expect(row).toMatchObject({
        status: "completed",
        sandboxProvider: "fake-sandbox",
        sandboxId: "sandbox-1",
        summary: "Review completed.",
        errorMessage: null,
        currentStage: "completed",
      });
      expect(row?.startedAt).toBeInstanceOf(Date);
      expect(row?.completedAt).toBeInstanceOf(Date);
      expect(JSON.parse(row?.findingsJson ?? "[]")).toHaveLength(1);

      const events = await database
        .select()
        .from(schema.agentRunEvent)
        .where(eq(schema.agentRunEvent.runId, "agent-run-1"));
      expect(events.map((event) => event.type)).toEqual(
        expect.arrayContaining([
          "worker.claimed",
          "sandbox.created",
          "stage.repository_cloning",
          "flue.tool_result",
          "github.tool.submit_pull_request_review.completed",
          "sandbox.deleted",
          "result.completed",
        ]),
      );
      expect(events.map((event) => event.sequence)).toEqual(
        [...events].map((_, index) => index + 1),
      );
      expect(new Set(events.map((event) => event.sequence)).size).toBe(events.length);

      const sandboxes = await database.select().from(schema.agentRunSandbox);
      expect(sandboxes).toHaveLength(1);
      expect(sandboxes[0]).toMatchObject({
        runId: "agent-run-1",
        sandboxId: "sandbox-1",
        status: "deleted",
      });

      const artifacts = await database.select().from(schema.agentRunArtifact);
      expect(artifacts.map((artifact) => artifact.name)).toEqual(
        expect.arrayContaining([
          "github/pull-request-review.json",
          "review.md",
          "sandbox-execution.log",
        ]),
      );
    } finally {
      client.close();
    }
  });

  test("marks the claimed run failed when the sandbox runner fails", async () => {
    const { client, database } = await createTestDatabase();
    const runner: CodeReviewSandboxRunner = {
      async run(input) {
        await input.onEvent?.({
          type: "sandbox.created",
          sandboxProvider: "fake-sandbox",
          sandboxId: "sandbox-failed",
          labels: { app: "hosted-agents", agentRunId: input.agentRunId },
        });
        throw new CodeReviewSandboxRunError("sandbox unavailable", {
          logs: "failure logs",
          sandboxId: "sandbox-failed",
        });
      },
    };

    try {
      await seedGithubRun(database);

      const result = await runNextQueuedCodeReview({
        runner,
        database,
        createInstallationAccessToken: createFakeTokenFactory(),
      });

      expect(result).toEqual({
        status: "failed",
        agentRunId: "agent-run-1",
        errorMessage: "sandbox unavailable",
      });

      const [row] = await database
        .select()
        .from(schema.agentRun)
        .where(eq(schema.agentRun.id, "agent-run-1"));
      expect(row).toMatchObject({
        status: "failed",
        errorMessage: "sandbox unavailable",
        sandboxId: "sandbox-failed",
        currentStage: "failed",
      });
      expect(row?.completedAt).toBeInstanceOf(Date);

      const events = await database
        .select()
        .from(schema.agentRunEvent)
        .where(eq(schema.agentRunEvent.runId, "agent-run-1"));
      expect(events.map((event) => event.type)).toEqual(
        expect.arrayContaining(["sandbox.created", "result.failed"]),
      );

      const artifacts = await database.select().from(schema.agentRunArtifact);
      expect(artifacts).toContainEqual(
        expect.objectContaining({
          runId: "agent-run-1",
          name: "sandbox-execution.log",
          content: "failure logs",
        }),
      );
    } finally {
      client.close();
    }
  });

  test("does not drain non-GitHub queued agent runs", async () => {
    const { client, database } = await createTestDatabase();
    const runner: CodeReviewSandboxRunner = {
      async run() {
        throw new Error("runner should not be called");
      },
    };

    try {
      await seedGithubRun(database, {
        id: "manual-run-1",
        runType: "manual.review",
        sourceProvider: "manual",
        sourceDeliveryId: null,
      });

      const results = await drainQueuedCodeReviews({
        runner,
        database,
        createInstallationAccessToken: createFakeTokenFactory(),
        limit: 3,
        recoverStaleRuns: false,
      });

      expect(results).toEqual([{ status: "idle" }]);
      const [row] = await database
        .select()
        .from(schema.agentRun)
        .where(eq(schema.agentRun.id, "manual-run-1"));
      expect(row?.status).toBe("queued");
    } finally {
      client.close();
    }
  });

  test("recovers stale running runs and attempts Daytona cleanup by labels", async () => {
    const { client, database } = await createTestDatabase();
    const cleanupCalls: Record<string, string>[] = [];

    try {
      await seedGithubRun(database, {
        id: "stale-run-1",
        status: "running",
        sandboxId: "sandbox-stale",
        currentStage: "flue_review",
        lastHeartbeatAt: new Date(0),
      });

      const recovered = await recoverStaleRunningCodeReviews({
        database,
        cleanupSandboxesByLabels: async ({ labels }) => {
          cleanupCalls.push(labels);
          return [{ sandboxId: "sandbox-stale", status: "deleted" }];
        },
      });

      expect(recovered).toEqual([{ agentRunId: "stale-run-1", sandboxId: "sandbox-stale" }]);
      expect(cleanupCalls).toEqual([
        {
          app: "hosted-agents",
          workerRole: "code_review",
          agentRunId: "stale-run-1",
          organizationId: "org-1",
        },
      ]);

      const [row] = await database
        .select()
        .from(schema.agentRun)
        .where(eq(schema.agentRun.id, "stale-run-1"));
      expect(row).toMatchObject({
        status: "failed",
        currentStage: "failed",
        errorMessage: "Recovered stale running agent run.",
      });

      const events = await database
        .select()
        .from(schema.agentRunEvent)
        .where(eq(schema.agentRunEvent.runId, "stale-run-1"));
      expect(events.map((event) => event.type)).toEqual(
        expect.arrayContaining(["cleanup.stale_sandboxes_by_labels", "result.failed"]),
      );
    } finally {
      client.close();
    }
  });
});
