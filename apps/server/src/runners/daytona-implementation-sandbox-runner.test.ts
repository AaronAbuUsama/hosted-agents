import { describe, expect, test } from "bun:test";

process.env.SKIP_ENV_VALIDATION = "true";
process.env.DATABASE_URL = ":memory:";
process.env.BETTER_AUTH_SECRET = "test-better-auth-secret-32-bytes";
process.env.BETTER_AUTH_URL = "http://localhost:3000";
process.env.CORS_ORIGIN = "http://localhost:3000";
process.env.NODE_ENV = "test";

import type { SandboxLifecycleEvent } from "./sandbox-lifecycle-event";
import type { ImplementationSandboxRunInput } from "./implementation-sandbox-runner";
import type {
  ImplementationDaytonaClient,
  ImplementationSandbox,
  RunImplementationAgent,
} from "./daytona-implementation-sandbox-runner";
import type { ImplementationGitHubClient } from "./github-implementation-tools";

// Value import is dynamic (after the env vars above) because the runner module
// imports the validated server env at load; a static import would be hoisted ahead
// of the env setup and fail validation.
const { DaytonaImplementationSandboxRunner } =
  await import("./daytona-implementation-sandbox-runner");

// A fake Daytona sandbox that records every command it is asked to run and returns
// canned output. `git status --porcelain` reports a dirty tree so the runner commits;
// everything else succeeds with empty output. The runner never touches a real
// Daytona or a real model — the git flow is what is under test.
type RecordedCommand = { command: string; cwd?: string };

function createFakeSandbox(commands: RecordedCommand[], uploads: string[]) {
  let deleted = false;
  const sandbox: ImplementationSandbox & { deleted: () => boolean } = {
    id: "sandbox-under-test",
    process: {
      async executeCommand(command, cwd) {
        commands.push({ command, cwd });
        if (command.includes("git status --porcelain")) {
          return { result: " M src/widget.ts\n", exitCode: 0 };
        }
        if (command.includes("git rev-list")) {
          return { result: "1\n", exitCode: 0 };
        }
        if (command.includes("git rev-parse")) {
          return { result: "abc123\n", exitCode: 0 };
        }
        return { result: "", exitCode: 0 };
      },
    },
    fs: {
      async uploadFile(_content, path) {
        uploads.push(path);
      },
    },
    async delete() {
      deleted = true;
    },
    deleted: () => deleted,
  };
  return sandbox;
}

type PullsCreateCall = Record<string, unknown>;

function createFakeGitHubClient(record: {
  pullsCreate: PullsCreateCall[];
  issueComments: Record<string, unknown>[];
}): ImplementationGitHubClient {
  return {
    rest: {
      issues: {
        async get() {
          return {
            data: {
              number: 42,
              title: "Add a Widget!",
              body: "Please add a widget.",
              state: "open",
              html_url: "https://github.test/issues/42",
              user: { login: "maintainer" },
            },
          };
        },
        async listComments() {
          return { data: [] };
        },
        async createComment(input) {
          record.issueComments.push(input);
          return { data: { id: 900, html_url: "https://github.test/comment/900" } };
        },
      },
      pulls: {
        async create(input) {
          record.pullsCreate.push(input);
          return { data: { number: 7, html_url: "https://github.test/pull/7", state: "open" } };
        },
        async listReviews() {
          return { data: [] };
        },
        async listReviewComments() {
          return { data: [] };
        },
      },
    },
  };
}

function createInput(
  events: SandboxLifecycleEvent[],
  overrides: Partial<ImplementationSandboxRunInput> = {},
): ImplementationSandboxRunInput {
  return {
    agentRunId: "impl-run-1",
    organizationId: "org-1",
    workerRole: "implementation",
    workerDisplayName: "The Coder",
    githubInstallationId: "installation-record-1",
    githubRepositoryId: "repository-record-1",
    installationId: "654321",
    installationAccessToken: "secret-coder-token",
    appSlug: "localhost-the-coder",
    owner: "octo-org",
    repo: "widgets",
    defaultBranch: "main",
    issueNumber: 42,
    onEvent: async (event) => {
      events.push(event);
    },
    ...overrides,
  };
}

