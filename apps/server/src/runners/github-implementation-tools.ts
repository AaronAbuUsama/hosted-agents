import { defineTool, type ToolDefinition } from "@flue/runtime";
import { IMPLEMENTATION_WORKER_DISPLAY_NAME } from "@hosted-agents/db/schema/agent-runs";
import { Octokit } from "@octokit/rest";
import * as v from "valibot";

import type { ImplementationSandboxRunInput } from "./implementation-sandbox-runner";

// The GitHub tools the Coder (implementation worker) uses. Two axes, matching the
// review runner's split:
//   * agent tools (`createGitHubImplementationTools`) — read the issue + its
//     comments and post a progress comment AS the Coder while it works.
//   * runner-facing helpers (`openPullRequest`, `postIssueComment`, `fetchIssue`) —
//     the deterministic git-flow writes the runner does itself after the agent
//     finishes: open the "Closes #<n>" pull request and post the linking comment.
// Every write flows through the Coder's own installation token, so the branch,
// pull request, and comments are attributed to the Coder GitHub App (ADR-0001).

const MAX_COMMENT_BODY = 60_000;
const MAX_ISSUE_COMMENTS = 50;
const MAX_PR_REVIEWS = 30;
const MAX_PR_REVIEW_COMMENTS = 50;

// The Octokit surface these tools + helpers touch, narrowed so a test can supply a
// structural fake instead of a live Octokit.
export type ImplementationGitHubClient = {
  rest: {
    issues: {
      get(input: {
        owner: string;
        repo: string;
        issue_number: number;
        request?: { signal?: AbortSignal };
      }): Promise<{
        data: {
          number: number;
          title?: string | null;
          body?: string | null;
          state?: string | null;
          html_url?: string | null;
          user?: { login?: string | null } | null;
        };
      }>;
      listComments(input: {
        owner: string;
        repo: string;
        issue_number: number;
        per_page?: number;
        request?: { signal?: AbortSignal };
      }): Promise<{
        data: Array<{
          id: number;
          body?: string | null;
          html_url?: string | null;
          user?: { login?: string | null } | null;
          created_at?: string | null;
        }>;
      }>;
      createComment(input: {
        owner: string;
        repo: string;
        issue_number: number;
        body: string;
        request?: { signal?: AbortSignal };
      }): Promise<{ data: { id: number; html_url?: string | null } }>;
    };
    pulls: {
      create(input: {
        owner: string;
        repo: string;
        title: string;
        head: string;
        base: string;
        body: string;
        request?: { signal?: AbortSignal };
      }): Promise<{
        data: { number: number; html_url?: string | null; state?: string | null };
      }>;
      // Submitted reviews on the pull request (the Reviewer's `changes_requested`
      // review body + state). The babysit fix round reads these to see the feedback
      // it must address — the review lives on the PR, not the linked issue.
      listReviews(input: {
        owner: string;
        repo: string;
        pull_number: number;
        per_page?: number;
        request?: { signal?: AbortSignal };
      }): Promise<{
        data: Array<{
          id: number;
          body?: string | null;
          state?: string | null;
          user?: { login?: string | null } | null;
          submitted_at?: string | null;
        }>;
      }>;
      // Inline (diff-anchored) review comments on the pull request — the file/line
      // specifics the Reviewer left, which the review body alone does not carry.
      listReviewComments(input: {
        owner: string;
        repo: string;
        pull_number: number;
        per_page?: number;
        request?: { signal?: AbortSignal };
      }): Promise<{
        data: Array<{
          id: number;
          body?: string | null;
          path?: string | null;
          line?: number | null;
          user?: { login?: string | null } | null;
        }>;
      }>;
      // Merge the pull request (C7 auto-merge). The Coder squash-merges its own PR on
      // an approved review for an allow-listed repository.
      merge(input: {
        owner: string;
        repo: string;
        pull_number: number;
        merge_method?: "merge" | "squash" | "rebase";
        request?: { signal?: AbortSignal };
      }): Promise<{
        data: { merged?: boolean | null; sha?: string | null; message?: string | null };
      }>;
    };
  };
};

export function defaultImplementationGitHubClient(token: string): ImplementationGitHubClient {
  return new Octokit({ auth: token }) as ImplementationGitHubClient;
}

