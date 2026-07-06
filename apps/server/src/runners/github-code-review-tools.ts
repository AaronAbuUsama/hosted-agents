import { defineTool, type ToolDefinition } from "@flue/runtime";
import { CODE_REVIEW_WORKER_DISPLAY_NAME } from "@hosted-agents/db/schema/agent-runs";
import { Octokit } from "@octokit/rest";
import * as v from "valibot";

import type { CodeReviewSandboxRunInput } from "./code-review-sandbox-runner";

const MAX_INLINE_REVIEW_COMMENTS = 20;

const reviewCommentSchema = v.object({
  path: v.string(),
  body: v.string(),
  position: v.optional(v.number()),
  line: v.optional(v.number()),
  side: v.optional(v.picklist(["LEFT", "RIGHT"])),
  startLine: v.optional(v.number()),
  startSide: v.optional(v.picklist(["LEFT", "RIGHT"])),
});

const reviewEventSchema = v.picklist(["COMMENT", "REQUEST_CHANGES"]);

type ReviewCommentInput = v.InferOutput<typeof reviewCommentSchema>;
type ReviewEvent = v.InferOutput<typeof reviewEventSchema>;

type GitHubReviewClient = {
  rest: {
    issues: {
      createComment(input: {
        owner: string;
        repo: string;
        issue_number: number;
        body: string;
        request?: { signal?: AbortSignal };
      }): Promise<{ data: { id: number; html_url?: string | null; body?: string | null } }>;
    };
    pulls: {
      createReview(input: {
        owner: string;
        repo: string;
        pull_number: number;
        commit_id: string;
        body: string;
        event: ReviewEvent;
        comments?: Array<{
          path: string;
          body: string;
          position?: number;
          line?: number;
          side?: "LEFT" | "RIGHT";
          start_line?: number;
          start_side?: "LEFT" | "RIGHT";
        }>;
        request?: { signal?: AbortSignal };
      }): Promise<{
        data: { id: number; html_url?: string | null; body?: string | null; state?: string | null };
      }>;
    };
    checks: {
      create(input: {
        owner: string;
        repo: string;
        name: string;
        head_sha: string;
        external_id: string;
        status: "in_progress";
        started_at: string;
        output: { title: string; summary: string };
        request?: { signal?: AbortSignal };
      }): Promise<{
        data: { id: number; html_url?: string | null; status?: string | null };
      }>;
      update(input: {
        owner: string;
        repo: string;
        check_run_id: number;
        status: "completed";
        conclusion: "action_required" | "failure" | "neutral" | "success";
        completed_at: string;
        output: { title: string; summary: string; text?: string };
        request?: { signal?: AbortSignal };
      }): Promise<{
        data: {
          id: number;
          html_url?: string | null;
          status?: string | null;
          conclusion?: string | null;
        };
      }>;
    };
  };
};

export type GitHubCodeReviewToolState = {
  started: boolean;
  startCommentId?: number;
  startCommentUrl?: string | null;
  checkRunId?: number;
  checkRunUrl?: string | null;
  submittedReview: boolean;
  reviewId?: number;
  reviewUrl?: string | null;
  fallbackCommentIds: number[];
  completedCheck: boolean;
};

export type GitHubCodeReviewTools = {
  tools: ToolDefinition[];
  state: GitHubCodeReviewToolState;
};

function defaultClient(input: CodeReviewSandboxRunInput): GitHubReviewClient {
  return new Octokit({ auth: input.installationAccessToken }) as GitHubReviewClient;
}

function workerDisplayName(input: CodeReviewSandboxRunInput) {
  return input.workerDisplayName?.trim() || CODE_REVIEW_WORKER_DISPLAY_NAME;
}

function checkName(input: CodeReviewSandboxRunInput) {
  const displayName = workerDisplayName(input);

  return displayName === CODE_REVIEW_WORKER_DISPLAY_NAME
    ? "Code Review"
    : `${displayName} / Code Review`;
}

function startCommentBody(input: CodeReviewSandboxRunInput) {
  const displayName = workerDisplayName(input);

  return [
    `<!-- worker-role:${input.workerRole} role:start run:${input.agentRunId} head:${input.headSha} -->`,
    `${displayName} is starting a review of this pull request.`,
    "",
    `Run: ${input.agentRunId}`,
    `Head: ${input.headSha}`,
  ].join("\n");
}