describe("DaytonaImplementationSandboxRunner (to the model step, stub agent)", () => {
  test("checks out, branches, commits, scrubs the pushed remote, and opens a Closes-# PR", async () => {
    const commands: RecordedCommand[] = [];
    const uploads: string[] = [];
    const sandbox = createFakeSandbox(commands, uploads);
    const client: ImplementationDaytonaClient = {
      async create() {
        return sandbox;
      },
    };
    const record = {
      pullsCreate: [] as PullsCreateCall[],
      issueComments: [] as Record<string, unknown>[],
    };
    const githubClient = createFakeGitHubClient(record);

    // The stub agent stands in for the Flue/model call — it makes no assertions
    // about the model; the git flow around it is what is under test.
    const agentCalls: string[] = [];
    let firstRunToolNames: string[] = [];
    const runAgent: RunImplementationAgent = async ({ issue, input, githubTools }) => {
      agentCalls.push(`${input.agentRunId}:${issue.number}`);
      firstRunToolNames = githubTools.tools.map((tool) => tool.name);
      return { summary: "Added the widget component and a test." };
    };

    const runner = new DaytonaImplementationSandboxRunner({
      createClient: () => client,
      createGitHubClient: () => githubClient,
      runAgent,
    });

    const events: SandboxLifecycleEvent[] = [];
    const result = await runner.run(createInput(events));

    // Branch named from the live issue title, cut with `git switch -c`.
    const commandLine = commands.map((entry) => entry.command);
    expect(
      commandLine.some((command) =>
        command.includes("git switch -c 'coder/issue-42-add-a-widget'"),
      ),
    ).toBe(true);

    // Full checkout of the default branch (not the review runner's --no-checkout).
    const cloneCommand = commandLine.find((command) => command.includes("git clone"));
    expect(cloneCommand).toContain("--single-branch --branch 'main'");
    // The clone embeds the token, and the remote is scrubbed right after.
    expect(cloneCommand).toContain("x-access-token:secret-coder-token@github.com");

    // A commit happens because the tree is dirty.
    expect(commandLine.some((command) => command.startsWith("git commit -m"))).toBe(true);

    // Hardened push: straight to the authenticated URL passed as a positional
    // argument, with hooks / fsmonitor / credential helpers disabled so an
    // agent-planted hook or config cannot execute or read the token, and the branch
    // named as an explicit refspec so an agent-planted pushurl cannot redirect it.
    const isPushCommand = (command: string) => /\bgit\b.*\bpush\b/.test(command);
    const pushCommand = commandLine.find(isPushCommand);
    expect(pushCommand).toBeDefined();
    expect(pushCommand).toContain("-c core.hooksPath=/dev/null");
    expect(pushCommand).toContain("-c core.fsmonitor=");
    expect(pushCommand).toContain("-c credential.helper=");
    expect(pushCommand).toContain("x-access-token:secret-coder-token@github.com");
    expect(pushCommand).toContain("'HEAD:refs/heads/coder/issue-42-add-a-widget'");

    // The token is NEVER persisted into the git remote config — the only
    // `git remote set-url` is the tokenless scrub right after clone.
    const remoteSetUrlCommands = commandLine.filter((command) =>
      command.includes("git remote set-url origin"),
    );
    expect(remoteSetUrlCommands).toHaveLength(1);
    expect(remoteSetUrlCommands[0]).not.toContain("x-access-token");
    expect(remoteSetUrlCommands[0]).not.toContain("secret-coder-token");

    // pulls.create payload: correct head/base, and a "Closes #42" body.
    expect(record.pullsCreate).toHaveLength(1);
    expect(record.pullsCreate[0]).toMatchObject({
      owner: "octo-org",
      repo: "widgets",
      title: "Add a Widget!",
      head: "coder/issue-42-add-a-widget",
      base: "main",
    });
    expect(record.pullsCreate[0]?.body).toContain("Closes #42");

    // A progress comment was posted on the issue as the Coder, linking the PR.
    expect(record.issueComments).toHaveLength(1);
    expect(record.issueComments[0]).toMatchObject({ issue_number: 42 });
    expect(record.issueComments[0]?.body).toContain("Opened pull request #7");

    // The agent ran once, for this run + issue.
    expect(agentCalls).toEqual(["impl-run-1:42"]);

    // A first implementation run has no pull request yet, so the PR-review tool is
    // absent — it is a babysit-only affordance.
    expect(firstRunToolNames).not.toContain("read_pull_request_review");

    // Result carries the branch + PR back to the worker (which stamps the rows).
    expect(result).toMatchObject({
      sandboxProvider: "daytona",
      sandboxId: "sandbox-under-test",
      branch: "coder/issue-42-add-a-widget",
      pullRequestNumber: 7,
      pullRequestState: "open",
      pullRequestUrl: "https://github.test/pull/7",
      summary: "Added the widget component and a test.",
    });

    // Logs never leak the token; the sandbox is always cleaned up.
    expect(result.logs).not.toContain("secret-coder-token");
    expect(result.logs).toContain("[redacted]");
    expect(sandbox.deleted()).toBe(true);
    expect(uploads).toContain("coworker-issue-context.md");

    // Lifecycle events narrate the write flow and end with the sandbox deleted.
    const stageEvents = events
      .filter(
        (event): event is Extract<SandboxLifecycleEvent, { type: "stage" }> =>
          event.type === "stage",
      )
      .map((event) => event.stage);
    expect(stageEvents).toEqual(
      expect.arrayContaining([
        "issue_resolving",
        "repository_cloning",
        "branch_creating",
        "flue_implementation",
        "changes_committing",
        "branch_pushing",
        "pull_request_opening",
      ]),
    );
    expect(events.some((event) => event.type === "sandbox.deleted")).toBe(true);
  });

  test("fails with a clear reason and still cleans up when the agent makes no changes", async () => {
    const commands: RecordedCommand[] = [];
    const uploads: string[] = [];
    // A sandbox whose working tree is clean AND has no commits ahead of the default
    // branch: `git status --porcelain` returns empty and `git rev-list --count` is 0.
    const sandbox: ImplementationSandbox & { deleted: () => boolean } = (() => {
      let deleted = false;
      return {
        id: "sandbox-clean",
        process: {
          async executeCommand(command, cwd) {
            commands.push({ command, cwd });
            if (command.includes("git rev-list")) {
              return { result: "0\n", exitCode: 0 };
            }
            return { result: "", exitCode: 0 };
          },
        },
        fs: {
          async uploadFile(_content, path) {
            uploads.push(path);
          },
        },
        async delete() {
          deleted = true;
        },
        deleted: () => deleted,
      };
    })();
    const record = {
      pullsCreate: [] as PullsCreateCall[],
      issueComments: [] as Record<string, unknown>[],
    };
    const runner = new DaytonaImplementationSandboxRunner({
      createClient: () => ({
        async create() {
          return sandbox;
        },
      }),
      createGitHubClient: () => createFakeGitHubClient(record),
      runAgent: async () => ({ summary: "no-op" }),
    });

    const events: SandboxLifecycleEvent[] = [];
    await expect(runner.run(createInput(events))).rejects.toThrow(
      /no commits ahead of the default branch/i,
    );
    // No PR opened, and the sandbox is still deleted on the failure path.
    expect(record.pullsCreate).toHaveLength(0);
    expect(sandbox.deleted()).toBe(true);
  });

  test("opens a PR from the agent's own commits when the working tree is clean", async () => {
    const commands: RecordedCommand[] = [];
    const uploads: string[] = [];
    // The agent committed its own work despite the "do not commit" instruction: the
    // working tree is clean (`git status --porcelain` empty) but the branch is ahead
    // of the default branch. This must still push and open a PR — not hard-fail.
    const sandbox: ImplementationSandbox & { deleted: () => boolean } = (() => {
      let deleted = false;
      return {
        id: "sandbox-agent-committed",
        process: {
          async executeCommand(command, cwd) {
            commands.push({ command, cwd });
            if (command.includes("git rev-list")) {
              return { result: "2\n", exitCode: 0 };
            }
            // git status --porcelain (and everything else) reports a clean tree.
            return { result: "", exitCode: 0 };
          },
        },
        fs: {
          async uploadFile(_content, path) {
            uploads.push(path);
          },
        },
        async delete() {
          deleted = true;
        },
        deleted: () => deleted,
      };
    })();
    const record = {
      pullsCreate: [] as PullsCreateCall[],
      issueComments: [] as Record<string, unknown>[],
    };
    const runner = new DaytonaImplementationSandboxRunner({
      createClient: () => ({
        async create() {
          return sandbox;
        },
      }),
      createGitHubClient: () => createFakeGitHubClient(record),
      runAgent: async () => ({ summary: "Committed the widget myself." }),
    });

    const events: SandboxLifecycleEvent[] = [];
    const result = await runner.run(createInput(events));

    const commandLine = commands.map((entry) => entry.command);
    // The runner does NOT create its own commit — the tree is already clean.
    expect(commandLine.some((command) => command.startsWith("git commit -m"))).toBe(false);
    // It still pushes the branch and opens the PR off the agent's own commits.
    expect(commandLine.some((command) => /\bgit\b.*\bpush\b/.test(command))).toBe(true);
    expect(record.pullsCreate).toHaveLength(1);
    expect(record.pullsCreate[0]).toMatchObject({
      head: "coder/issue-42-add-a-widget",
      base: "main",
    });
    expect(result).toMatchObject({
      branch: "coder/issue-42-add-a-widget",
      pullRequestNumber: 7,
      pullRequestState: "open",
    });
    expect(sandbox.deleted()).toBe(true);
  });

  test("babysit round: resumes the existing branch, pushes the fix, and opens NO new PR", async () => {
    const commands: RecordedCommand[] = [];
    const uploads: string[] = [];
    const sandbox = createFakeSandbox(commands, uploads);
    const record = {
      pullsCreate: [] as PullsCreateCall[],
      issueComments: [] as Record<string, unknown>[],
    };
    const githubClient = createFakeGitHubClient(record);

    // Capture the tools handed to the model so we can assert the babysit round can
    // actually read the reviewer's feedback (which lives on the PR, not the issue).
    let babysitToolNames: string[] = [];
    const runner = new DaytonaImplementationSandboxRunner({
      createClient: () => ({
        async create() {
          return sandbox;
        },
      }),
      createGitHubClient: () => githubClient,
      runAgent: async ({ githubTools }) => {
        babysitToolNames = githubTools.tools.map((tool) => tool.name);
        return { summary: "Addressed the reviewer's requested changes." };
      },
    });

    const events: SandboxLifecycleEvent[] = [];
    const result = await runner.run(
      createInput(events, {
        babysit: { branch: "coder/issue-42-add-a-widget", pullRequestNumber: 7 },
      }),
    );

    // The babysit round is given read_pull_request_review, bound to the existing PR,
    // so it can see the requested changes it must address.
    expect(babysitToolNames).toContain("read_pull_request_review");

    const commandLine = commands.map((entry) => entry.command);

    // Clones the EXISTING Coder branch directly (not the default branch), and never
    // cuts a new branch with `git switch -c`.
    const cloneCommand = commandLine.find((command) => command.includes("git clone"));
    expect(cloneCommand).toContain("--single-branch --branch 'coder/issue-42-add-a-widget'");
    expect(commandLine.some((command) => command.startsWith("git switch -c"))).toBe(false);

    // Commits the fix (the tree is dirty) and pushes to the same branch.
    expect(commandLine.some((command) => command.startsWith("git commit -m"))).toBe(true);
    const pushCommand = commandLine.find((command) => /\bgit\b.*\bpush\b/.test(command));
    expect(pushCommand).toContain("'HEAD:refs/heads/coder/issue-42-add-a-widget'");

    // No new pull request is opened — the PR already exists.
    expect(record.pullsCreate).toHaveLength(0);

    // A progress comment notes the fix round on the existing PR.
    expect(record.issueComments).toHaveLength(1);
    expect(record.issueComments[0]).toMatchObject({ issue_number: 42 });
    expect(record.issueComments[0]?.body).toContain("addressing the latest review");
    expect(record.issueComments[0]?.body).toContain("pull request #7");

    // The result carries the existing branch + PR back to the worker.
    expect(result).toMatchObject({
      branch: "coder/issue-42-add-a-widget",
      pullRequestNumber: 7,
      pullRequestState: "open",
      summary: "Addressed the reviewer's requested changes.",
    });

    // Stages narrate resuming (not creating) the branch, and never opening a PR.
    const stageEvents = events
      .filter(
        (event): event is Extract<SandboxLifecycleEvent, { type: "stage" }> =>
          event.type === "stage",
      )
      .map((event) => event.stage);
    expect(stageEvents).toContain("branch_checkout");
    expect(stageEvents).not.toContain("branch_creating");
    expect(stageEvents).not.toContain("pull_request_opening");
    expect(sandbox.deleted()).toBe(true);
  });

  test("fails fast when the run has no linked issue number", async () => {
    const runner = new DaytonaImplementationSandboxRunner({
      createClient: () => ({
        async create() {
          throw new Error("sandbox should not be created without an issue");
        },
      }),
      createGitHubClient: () => createFakeGitHubClient({ pullsCreate: [], issueComments: [] }),
      runAgent: async () => ({ summary: "" }),
    });
    const events: SandboxLifecycleEvent[] = [];
    await expect(runner.run(createInput(events, { issueNumber: undefined }))).rejects.toThrow(
      /missing its issue number/i,
    );
  });
});