function workerDisplayName(input: ImplementationSandboxRunInput) {
  return input.workerDisplayName?.trim() || IMPLEMENTATION_WORKER_DISPLAY_NAME;
}

// A leading marker on every Coder-authored comment: it records the worker role, the
// issue, and the run so the webhook sync can attribute the comment to the Coder
// (authorKind `worker`) rather than an external human, and so a redelivery is
// idempotent. Mirrors the review runner's start-comment marker.
function coderCommentMarker(input: ImplementationSandboxRunInput, issueNumber: number) {
  return `<!-- worker-role:${input.workerRole} role:progress run:${input.agentRunId} issue:${issueNumber} -->`;
}

function trimRequired(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }
  return trimmed;
}

export type ResolvedIssue = {
  number: number;
  title: string;
  body: string | null;
  state: string;
  htmlUrl: string | null;
  authorLogin: string | null;
};

// Fetch the live issue the run implements. The runner calls this before the agent
// runs so it can name the branch from the real title (not a stale copy), and the
// agent's `read_issue` tool calls it again for its own context.
export async function fetchIssue(
  client: ImplementationGitHubClient,
  ref: { owner: string; repo: string; issueNumber: number; signal?: AbortSignal },
): Promise<ResolvedIssue> {
  const response = await client.rest.issues.get({
    owner: ref.owner,
    repo: ref.repo,
    issue_number: ref.issueNumber,
    request: { signal: ref.signal },
  });
  return {
    number: response.data.number,
    title: response.data.title?.trim() || `Issue #${response.data.number}`,
    body: response.data.body ?? null,
    state: response.data.state === "closed" ? "closed" : "open",
    htmlUrl: response.data.html_url ?? null,
    authorLogin: response.data.user?.login ?? null,
  };
}

export type OpenedPullRequest = {
  number: number;
  htmlUrl: string | null;
  state: string;
};

// Open the Coder's pull request. Body always leads with `Closes #<n>` so merging
// the PR closes the issue (spec #21) — the board's Merged lane keys off that link.
export async function openPullRequest(
  client: ImplementationGitHubClient,
  input: {
    owner: string;
    repo: string;
    title: string;
    head: string;
    base: string;
    issueNumber: number;
    summary?: string;
    signal?: AbortSignal;
  },
): Promise<OpenedPullRequest> {
  const body = [
    `Closes #${input.issueNumber}`,
    "",
    input.summary?.trim() || "Automated implementation opened by the Coder.",
  ].join("\n");
  const response = await client.rest.pulls.create({
    owner: input.owner,
    repo: input.repo,
    title: input.title,
    head: input.head,
    base: input.base,
    body,
    request: { signal: input.signal },
  });
  return {
    number: response.data.number,
    htmlUrl: response.data.html_url ?? null,
    state: response.data.state === "closed" ? "closed" : "open",
  };
}

export type MergedPullRequest = {
  merged: boolean;
  sha: string | null;
};

// Squash-merge the Coder's pull request (C7 auto-merge) via the Coder installation
// token, so the merge commit is attributed to the Coder App (ADR-0001). Throws when
// GitHub rejects the merge (a closed/unmergeable PR, a race) or reports `merged`
// false — the caller records that failure durably without crashing the loop.
export async function squashMergePullRequest(
  client: ImplementationGitHubClient,
  input: { owner: string; repo: string; pullRequestNumber: number; signal?: AbortSignal },
): Promise<MergedPullRequest> {
  const response = await client.rest.pulls.merge({
    owner: input.owner,
    repo: input.repo,
    pull_number: input.pullRequestNumber,
    merge_method: "squash",
    request: { signal: input.signal },
  });
  return { merged: Boolean(response.data.merged), sha: response.data.sha ?? null };
}

// Post a comment on the issue AS the Coder (via the Coder installation token).
export async function postIssueComment(
  client: ImplementationGitHubClient,
  input: ImplementationSandboxRunInput,
  args: { issueNumber: number; body: string; signal?: AbortSignal },
): Promise<{ commentId: number; commentUrl: string | null }> {
  const body = `${coderCommentMarker(input, args.issueNumber)}\n${trimRequired(
    args.body,
    "Issue comment body",
  ).slice(0, MAX_COMMENT_BODY)}`;
  const response = await client.rest.issues.createComment({
    owner: input.owner,
    repo: input.repo,
    issue_number: args.issueNumber,
    body,
    request: { signal: args.signal },
  });
  return { commentId: response.data.id, commentUrl: response.data.html_url ?? null };
}