function trimRequired(value: string, label: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${label} is required.`);
  }
  return trimmed;
}

function normalizeReviewComments(comments: ReviewCommentInput[] | undefined) {
  if (!comments?.length) {
    return undefined;
  }

  if (comments.length > MAX_INLINE_REVIEW_COMMENTS) {
    throw new Error(`Submit at most ${MAX_INLINE_REVIEW_COMMENTS} inline review comments.`);
  }

  return comments.map((comment) => {
    const body = trimRequired(comment.body, "Inline review comment body");
    const path = trimRequired(comment.path, "Inline review comment path");
    if (comment.position === undefined && comment.line === undefined) {
      throw new Error("Inline review comments require either a diff position or a line number.");
    }

    return {
      path,
      body,
      position: comment.position,
      line: comment.line,
      side: comment.side,
      start_line: comment.startLine,
      start_side: comment.startSide,
    };
  });
}

function outputRef(data: { id: number; html_url?: string | null }) {
  return { id: data.id, htmlUrl: data.html_url ?? null };
}

export function createGitHubCodeReviewTools(
  input: CodeReviewSandboxRunInput,
  options: { client?: GitHubReviewClient } = {},
): GitHubCodeReviewTools {
  const client = options.client ?? defaultClient(input);
  const displayName = workerDisplayName(input);
  const gitHubCheckName = checkName(input);
  const ref = {
    owner: input.owner,
    repo: input.repo,
    pullNumber: input.pullRequestNumber,
    headSha: input.headSha,
    agentRunId: input.agentRunId,
  };
  const state: GitHubCodeReviewToolState = {
    started: false,
    submittedReview: false,
    fallbackCommentIds: [],
    completedCheck: false,
  };

  const emitTool = async (
    toolName: string,
    status: "started" | "completed" | "failed",
    message: string,
    payload?: unknown,
  ) => {
    await input.onEvent?.({ type: "github.tool", toolName, status, message, payload });
  };

  const emitArtifact = async (name: string, payload: unknown) => {
    await input.onEvent?.({
      type: "github.artifact",
      name,
      contentType: "application/json",
      payload,
    });
  };

  const startGitHubReview = defineTool({
    name: "start_github_review",
    description:
      "Post the bound pull request start-review comment and create the in-progress GitHub check run.",
    output: v.object({
      commentId: v.number(),
      commentUrl: v.optional(v.string()),
      checkRunId: v.number(),
      checkRunUrl: v.optional(v.string()),
    }),
    async run({ signal }) {
      const toolName = "start_github_review";
      await emitTool(toolName, "started", "Posting GitHub start-review signal", ref);
      try {
        let commentId = state.startCommentId;
        let commentUrl = state.startCommentUrl;
        if (!commentId) {
          const comment = await client.rest.issues.createComment({
            owner: ref.owner,
            repo: ref.repo,
            issue_number: ref.pullNumber,
            body: startCommentBody(input),
            request: { signal },
          });
          commentId = comment.data.id;
          commentUrl = comment.data.html_url ?? null;
          state.startCommentId = commentId;
          state.startCommentUrl = commentUrl;
        }

        let checkRunId = state.checkRunId;
        let checkRunUrl = state.checkRunUrl;
        if (!checkRunId) {
          const checkRun = await client.rest.checks.create({
            owner: ref.owner,
            repo: ref.repo,
            name: gitHubCheckName,
            head_sha: ref.headSha,
            external_id: ref.agentRunId,
            status: "in_progress",
            started_at: new Date().toISOString(),
            output: {
              title: gitHubCheckName,
              summary: `${displayName} is reviewing this pull request.`,
            },
            request: { signal },
          });
          checkRunId = checkRun.data.id;
          checkRunUrl = checkRun.data.html_url ?? null;
          state.checkRunId = checkRunId;
          state.checkRunUrl = checkRunUrl;
        }

        state.started = true;
        const artifact = {
          commentId,
          commentUrl: commentUrl ?? null,
          checkRunId,
          checkRunUrl: checkRunUrl ?? null,
        };
        await emitArtifact("github/start-review.json", artifact);
        await emitTool(toolName, "completed", "GitHub start-review signal posted", artifact);
        return {
          commentId,
          commentUrl: commentUrl ?? undefined,
          checkRunId,
          checkRunUrl: checkRunUrl ?? undefined,
        };
      } catch (error) {
        await emitTool(toolName, "failed", "GitHub start-review signal failed", {
          ...ref,
          errorMessage: error instanceof Error ? error.message : "Unknown GitHub tool failure",
        });
        throw error;
      }
    },
  });

  const submitPullRequestReview = defineTool({
    name: "submit_pull_request_review",
    description:
      "Submit the bound pull request review summary, with optional inline comments anchored to the current PR diff.",
    input: v.object({
      body: v.string(),
      event: v.optional(reviewEventSchema),
      comments: v.optional(v.array(reviewCommentSchema)),
    }),
    output: v.object({
      reviewId: v.number(),
      reviewUrl: v.optional(v.string()),
      inlineComments: v.number(),
    }),
    async run({ input: toolInput, signal }) {
      const toolName = "submit_pull_request_review";
      const body = trimRequired(toolInput.body, "Pull request review body");
      const comments = normalizeReviewComments(toolInput.comments);
      await emitTool(toolName, "started", "Submitting GitHub pull request review", {
        ...ref,
        inlineComments: comments?.length ?? 0,
        event: toolInput.event ?? "COMMENT",
      });
      try {
        const review = await client.rest.pulls.createReview({
          owner: ref.owner,
          repo: ref.repo,
          pull_number: ref.pullNumber,
          commit_id: ref.headSha,
          body,
          event: toolInput.event ?? "COMMENT",
          comments,
          request: { signal },
        });
        state.submittedReview = true;
        state.reviewId = review.data.id;
        state.reviewUrl = review.data.html_url ?? null;
        const result = {
          ...outputRef(review.data),
          reviewId: review.data.id,
          reviewUrl: review.data.html_url ?? null,
          inlineComments: comments?.length ?? 0,
        };
        await emitArtifact("github/pull-request-review.json", result);
        await emitTool(toolName, "completed", "GitHub pull request review submitted", result);
        return {
          reviewId: result.reviewId,
          reviewUrl: result.reviewUrl ?? undefined,
          inlineComments: result.inlineComments,
        };
      } catch (error) {
        await emitTool(toolName, "failed", "GitHub pull request review submission failed", {
          ...ref,
          errorMessage: error instanceof Error ? error.message : "Unknown GitHub tool failure",
        });
        throw error;
      }
    },
  });

  const commentOnPullRequest = defineTool({
    name: "comment_on_pull_request",
    description:
      "Post a fallback top-level comment on the bound pull request when inline review comments are not appropriate.",
    input: v.object({ body: v.string() }),
    output: v.object({
      commentId: v.number(),
      commentUrl: v.optional(v.string()),
    }),
    async run({ input: toolInput, signal }) {
      const toolName = "comment_on_pull_request";
      const body = trimRequired(toolInput.body, "Pull request comment body");
      await emitTool(toolName, "started", "Posting GitHub pull request comment", ref);
      try {
        const comment = await client.rest.issues.createComment({
          owner: ref.owner,
          repo: ref.repo,
          issue_number: ref.pullNumber,
          body,
          request: { signal },
        });
        state.fallbackCommentIds.push(comment.data.id);
        const result = {
          commentId: comment.data.id,
          commentUrl: comment.data.html_url ?? null,
        };
        await emitArtifact(`github/pull-request-comment-${comment.data.id}.json`, result);
        await emitTool(toolName, "completed", "GitHub pull request comment posted", result);
        return {
          commentId: result.commentId,
          commentUrl: result.commentUrl ?? undefined,
        };
      } catch (error) {
        await emitTool(toolName, "failed", "GitHub pull request comment failed", {
          ...ref,
          errorMessage: error instanceof Error ? error.message : "Unknown GitHub tool failure",
        });
        throw error;
      }
    },
  });

  const completeReviewCheck = defineTool({
    name: "complete_review_check",
    description:
      "Complete the GitHub check run created by start_github_review for the bound pull request head SHA.",
    input: v.object({
      conclusion: v.picklist(["action_required", "failure", "neutral", "success"]),
      summary: v.string(),
      text: v.optional(v.string()),
    }),
    output: v.object({
      checkRunId: v.number(),
      checkRunUrl: v.optional(v.string()),
      conclusion: v.picklist(["action_required", "failure", "neutral", "success"]),
    }),
    async run({ input: toolInput, signal }) {
      const toolName = "complete_review_check";
      if (!state.checkRunId) {
        throw new Error("start_github_review must run before complete_review_check.");
      }
      const summary = trimRequired(toolInput.summary, "Check summary");
      await emitTool(toolName, "started", "Completing GitHub review check", {
        ...ref,
        checkRunId: state.checkRunId,
        conclusion: toolInput.conclusion,
      });
      try {
        const checkRun = await client.rest.checks.update({
          owner: ref.owner,
          repo: ref.repo,
          check_run_id: state.checkRunId,
          status: "completed",
          conclusion: toolInput.conclusion,
          completed_at: new Date().toISOString(),
          output: {
            title: gitHubCheckName,
            summary,
            text: toolInput.text,
          },
          request: { signal },
        });
        state.completedCheck = true;
        state.checkRunUrl = checkRun.data.html_url ?? state.checkRunUrl;
        const result = {
          checkRunId: checkRun.data.id,
          checkRunUrl: checkRun.data.html_url ?? null,
          conclusion: toolInput.conclusion,
        };
        await emitArtifact("github/check-run.json", result);
        await emitTool(toolName, "completed", "GitHub review check completed", result);
        return {
          checkRunId: result.checkRunId,
          checkRunUrl: result.checkRunUrl ?? undefined,
          conclusion: result.conclusion,
        };
      } catch (error) {
        await emitTool(toolName, "failed", "GitHub review check completion failed", {
          ...ref,
          checkRunId: state.checkRunId,
          errorMessage: error instanceof Error ? error.message : "Unknown GitHub tool failure",
        });
        throw error;
      }
    },
  });

  return {
    state,
    tools: [startGitHubReview, submitPullRequestReview, commentOnPullRequest, completeReviewCheck],
  };
}
