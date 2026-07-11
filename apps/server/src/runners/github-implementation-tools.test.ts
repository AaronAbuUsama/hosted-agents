import { describe, expect, test } from "bun:test";

import type { SandboxLifecycleEvent } from "./sandbox-lifecycle-event";
import type { ImplementationSandboxRunInput } from "./implementation-sandbox-runner";
import {
  createGitHubImplementationTools,
  fetchIssue,
  openPullRequest,
  postIssueComment,
  type ImplementationGitHubClient,
} from "./github-implementation-tools";

function createInput(events: SandboxLifecycleEvent[]): ImplementationSandboxRunInput {
  return {
    agentRunId: "agent-run-1",
    organizationId: "org-1",
    workerRole: "implementation",
    workerDisplayName: "The Coder",
    providerCredentialId: "credential-1",
    githubInstallationId: "installation-record-1",
    githubRepositoryId: "repository-record-1",
    installationId: "123456",
    installationAccessToken: "installation-token",
    owner: "octo-org",
    repo: "widgets",
    defaultBranch: "main",
    issueNumber: 42,
    onEvent: async (event) => {
      events.push(event);
    },
  };
}

type Call = { method: string; input: Record<string, unknown> };

function createFakeClient(calls: Call[]): ImplementationGitHubClient {
  return {
    rest: {
      issues: {
        async get(input) {
          calls.push({ method: "issues.get", input });
          return {
            data: {
              number: 42,
              title: "Add a Widget",
              body: "Please add a widget.",
              state: "open",
              html_url: "https://github.test/issues/42",
              user: { login: "maintainer" },
            },
          };
        },
        async listComments(input) {
          calls.push({ method: "issues.listComments", input });
          return {
            data: [
              {
                id: 501,
                body: "Any progress?",
                html_url: "https://github.test/comment/501",
                user: { login: "reviewer" },
                created_at: "2026-07-10T00:00:00Z",
              },
            ],
          };
        },
        async createComment(input) {
          calls.push({ method: "issues.createComment", input });
          return { data: { id: 900, html_url: "https://github.test/comment/900" } };
        },
      },
      pulls: {
        async create(input) {
          calls.push({ method: "pulls.create", input });
          return { data: { number: 7, html_url: "https://github.test/pull/7", state: "open" } };
        },
      },
    },
  };
}

function toolByName(
  tools: ReturnType<typeof createGitHubImplementationTools>["tools"],
  name: string,
) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Missing tool ${name}`);
  }
  return tool;
}

describe("GitHub implementation tools", () => {
  test("bind the agent issue tools to the trusted run repository and issue", async () => {
    const events: SandboxLifecycleEvent[] = [];
    const calls: Call[] = [];
    const client = createFakeClient(calls);
    const { tools, state } = createGitHubImplementationTools(createInput(events), {
      client,
      issueNumber: 42,
    });

    const readResult = await toolByName(tools, "read_issue").run({ signal: undefined });
    expect(readResult).toMatchObject({ number: 42, title: "Add a Widget", state: "open" });

    await toolByName(tools, "read_issue_comments").run({ signal: undefined });

    await toolByName(tools, "post_issue_progress_comment").run({
      input: { body: "Working on it." },
      signal: undefined,
    });

    expect(calls.map((call) => call.method)).toEqual([
      "issues.get",
      "issues.listComments",
      "issues.createComment",
    ]);
    for (const call of calls) {
      expect(call.input).toMatchObject({ owner: "octo-org", repo: "widgets", issue_number: 42 });
    }
    // The progress comment carries the Coder attribution marker + the body.
    expect(calls[2]?.input.body).toContain(
      "<!-- worker-role:implementation role:progress run:agent-run-1 issue:42 -->",
    );
    expect(calls[2]?.input.body).toContain("Working on it.");

    expect(state).toMatchObject({ readIssue: true, readComments: true, postedCommentIds: [900] });
    expect(
      events
        .filter((event) => event.type === "github.tool")
        .map((event) => `${event.toolName}.${event.status}`),
    ).toEqual(
      expect.arrayContaining([
        "read_issue.completed",
        "read_issue_comments.completed",
        "post_issue_progress_comment.completed",
      ]),
    );
  });

  test("openPullRequest sends a Closes #<n> body and the branch + base refs", async () => {
    const calls: Call[] = [];
    const client = createFakeClient(calls);
    const pr = await openPullRequest(client, {
      owner: "octo-org",
      repo: "widgets",
      title: "Add a Widget",
      head: "coder/issue-42-add-a-widget",
      base: "main",
      issueNumber: 42,
      summary: "Added the widget component.",
    });

    expect(pr).toEqual({ number: 7, htmlUrl: "https://github.test/pull/7", state: "open" });
    const create = calls.find((call) => call.method === "pulls.create");
    expect(create?.input).toMatchObject({
      owner: "octo-org",
      repo: "widgets",
      title: "Add a Widget",
      head: "coder/issue-42-add-a-widget",
      base: "main",
    });
    expect(create?.input.body).toContain("Closes #42");
    expect(create?.input.body).toContain("Added the widget component.");
  });

  test("fetchIssue and postIssueComment round-trip through the client", async () => {
    const events: SandboxLifecycleEvent[] = [];
    const calls: Call[] = [];
    const client = createFakeClient(calls);

    const issue = await fetchIssue(client, { owner: "octo-org", repo: "widgets", issueNumber: 42 });
    expect(issue).toMatchObject({ number: 42, title: "Add a Widget", state: "open" });

    const posted = await postIssueComment(client, createInput(events), {
      issueNumber: 42,
      body: "Opened pull request #7.",
    });
    expect(posted).toEqual({ commentId: 900, commentUrl: "https://github.test/comment/900" });
    const comment = calls.find((call) => call.method === "issues.createComment");
    expect(comment?.input.body).toContain("Opened pull request #7.");
  });
});
