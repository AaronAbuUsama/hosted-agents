import { describe, expect, test } from "bun:test";

import type {
  CodeReviewSandboxLifecycleEvent,
  CodeReviewSandboxRunInput,
} from "./code-review-sandbox-runner";
import { createGitHubCodeReviewTools } from "./github-code-review-tools";

function createInput(events: CodeReviewSandboxLifecycleEvent[]): CodeReviewSandboxRunInput {
  return {
    agentRunId: "agent-run-1",
    organizationId: "org-1",
    workerRole: "code_review",
    workerDisplayName: "Code Review Worker",
    providerCredentialId: "credential-1",
    githubInstallationId: "installation-record-1",
    githubRepositoryId: "repository-record-1",
    installationId: "123456",
    installationAccessToken: "installation-token",
    owner: "octo-org",
    repo: "widgets",
    pullRequestNumber: 42,
    baseRef: "main",
    baseSha: "base-sha",
    headRef: "feature/slice",
    headSha: "head-sha",
    onEvent: async (event) => {
      events.push(event);
    },
  };
}

function toolByName(tools: ReturnType<typeof createGitHubCodeReviewTools>["tools"], name: string) {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) {
    throw new Error(`Missing tool ${name}`);
  }
  return tool;
}

describe("GitHub code review tools", () => {
  test("bind GitHub writes to the trusted run repository and pull request", async () => {
    const events: CodeReviewSandboxLifecycleEvent[] = [];
    const calls: Array<{ method: string; input: Record<string, unknown> }> = [];
    const client = {
      rest: {
        issues: {
          async createComment(input: Record<string, unknown>) {
            calls.push({ method: "issues.createComment", input });
            return { data: { id: 1001, html_url: "https://github.test/comment/1001" } };
          },
        },
        pulls: {
          async createReview(input: Record<string, unknown>) {
            calls.push({ method: "pulls.createReview", input });
            return { data: { id: 2001, html_url: "https://github.test/review/2001" } };
          },
        },
        checks: {
          async create(input: Record<string, unknown>) {
            calls.push({ method: "checks.create", input });
            return { data: { id: 3001, html_url: "https://github.test/check/3001" } };
          },
          async update(input: Record<string, unknown>) {
            calls.push({ method: "checks.update", input });
            return { data: { id: 3001, html_url: "https://github.test/check/3001" } };
          },
        },
      },
    };
    const { tools, state } = createGitHubCodeReviewTools(createInput(events), {
      client: client as never,
    });

    await toolByName(tools, "start_github_review").run({ signal: undefined });
    await toolByName(tools, "submit_pull_request_review").run({
      input: {
        body: "Review summary.",
        event: "COMMENT",
        comments: [{ path: "src/widget.ts", line: 7, side: "RIGHT", body: "Check this." }],
      },
      signal: undefined,
    });
    await toolByName(tools, "comment_on_pull_request").run({
      input: { body: "Fallback top-level context." },
      signal: undefined,
    });
    await toolByName(tools, "complete_review_check").run({
      input: { conclusion: "success", summary: "Review completed." },
      signal: undefined,
    });

    expect(calls.map((call) => call.method)).toEqual([
      "issues.createComment",
      "checks.create",
      "pulls.createReview",
      "issues.createComment",
      "checks.update",
    ]);
    for (const call of calls) {
      expect(call.input).toMatchObject({
        owner: "octo-org",
        repo: "widgets",
      });
    }
    expect(calls[0]?.input).toMatchObject({ issue_number: 42 });
    expect(calls[1]?.input).toMatchObject({
      name: "Code Review",
      head_sha: "head-sha",
      external_id: "agent-run-1",
    });
    expect(calls[0]?.input.body).toContain(
      "<!-- worker-role:code_review role:start run:agent-run-1 head:head-sha -->",
    );
    expect(calls[0]?.input.body).toContain(
      "Code Review Worker is starting a review of this pull request.",
    );
    expect(calls[2]?.input).toMatchObject({
      pull_number: 42,
      commit_id: "head-sha",
      event: "COMMENT",
    });
    expect(calls[3]?.input).toMatchObject({ issue_number: 42 });
    expect(calls[4]?.input).toMatchObject({
      check_run_id: 3001,
      conclusion: "success",
    });
    expect(state).toMatchObject({
      started: true,
      submittedReview: true,
      completedCheck: true,
      startCommentId: 1001,
      reviewId: 2001,
      checkRunId: 3001,
    });
    expect(events.map((event) => event.type)).toEqual(
      expect.arrayContaining(["github.tool", "github.artifact"]),
    );
    expect(
      events
        .filter((event) => event.type === "github.tool")
        .map((event) => `${event.toolName}.${event.status}`),
    ).toEqual(
      expect.arrayContaining([
        "start_github_review.completed",
        "submit_pull_request_review.completed",
        "comment_on_pull_request.completed",
        "complete_review_check.completed",
      ]),
    );
  });
});