export type GitHubImplementationToolState = {
  readIssue: boolean;
  readComments: boolean;
  readPullRequestReview: boolean;
  postedCommentIds: number[];
};

export type GitHubImplementationTools = {
  tools: ToolDefinition[];
  state: GitHubImplementationToolState;
};

// The agent-facing issue tools. Every tool is bound to the trusted run's
// repository + issue number so the model cannot redirect a write to another
// issue/repo; it only supplies free text. `pullRequestNumber` is present only for a
// babysit fix round: it adds a `read_pull_request_review` tool bound to that PR so
// the Coder can read the Reviewer's requested changes (which live on the pull
// request, not the linked issue's comments).
export function createGitHubImplementationTools(
  input: ImplementationSandboxRunInput,
  options: {
    client: ImplementationGitHubClient;
    issueNumber: number;
    pullRequestNumber?: number;
  },
): GitHubImplementationTools {
  const { client, issueNumber, pullRequestNumber } = options;
  const ref = { owner: input.owner, repo: input.repo, issueNumber };
  const displayName = workerDisplayName(input);
  const state: GitHubImplementationToolState = {
    readIssue: false,
    readComments: false,
    readPullRequestReview: false,
    postedCommentIds: [],
  };

  const emitTool = async (
    toolName: string,
    status: "started" | "completed" | "failed",
    message: string,
    payload?: unknown,
  ) => {
    await input.onEvent?.({ type: "github.tool", toolName, status, message, payload });
  };

  const readIssue = defineTool({
    name: "read_issue",
    description: "Read the GitHub issue this run implements (title, body, state, author).",
    output: v.object({
      number: v.number(),
      title: v.string(),
      body: v.string(),
      state: v.string(),
      authorLogin: v.optional(v.string()),
    }),
    async run({ signal }) {
      const toolName = "read_issue";
      await emitTool(toolName, "started", "Reading GitHub issue", ref);
      try {
        const issue = await fetchIssue(client, { ...ref, signal });
        state.readIssue = true;
        await emitTool(toolName, "completed", "Read GitHub issue", {
          ...ref,
          state: issue.state,
        });
        return {
          number: issue.number,
          title: issue.title,
          body: issue.body ?? "",
          state: issue.state,
          authorLogin: issue.authorLogin ?? undefined,
        };
      } catch (error) {
        await emitTool(toolName, "failed", "Reading GitHub issue failed", {
          ...ref,
          errorMessage: error instanceof Error ? error.message : "Unknown GitHub tool failure",
        });
        throw error;
      }
    },
  });

  const readIssueComments = defineTool({
    name: "read_issue_comments",
    description: "Read the existing comments on the GitHub issue this run implements.",
    output: v.object({
      comments: v.array(
        v.object({
          authorLogin: v.optional(v.string()),
          body: v.string(),
          createdAt: v.optional(v.string()),
        }),
      ),
    }),
    async run({ signal }) {
      const toolName = "read_issue_comments";
      await emitTool(toolName, "started", "Reading GitHub issue comments", ref);
      try {
        const response = await client.rest.issues.listComments({
          owner: ref.owner,
          repo: ref.repo,
          issue_number: ref.issueNumber,
          per_page: MAX_ISSUE_COMMENTS,
          request: { signal },
        });
        state.readComments = true;
        const comments = response.data.slice(0, MAX_ISSUE_COMMENTS).map((comment) => ({
          authorLogin: comment.user?.login ?? undefined,
          body: comment.body ?? "",
          createdAt: comment.created_at ?? undefined,
        }));
        await emitTool(toolName, "completed", "Read GitHub issue comments", {
          ...ref,
          count: comments.length,
        });
        return { comments };
      } catch (error) {
        await emitTool(toolName, "failed", "Reading GitHub issue comments failed", {
          ...ref,
          errorMessage: error instanceof Error ? error.message : "Unknown GitHub tool failure",
        });
        throw error;
      }
    },
  });

  // Only present on a babysit fix round (a PR to read reviews on). Bound to the
  // trusted PR number so the model cannot redirect it; it takes no input.
  const readPullRequestReview =
    pullRequestNumber == null
      ? null
      : defineTool({
          name: "read_pull_request_review",
          description:
            "Read the reviewer's requested changes on this run's pull request: each submitted review (state + summary body) and every inline (file/line) review comment. Call this first on a fix round to see exactly what to address.",
          output: v.object({
            pullRequestNumber: v.number(),
            reviews: v.array(
              v.object({
                state: v.string(),
                body: v.string(),
                authorLogin: v.optional(v.string()),
                submittedAt: v.optional(v.string()),
              }),
            ),
            comments: v.array(
              v.object({
                path: v.optional(v.string()),
                line: v.optional(v.number()),
                body: v.string(),
                authorLogin: v.optional(v.string()),
              }),
            ),
          }),
          async run({ signal }) {
            const toolName = "read_pull_request_review";
            const pullRef = { owner: input.owner, repo: input.repo, pullRequestNumber };
            await emitTool(toolName, "started", "Reading pull request review feedback", pullRef);
            try {
              const [reviewsResponse, commentsResponse] = await Promise.all([
                client.rest.pulls.listReviews({
                  owner: input.owner,
                  repo: input.repo,
                  pull_number: pullRequestNumber,
                  per_page: MAX_PR_REVIEWS,
                  request: { signal },
                }),
                client.rest.pulls.listReviewComments({
                  owner: input.owner,
                  repo: input.repo,
                  pull_number: pullRequestNumber,
                  per_page: MAX_PR_REVIEW_COMMENTS,
                  request: { signal },
                }),
              ]);
              // Keep reviews that carry signal: a written summary, or a
              // changes-requested verdict (which is meaningful even with an empty
              // body). Drop empty approvals/pending noise.
              const reviews = reviewsResponse.data
                .slice(0, MAX_PR_REVIEWS)
                .map((rev) => ({
                  state: rev.state ?? "",
                  body: rev.body ?? "",
                  authorLogin: rev.user?.login ?? undefined,
                  submittedAt: rev.submitted_at ?? undefined,
                }))
                .filter(
                  (rev) =>
                    rev.body.trim().length > 0 || rev.state.toLowerCase() === "changes_requested",
                );
              const comments = commentsResponse.data
                .slice(0, MAX_PR_REVIEW_COMMENTS)
                .map((comment) => ({
                  path: comment.path ?? undefined,
                  line: comment.line ?? undefined,
                  body: comment.body ?? "",
                  authorLogin: comment.user?.login ?? undefined,
                }))
                .filter((comment) => comment.body.trim().length > 0);
              state.readPullRequestReview = true;
              await emitTool(toolName, "completed", "Read pull request review feedback", {
                ...pullRef,
                reviewCount: reviews.length,
                commentCount: comments.length,
              });
              return { pullRequestNumber, reviews, comments };
            } catch (error) {
              await emitTool(toolName, "failed", "Reading pull request review feedback failed", {
                ...pullRef,
                errorMessage:
                  error instanceof Error ? error.message : "Unknown GitHub tool failure",
              });
              throw error;
            }
          },
        });

  const postProgressComment = defineTool({
    name: "post_issue_progress_comment",
    description: `Post a progress comment on the issue as ${displayName}. Use for status updates while implementing.`,
    input: v.object({ body: v.string() }),
    output: v.object({ commentId: v.number(), commentUrl: v.optional(v.string()) }),
    async run({ input: toolInput, signal }) {
      const toolName = "post_issue_progress_comment";
      await emitTool(toolName, "started", "Posting issue progress comment", ref);
      try {
        const posted = await postIssueComment(client, input, {
          issueNumber: ref.issueNumber,
          body: toolInput.body,
          signal,
        });
        state.postedCommentIds.push(posted.commentId);
        await emitTool(toolName, "completed", "Posted issue progress comment", {
          ...ref,
          commentId: posted.commentId,
        });
        return { commentId: posted.commentId, commentUrl: posted.commentUrl ?? undefined };
      } catch (error) {
        await emitTool(toolName, "failed", "Posting issue progress comment failed", {
          ...ref,
          errorMessage: error instanceof Error ? error.message : "Unknown GitHub tool failure",
        });
        throw error;
      }
    },
  });

  return {
    state,
    tools: [
      readIssue,
      readIssueComments,
      ...(readPullRequestReview ? [readPullRequestReview] : []),
      postProgressComment,
    ],
  };
}
