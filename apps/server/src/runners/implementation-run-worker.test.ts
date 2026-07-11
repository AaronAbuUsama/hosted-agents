import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/libsql";

import type { db as productionDb } from "@hosted-agents/db";
import * as schema from "@hosted-agents/db/schema/index";
import {
  ImplementationSandboxRunError,
  type ImplementationSandboxRunInput,
  type ImplementationSandboxRunner,
} from "./implementation-sandbox-runner";

process.env.SKIP_ENV_VALIDATION = "true";
process.env.DATABASE_URL = ":memory:";
process.env.BETTER_AUTH_SECRET = "test-better-auth-secret-32-bytes";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.CORS_ORIGIN = "http://localhost:3000";
process.env.NODE_ENV = "test";

const {
  drainQueuedImplementationRuns,
  recoverStaleRunningImplementations,
  runNextQueuedImplementation,
} = await import("./implementation-run-worker");

type TestDatabase = typeof productionDb;
type TestClient = {
  close(): void;
  executeMultiple(sql: string): Promise<void>;
};

async function createTestDatabase() {
  const testDatabaseDirectory = mkdtempSync(join(tmpdir(), "implementation-worker-test-"));
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
  // The organization, user, Coder installation, and repository are fixtures every
  // test needs; seed them once so tests only insert the runs under test.
  await seedBaseRecords(database);

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

    CREATE TABLE "worker_config" (
      "id" text PRIMARY KEY,
      "organization_id" text NOT NULL,
      "worker_role" text NOT NULL,
      "display_name" text,
      "model" text,
      "reasoning_effort" text,
      "instructions" text,
      "created_at" integer DEFAULT 0 NOT NULL,
      "updated_at" integer DEFAULT 0 NOT NULL
    );

    CREATE TABLE "worker_skill" (
      "id" text PRIMARY KEY,
      "organization_id" text NOT NULL,
      "worker_role" text NOT NULL,
      "name" text NOT NULL,
      "description" text,
      "content" text NOT NULL,
      "enabled" integer DEFAULT 1 NOT NULL,
      "created_at" integer DEFAULT 0 NOT NULL,
      "updated_at" integer DEFAULT 0 NOT NULL
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
  `);
}

async function seedBaseRecords(database: TestDatabase) {
  await database.insert(schema.user).values({
    id: "user-1",
    name: "Ada Maintainer",
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
    installationId: "654321",
    appSlug: "localhost-the-coder",
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
    defaultBranch: "main",
    selected: true,
  });
}

async function seedImplementationRun(
  database: TestDatabase,
  overrides: Partial<typeof schema.agentRun.$inferInsert> = {},
) {
  await database.insert(schema.agentRun).values({
    id: "impl-run-1",
    organizationId: "org-1",
    userId: "user-1",
    providerCredentialId: "credential-1",
    coworkerSlug: "implementation",
    workerRole: "implementation",
    workerDisplayName: "The Coder",
    runType: "github.issue_implementation",
    sourceProvider: "github",
    sourceDeliveryId: "delivery-1",
    repositoryOwner: "octo-org",
    repositoryName: "widgets",
    baseBranch: "main",
    githubInstallationId: "installation-record-1",
    githubRepositoryId: "repository-record-1",
    status: "queued",
    ...overrides,
  });
}

async function seedIssueRow(
  database: TestDatabase,
  overrides: Partial<typeof schema.githubIssue.$inferInsert> = {},
) {
  await database.insert(schema.githubIssue).values({
    id: "issue-row-1",
    organizationId: "org-1",
    githubInstallationId: "installation-record-1",
    githubRepositoryId: "repository-record-1",
    repositoryFullName: "octo-org/widgets",
    number: 42,
    title: "Add a widget",
    state: "open",
    // Kick-off (C4) claims the issue before the run; the linked PR is unset until
    // the Coder opens it — this row is what C5 stamps.
    claimedByWorkerRole: "implementation",
    claimedByRunId: "impl-run-1",
    ...overrides,
  });
}

function createFakeTokenFactory(recorder?: string[]) {
  return async (installationId: string) => {
    recorder?.push(installationId);
    return `fake-coder-token-for-${installationId}`;
  };
}

function completedResult(
  overrides: Partial<Awaited<ReturnType<ImplementationSandboxRunner["run"]>>> = {},
) {
  return {
    sandboxProvider: "fake-sandbox",
    sandboxId: "sandbox-1",
    model: "openai-codex/gpt-5.6-lunar",
    summary: "Implemented the issue and opened a pull request.",
    artifacts: [],
    logs: "fake logs",
    ...overrides,
  } satisfies Awaited<ReturnType<ImplementationSandboxRunner["run"]>>;
}

describe("implementation run worker", () => {
  test("claims a queued implementation run and drives it to a terminal (completed) state", async () => {
    const { client, database } = await createTestDatabase();
    const tokenInstallationIds: string[] = [];
    const calls: ImplementationSandboxRunInput[] = [];
    const runner: ImplementationSandboxRunner = {
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
          stage: "repository_checkout",
          message: "Checking out the default branch",
        });
        await input.onEvent?.({
          type: "github.tool",
          toolName: "create_pull_request",
          status: "completed",
          message: "Opened pull request",
          payload: { pullRequestNumber: 7 },
        });
        await input.onEvent?.({ type: "sandbox.deleted", sandboxId: "sandbox-1" });
        return completedResult({
          branch: "coder/issue-42-add-widget",
          pullRequestNumber: 7,
          pullRequestState: "open",
          pullRequestUrl: "https://github.test/pull/7",
        });
      },
    };

    try {
      await seedImplementationRun(database);

      const result = await runNextQueuedImplementation({
        runner,
        database,
        createInstallationAccessToken: createFakeTokenFactory(tokenInstallationIds),
      });

      expect(result).toEqual({
        status: "completed",
        agentRunId: "impl-run-1",
        sandboxId: "sandbox-1",
      });
      // The Coder's token is minted for the installation the run is linked to.
      expect(tokenInstallationIds).toEqual(["654321"]);
      expect(calls).toHaveLength(1);
      expect(calls[0]).toMatchObject({
        agentRunId: "impl-run-1",
        organizationId: "org-1",
        workerRole: "implementation",
        workerDisplayName: "The Coder",
        providerCredentialId: "credential-1",
        githubInstallationId: "installation-record-1",
        githubRepositoryId: "repository-record-1",
        installationId: "654321",
        installationAccessToken: "fake-coder-token-for-654321",
        owner: "octo-org",
        repo: "widgets",
        defaultBranch: "main",
      });

      const [row] = await database
        .select()
        .from(schema.agentRun)
        .where(eq(schema.agentRun.id, "impl-run-1"));
      expect(row).toMatchObject({
        status: "completed",
        currentStage: "completed",
        summary: "Implemented the issue and opened a pull request.",
        branch: "coder/issue-42-add-widget",
        pullRequestNumber: 7,
        pullRequestHeadRef: "coder/issue-42-add-widget",
        errorMessage: null,
      });
      expect(row?.startedAt).toBeInstanceOf(Date);
      expect(row?.completedAt).toBeInstanceOf(Date);

      const events = await database
        .select()
        .from(schema.agentRunEvent)
        .where(eq(schema.agentRunEvent.runId, "impl-run-1"));
      expect(events.map((event) => event.type)).toEqual(
        expect.arrayContaining([
          "worker.claimed",
          "stage.repository_checkout",
          "github.tool.create_pull_request.completed",
          "sandbox.created",
          "sandbox.deleted",
          "result.completed",
        ]),
      );
      // Sequences are dense and unique — the shared recorder serialises them.
      expect(events.map((event) => event.sequence)).toEqual(
        [...events].map((_, index) => index + 1),
      );

      const artifacts = await database.select().from(schema.agentRunArtifact);
      expect(artifacts.map((artifact) => artifact.name)).toContain("sandbox-execution.log");
    } finally {
      client.close();
    }
  });

  test("stamps the linked pull request onto the issue row so the In PR lane is immediate", async () => {
    const { client, database } = await createTestDatabase();
    const runner: ImplementationSandboxRunner = {
      async run() {
        return completedResult({
          branch: "coder/issue-42-add-a-widget",
          pullRequestNumber: 7,
          pullRequestState: "open",
          pullRequestUrl: "https://github.test/pull/7",
        });
      },
    };

    try {
      // The run carries the issue number (kick-off stamps it); the issue row exists
      // and is claimed, with no linked PR yet.
      await seedImplementationRun(database, { issueNumber: 42 });
      await seedIssueRow(database);

      const result = await runNextQueuedImplementation({
        runner,
        database,
        createInstallationAccessToken: createFakeTokenFactory(),
      });
      expect(result.status).toBe("completed");

      const [issue] = await database
        .select()
        .from(schema.githubIssue)
        .where(eq(schema.githubIssue.id, "issue-row-1"));
      expect(issue).toMatchObject({
        linkedPullRequestNumber: 7,
        linkedPullRequestState: "open",
        linkedPullRequestMerged: false,
        // The claim is untouched by the stamp.
        claimedByRunId: "impl-run-1",
      });
    } finally {
      client.close();
    }
  });

  test("leaves the issue row untouched when the run opens no pull request", async () => {
    const { client, database } = await createTestDatabase();
    const runner: ImplementationSandboxRunner = {
      async run() {
        // A completed run that produced no PR (should not happen in the happy path,
        // but the worker must not stamp a null PR onto the issue).
        return completedResult();
      },
    };

    try {
      await seedImplementationRun(database, { issueNumber: 42 });
      await seedIssueRow(database);

      await runNextQueuedImplementation({
        runner,
        database,
        createInstallationAccessToken: createFakeTokenFactory(),
      });

      const [issue] = await database
        .select()
        .from(schema.githubIssue)
        .where(eq(schema.githubIssue.id, "issue-row-1"));
      expect(issue?.linkedPullRequestNumber).toBeNull();
      expect(issue?.linkedPullRequestState).toBeNull();
    } finally {
      client.close();
    }
  });

  test("runs two queued implementation runs strictly serially (never concurrent, FIFO)", async () => {
    const { client, database } = await createTestDatabase();
    const startOrder: string[] = [];
    let maxConcurrentRunning = 0;

    const runner: ImplementationSandboxRunner = {
      async run(input) {
        startOrder.push(input.agentRunId);
        // Observe how many implementation runs the store considers "running" at
        // the moment this run executes — the concurrency cap means exactly one.
        const running = await database
          .select()
          .from(schema.agentRun)
          .where(
            and(
              eq(schema.agentRun.workerRole, "implementation"),
              eq(schema.agentRun.status, "running"),
            ),
          );
        maxConcurrentRunning = Math.max(maxConcurrentRunning, running.length);
        expect(running.map((run) => run.id)).toEqual([input.agentRunId]);
        return completedResult({ sandboxId: `sandbox-${input.agentRunId}` });
      },
    };

    try {
      await seedImplementationRun(database, {
        id: "impl-run-a",
        createdAt: new Date(1_000),
      });
      await seedImplementationRun(database, {
        id: "impl-run-b",
        createdAt: new Date(2_000),
      });

      // Even asked to drain more than one, the pass processes them one at a time.
      const results = await drainQueuedImplementationRuns({
        runner,
        database,
        createInstallationAccessToken: createFakeTokenFactory(),
        limit: 5,
        recoverStaleRuns: false,
      });

      expect(results).toEqual([
        { status: "completed", agentRunId: "impl-run-a", sandboxId: "sandbox-impl-run-a" },
        { status: "completed", agentRunId: "impl-run-b", sandboxId: "sandbox-impl-run-b" },
        { status: "idle" },
      ]);
      // FIFO by creation time; never two Coder runs running at once.
      expect(startOrder).toEqual(["impl-run-a", "impl-run-b"]);
      expect(maxConcurrentRunning).toBe(1);

      const rows = await database.select().from(schema.agentRun);
      expect(rows.every((row) => row.status === "completed")).toBe(true);
    } finally {
      client.close();
    }
  });

  test("limit: 1 caps a drain to one run, leaving the rest queued for the next poll", async () => {
    const { client, database } = await createTestDatabase();
    const runner: ImplementationSandboxRunner = {
      async run(input) {
        return completedResult({ sandboxId: `sandbox-${input.agentRunId}` });
      },
    };

    try {
      await seedImplementationRun(database, { id: "impl-run-a", createdAt: new Date(1_000) });
      await seedImplementationRun(database, { id: "impl-run-b", createdAt: new Date(2_000) });

      const firstPass = await drainQueuedImplementationRuns({
        runner,
        database,
        createInstallationAccessToken: createFakeTokenFactory(),
        limit: 1,
        recoverStaleRuns: false,
      });
      expect(firstPass).toEqual([
        { status: "completed", agentRunId: "impl-run-a", sandboxId: "sandbox-impl-run-a" },
      ]);

      const [afterFirst] = await database
        .select()
        .from(schema.agentRun)
        .where(eq(schema.agentRun.id, "impl-run-b"));
      expect(afterFirst?.status).toBe("queued");

      const secondPass = await drainQueuedImplementationRuns({
        runner,
        database,
        createInstallationAccessToken: createFakeTokenFactory(),
        limit: 1,
        recoverStaleRuns: false,
      });
      expect(secondPass).toEqual([
        { status: "completed", agentRunId: "impl-run-b", sandboxId: "sandbox-impl-run-b" },
      ]);
    } finally {
      client.close();
    }
  });

  test("does not claim code review or non-implementation queued runs", async () => {
    const { client, database } = await createTestDatabase();
    const runner: ImplementationSandboxRunner = {
      async run() {
        throw new Error("runner should not be called for foreign runs");
      },
    };

    try {
      // A code-review run (different role + run type) and a manual run.
      await seedImplementationRun(database, {
        id: "review-run-1",
        coworkerSlug: "code-review",
        workerRole: "code_review",
        runType: "github.pull_request_review",
      });
      await seedImplementationRun(database, {
        id: "manual-run-1",
        runType: "manual.review",
        sourceProvider: "manual",
        sourceDeliveryId: null,
      });

      const results = await drainQueuedImplementationRuns({
        runner,
        database,
        createInstallationAccessToken: createFakeTokenFactory(),
        limit: 3,
        recoverStaleRuns: false,
      });

      expect(results).toEqual([{ status: "idle" }]);
      const rows = await database.select().from(schema.agentRun);
      expect(rows.every((row) => row.status === "queued")).toBe(true);
    } finally {
      client.close();
    }
  });

  test("marks the claimed run failed when the sandbox runner throws", async () => {
    const { client, database } = await createTestDatabase();
    const runner: ImplementationSandboxRunner = {
      async run(input) {
        await input.onEvent?.({
          type: "sandbox.created",
          sandboxProvider: "fake-sandbox",
          sandboxId: "sandbox-failed",
          labels: { app: "hosted-agents", agentRunId: input.agentRunId },
        });
        throw new ImplementationSandboxRunError("push rejected", {
          logs: "failure logs",
          sandboxId: "sandbox-failed",
        });
      },
    };

    try {
      await seedImplementationRun(database);

      const result = await runNextQueuedImplementation({
        runner,
        database,
        createInstallationAccessToken: createFakeTokenFactory(),
      });

      expect(result).toEqual({
        status: "failed",
        agentRunId: "impl-run-1",
        errorMessage: "push rejected",
      });

      const [row] = await database
        .select()
        .from(schema.agentRun)
        .where(eq(schema.agentRun.id, "impl-run-1"));
      expect(row).toMatchObject({
        status: "failed",
        errorMessage: "push rejected",
        sandboxId: "sandbox-failed",
        currentStage: "failed",
      });
      expect(row?.completedAt).toBeInstanceOf(Date);

      const events = await database
        .select()
        .from(schema.agentRunEvent)
        .where(eq(schema.agentRunEvent.runId, "impl-run-1"));
      expect(events.map((event) => event.type)).toEqual(
        expect.arrayContaining(["sandbox.created", "result.failed"]),
      );

      const artifacts = await database.select().from(schema.agentRunArtifact);
      expect(artifacts).toContainEqual(
        expect.objectContaining({
          runId: "impl-run-1",
          name: "sandbox-execution.log",
          content: "failure logs",
        }),
      );
    } finally {
      client.close();
    }
  });

  test("recovers stale running implementation runs and cleans up by role labels", async () => {
    const { client, database } = await createTestDatabase();
    const cleanupCalls: Record<string, string>[] = [];

    try {
      await seedImplementationRun(database, {
        id: "stale-impl-run",
        status: "running",
        sandboxId: "sandbox-stale",
        currentStage: "flue_implementation",
        lastHeartbeatAt: new Date(0),
      });

      const recovered = await recoverStaleRunningImplementations({
        database,
        cleanupSandboxesByLabels: async ({ labels }) => {
          cleanupCalls.push(labels);
          return [{ sandboxId: "sandbox-stale", status: "deleted" }];
        },
      });

      expect(recovered).toEqual([{ agentRunId: "stale-impl-run", sandboxId: "sandbox-stale" }]);
      expect(cleanupCalls).toEqual([
        {
          app: "hosted-agents",
          workerRole: "implementation",
          agentRunId: "stale-impl-run",
          organizationId: "org-1",
        },
      ]);

      const [row] = await database
        .select()
        .from(schema.agentRun)
        .where(eq(schema.agentRun.id, "stale-impl-run"));
      expect(row).toMatchObject({
        status: "failed",
        currentStage: "failed",
        errorMessage: "Recovered stale running agent run.",
      });
    } finally {
      client.close();
    }
  });
});
