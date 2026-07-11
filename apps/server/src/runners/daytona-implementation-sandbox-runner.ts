import { Buffer } from "node:buffer";

import { env } from "@hosted-agents/env/server";
import { Daytona, type Sandbox } from "@daytona/sdk";
import { defineAgent } from "@flue/runtime";
import { createFlueContext, resolveModel } from "@flue/runtime/internal";
import { IMPLEMENTATION_WORKER_DISPLAY_NAME } from "@hosted-agents/db/schema/agent-runs";
import * as v from "valibot";

import {
  DEFAULT_CODEX_MODEL,
  resolveReasoningEffort,
  type ReasoningEffort,
} from "@hosted-agents/api/codex-model-policy";

import { registerOpenAICodexCredentialModel } from "../lib/provider-credential-model";
import { daytona } from "../sandboxes/daytona";
import { coderBranchName } from "./coder-branch";
import {
  assertGitHubName,
  executeSandboxCommand,
  shellQuote,
  type SandboxCommandRunner,
} from "./daytona-sandbox-helpers";
import {
  createGitHubImplementationTools,
  defaultImplementationGitHubClient,
  fetchIssue,
  openPullRequest,
  postIssueComment,
  type GitHubImplementationTools,
  type ImplementationGitHubClient,
  type ResolvedIssue,
} from "./github-implementation-tools";
import {
  ImplementationSandboxRunError,
  type ImplementationSandboxRunInput,
  type ImplementationSandboxRunner,
  type ImplementationSandboxRunResult,
} from "./implementation-sandbox-runner";

const REPOSITORY_PATH = "repo";
const ISSUE_CONTEXT_PATH = "coworker-issue-context.md";
const SKILLS_PATH = "skills";
const MAX_ISSUE_BODY_CHARS = 60_000;

// The sandbox surface this runner drives: shell commands (via SandboxCommandRunner),
// file uploads for the issue context + skills, an id, and deletion. The real
// @daytona/sdk Sandbox satisfies this structurally, and a test supplies a fake.
export type ImplementationSandbox = SandboxCommandRunner & {
  id: string;
  fs: { uploadFile(content: Buffer, path: string): Promise<void> };
  delete(timeout?: number): Promise<void>;
};

// The Daytona client surface: create a sandbox and (optionally) dispose. Injected so
// the git flow can be integration-tested against a fake sandbox with no live Daytona.
export type ImplementationDaytonaClient = {
  create(
    params: Record<string, unknown>,
    options?: { timeout?: number },
  ): Promise<ImplementationSandbox>;
  [Symbol.asyncDispose]?: () => Promise<void> | void;
};

// The model-step seam. The default runs a Flue agent with write (shell/file) tools
// plus the issue tools; a test stubs it to assert the surrounding git flow without a
// live model call (spec #21 testing decision: "the Flue/model call faked").
export type RunImplementationAgentArgs = {
  sandbox: ImplementationSandbox;
  input: ImplementationSandboxRunInput;
  issue: ResolvedIssue;
  model: string;
  reasoningEffort: ReasoningEffort;
  githubTools: GitHubImplementationTools;
  repositoryPath: string;
  onFlueEvent?: (event: unknown) => void | Promise<void>;
};
export type RunImplementationAgent = (
  args: RunImplementationAgentArgs,
) => Promise<{ summary: string }>;

const implementationResultSchema = v.object({ summary: v.string() });

export type DaytonaImplementationRunnerOptions = {
  createClient?: () => ImplementationDaytonaClient;
  createGitHubClient?: (token: string) => ImplementationGitHubClient;
  runAgent?: RunImplementationAgent;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Daytona implementation failure";
}

function workerDisplayName(input: ImplementationSandboxRunInput) {
  return input.workerDisplayName?.trim() || IMPLEMENTATION_WORKER_DISPLAY_NAME;
}

// The git author for the Coder's commit. GitHub attributes App-authored commits to
// a `<slug>[bot]@users.noreply.github.com` identity; we set the same email (and the
// worker display name) so the commit reads as the Coder even though the pushing
// identity — the installation token — is what makes GitHub attribute the branch and
// pull request to the Coder App.
function commitIdentity(input: ImplementationSandboxRunInput) {
  const name = workerDisplayName(input);
  const slug = input.appSlug?.trim();
  const email = slug ? `${slug}[bot]@users.noreply.github.com` : "coder@users.noreply.github.com";
  return { name, email };
}

function truncateIssueBody(body: string | null): string {
  if (!body) {
    return "No description provided.";
  }
  return body.length > MAX_ISSUE_BODY_CHARS
    ? `${body.slice(0, MAX_ISSUE_BODY_CHARS)}\n\n[issue body truncated]`
    : body;
}

function createIssueContext(input: ImplementationSandboxRunInput, issue: ResolvedIssue): string {
  return [
    "# Coworker Implementation Context",
    "",
    `Agent run: ${input.agentRunId}`,
    `Repository: ${input.owner}/${input.repo}`,
    `Default branch: ${input.defaultBranch}`,
    `Issue: #${issue.number} — ${issue.title}`,
    `Issue state: ${issue.state}`,
    "",
    "## Issue Body",
    "",
    truncateIssueBody(issue.body),
  ].join("\n");
}

function defaultCreateClient(): ImplementationDaytonaClient {
  if (!env.DAYTONA_API_KEY) {
    throw new Error("DAYTONA_API_KEY is required to run implementations in Daytona.");
  }
  return new Daytona({
    apiKey: env.DAYTONA_API_KEY,
    apiUrl: env.DAYTONA_API_URL,
    otelEnabled: false,
  }) as unknown as ImplementationDaytonaClient;
}

// The default model step: a Flue agent given the sandbox (write tools: shell + file
// edit) and the issue tools, told to implement the issue in the checked-out branch.
// Mirrors the review runner's Flue adapter; the only differences are the tools and
// the instructions.
async function defaultRunImplementationAgent(
  args: RunImplementationAgentArgs,
): Promise<{ summary: string }> {
  const { sandbox, input, issue, model, reasoningEffort, githubTools, repositoryPath } = args;
  const displayName = workerDisplayName(input);
  const skillNames = (input.skills ?? []).map((skill) => skill.name);
  const configuredInstructions = input.configuredInstructions?.trim();
  const babysit = input.babysit;
  const agent = defineAgent(() => ({
    model,
    thinkingLevel: reasoningEffort,
    sandbox: daytona(sandbox as unknown as Sandbox),
    cwd: repositoryPath,
    tools: githubTools.tools,
    instructions: [
      "You are Coworker's implementation worker (the Coder).",
      `Your configured display name is ${displayName}.`,
      "Your worker role is implementation. Do not assume a personal identity beyond the configured display name.",
      babysit
        ? `You are resuming your existing branch for pull request #${babysit.pullRequestNumber}; it is already checked out in the sandbox workspace with your prior work. A reviewer requested changes — address that review feedback.`
        : `You are on a fresh branch checked out from ${input.defaultBranch} inside the sandbox workspace.`,
      `Read ../${ISSUE_CONTEXT_PATH} first, then call read_issue (and read_issue_comments if useful) for the live issue.`,
      babysit
        ? "Call read_pull_request_review to get the reviewer's requested changes — the review summary and any inline file/line comments live on the pull request, NOT in the issue comments. Then edit files and run commands with your shell/file tools inside this sandbox only to address every requested change."
        : "Implement the issue by editing files and running commands with your shell/file tools inside this sandbox only.",
      "Make focused, minimal changes that satisfy the issue. Do not commit, push, or open a pull request — the runner does that after you finish.",
      "You may post a short progress comment with post_issue_progress_comment; keep it concise.",
      ...(skillNames.length > 0
        ? [
            `Load every team skill under ../${SKILLS_PATH}/ (${skillNames.join(", ")}): each is a directory whose SKILL.md entry describes it. Apply them as implementation guidance.`,
          ]
        : []),
      "Return a concise summary of the changes you made for the pull request description.",
      ...(configuredInstructions
        ? [
            "",
            "Team implementation guidance (configured by the organization):",
            configuredInstructions,
          ]
        : []),
    ].join("\n"),
  }));
  const ctx = createFlueContext({
    id: input.agentRunId,
    runId: input.agentRunId,
    env: process.env,
    agentConfig: { resolveModel },
    createDefaultEnv: async () => {
      throw new Error("Daytona runner requires an explicit sandbox.");
    },
  });
  const unsubscribe = args.onFlueEvent
    ? ctx.subscribeEvent((event) => args.onFlueEvent?.(event))
    : undefined;
  const harness = await ctx.initializeRootHarness(agent);

  try {
    const session = await harness.session();
    const response = await session.prompt(
      [
        `Implement issue #${issue.number} (${issue.title}) end to end in this workspace.`,
        `Read ../${ISSUE_CONTEXT_PATH} first, then read_issue for the live issue.`,
        "Edit files with your shell/file tools. Do not commit or push — the runner handles git.",
        "Return the structured summary of your changes.",
      ].join("\n"),
      {
        result: implementationResultSchema,
        model,
        thinkingLevel: reasoningEffort,
      },
    );
    return { summary: response.data.summary };
  } finally {
    await harness.close();
    await ctx.flushEventCallbacks();
    unsubscribe?.();
  }
}

// The write-capable Daytona runner for the implementation ("Coder") role. Sibling of
// the review runner (same sandbox lifecycle, skill upload, token scrubbing, cleanup),
// with the write differences: full checkout of the default branch, cut
// `coder/issue-<n>-<slug>`, run a write-capable Flue agent, then commit / push (token
// embedded in the remote and scrubbed immediately after, mirroring the clone path) /
// open the "Closes #<n>" pull request / comment on the issue — all as the Coder.
export class DaytonaImplementationSandboxRunner implements ImplementationSandboxRunner {
  private readonly createClient: () => ImplementationDaytonaClient;
  private readonly createGitHubClient: (token: string) => ImplementationGitHubClient;
  private readonly runAgent: RunImplementationAgent;

  constructor(options: DaytonaImplementationRunnerOptions = {}) {
    this.createClient = options.createClient ?? defaultCreateClient;
    this.createGitHubClient = options.createGitHubClient ?? defaultImplementationGitHubClient;
    this.runAgent = options.runAgent ?? defaultRunImplementationAgent;
  }

  async run(input: ImplementationSandboxRunInput): Promise<ImplementationSandboxRunResult> {
    assertGitHubName(input.owner, "owner");
    assertGitHubName(input.repo, "repository name");

    if (input.issueNumber == null) {
      throw new ImplementationSandboxRunError(
        "Implementation run is missing its issue number; cannot open a pull request.",
      );
    }
    const issueNumber = input.issueNumber;

    const githubClient = this.createGitHubClient(input.installationAccessToken);
    const logs: string[] = [];
    const encodedInstallationAccessToken = encodeURIComponent(input.installationAccessToken);
    const redactions = [input.installationAccessToken, encodedInstallationAccessToken];
    const labels = {
      app: "hosted-agents",
      workerRole: input.workerRole,
      agentRunId: input.agentRunId,
      organizationId: input.organizationId,
    };
    const emitStage = async (stage: string, message: string, payload?: unknown) => {
      await input.onEvent?.({ type: "stage", stage, message, payload });
    };
    const emitTool = async (
      toolName: string,
      status: "started" | "completed" | "failed",
      message: string,
      payload?: unknown,
    ) => {
      await input.onEvent?.({ type: "github.tool", toolName, status, message, payload });
    };

    // A babysit fix round (C6) resumes the pull request's existing Coder branch;
    // the first implementation cuts a fresh branch named from the live issue title.
    const babysit = input.babysit;

    // Resolve the live issue before creating the sandbox so the branch is named from
    // the real title and a missing/renamed issue fails fast (no wasted sandbox).
    await emitStage("issue_resolving", `Reading issue #${issueNumber}`);
    const issue = await fetchIssue(githubClient, {
      owner: input.owner,
      repo: input.repo,
      issueNumber,
    });
    const branch = babysit ? babysit.branch : coderBranchName(issueNumber, issue.title);

    const client = this.createClient();
    await emitStage("sandbox_starting", "Creating Daytona sandbox", { labels });
    const sandbox = await client.create(
      {
        language: "typescript",
        ephemeral: true,
        autoStopInterval: 15,
        autoDeleteInterval: 0,
        labels,
      },
      { timeout: 120 },
    );
    const sandboxId = sandbox.id;
    await input.onEvent?.({
      type: "sandbox.created",
      sandboxProvider: "daytona",
      sandboxId,
      labels,
    });

    let completedResult: Omit<ImplementationSandboxRunResult, "logs"> | undefined;
    let runError: unknown;

    try {
      logs.push(`daytona sandbox ${sandboxId} created`);
      const cloneUrl = `https://github.com/${input.owner}/${input.repo}.git`;
      const authenticatedCloneUrl = `https://x-access-token:${encodedInstallationAccessToken}@github.com/${input.owner}/${input.repo}.git`;

      // Full checkout of the branch we operate on (differs from the review runner's
      // --no-checkout SHA fetch: the Coder needs a working tree to edit + commit).
      // A first implementation clones the default branch and cuts a new branch from
      // it; a babysit clones the existing Coder branch directly and resumes it.
      const cloneBranch = babysit ? branch : input.defaultBranch;
      await emitStage("repository_cloning", `Cloning ${input.owner}/${input.repo}`, {
        branch: cloneBranch,
        defaultBranch: input.defaultBranch,
      });
      await executeSandboxCommand({
        sandbox,
        command: `GIT_TERMINAL_PROMPT=0 git clone --single-branch --branch ${shellQuote(
          cloneBranch,
        )} ${shellQuote(authenticatedCloneUrl)} ${shellQuote(REPOSITORY_PATH)}`,
        timeout: 600,
        logs,
        redactions,
      });
      // Scrub the token out of the remote immediately after clone (mirror the review
      // runner). It is re-embedded only for the push, then scrubbed again.
      await emitStage(
        "repository_sanitizing_remote",
        "Removing installation token from git remote",
      );
      await executeSandboxCommand({
        sandbox,
        command: `git remote set-url origin ${shellQuote(cloneUrl)}`,
        cwd: REPOSITORY_PATH,
        timeout: 30,
        logs,
        redactions,
      });

      if (babysit) {
        // The Coder branch already exists and is checked out by the clone above —
        // there is nothing to create, just narrate that we resumed it.
        await emitStage("branch_checkout", `Resuming branch ${branch}`, {
          branch,
          pullRequestNumber: babysit.pullRequestNumber,
        });
      } else {
        await emitStage("branch_creating", `Creating branch ${branch}`, { branch });
        await executeSandboxCommand({
          sandbox,
          command: `git switch -c ${shellQuote(branch)}`,
          cwd: REPOSITORY_PATH,
          timeout: 60,
          logs,
          redactions,
        });
      }

      const identity = commitIdentity(input);
      await executeSandboxCommand({
        sandbox,
        command: `git config user.name ${shellQuote(identity.name)}`,
        cwd: REPOSITORY_PATH,
        timeout: 30,
        logs,
        redactions,
      });
      await executeSandboxCommand({
        sandbox,
        command: `git config user.email ${shellQuote(identity.email)}`,
        cwd: REPOSITORY_PATH,
        timeout: 30,
        logs,
        redactions,
      });

      const issueContext = createIssueContext(input, issue);
      await emitStage("issue_context_uploading", "Uploading issue context into sandbox", {
        path: ISSUE_CONTEXT_PATH,
      });
      await sandbox.fs.uploadFile(Buffer.from(issueContext, "utf8"), ISSUE_CONTEXT_PATH);

      // FLUE ADAPTER — runtime skill registration seam (mirrors the review runner).
      // Writes each enabled skill bundle into skills/<name>/<file path>; when the
      // runner moves to Eve, swap this block to write into Eve's skills/ directory.
      const skills = input.skills ?? [];
      if (skills.length > 0) {
        await emitStage("skills_uploading", "Uploading worker skill bundles into sandbox", {
          skills: skills.map((skill) => ({
            name: skill.name,
            files: skill.files.map((file) => file.path),
          })),
        });
        for (const skill of skills) {
          for (const file of skill.files) {
            await sandbox.fs.uploadFile(
              Buffer.from(file.content, "utf8"),
              `${SKILLS_PATH}/${skill.name}/${file.path}`,
            );
          }
        }
      }

      await emitStage("model_resolving", "Resolving Codex model credential");
      const configuredModelId = input.configuredModel?.trim() || undefined;
      const { model, reasoningEffort } = input.providerCredentialId
        ? await registerOpenAICodexCredentialModel(input.providerCredentialId, {
            modelId: configuredModelId,
            reasoningEffort: input.configuredReasoningEffort,
          })
        : {
            model: configuredModelId ? `openai-codex/${configuredModelId}` : DEFAULT_CODEX_MODEL,
            reasoningEffort: resolveReasoningEffort(input.configuredReasoningEffort),
          };

      const githubTools = createGitHubImplementationTools(input, {
        client: githubClient,
        issueNumber,
        // A babysit fix round adds the read_pull_request_review tool bound to the
        // existing PR so the Coder can read the Reviewer's requested changes (they
        // live on the pull request, not the linked issue's comments).
        pullRequestNumber: babysit?.pullRequestNumber,
      });

      await emitStage("flue_implementation", "Starting Flue implementation session", {
        model,
        reasoningEffort,
      });
      const agentOutcome = await this.runAgent({
        sandbox,
        input,
        issue,
        model,
        reasoningEffort,
        githubTools,
        repositoryPath: REPOSITORY_PATH,
        onFlueEvent: (event) => input.onEvent?.({ type: "flue.event", event }),
      });
      logs.push("flue implementation session completed");

      // Stage everything the agent left uncommitted and commit it. The agent is told
      // not to commit, but models routinely commit their own work anyway — so a clean
      // working tree here does NOT mean "no changes": real, pushable commits may
      // already exist on the branch. Only create the runner's commit when something is
      // actually staged.
      await emitStage("changes_staging", "Staging working tree changes");
      await executeSandboxCommand({
        sandbox,
        command: "git add -A",
        cwd: REPOSITORY_PATH,
        timeout: 120,
        logs,
        redactions,
      });
      const status = await executeSandboxCommand({
        sandbox,
        command: "git status --porcelain",
        cwd: REPOSITORY_PATH,
        timeout: 60,
        logs,
        redactions,
      });
      if (status.trim()) {
        const commitMessage = `${issue.title}\n\nCloses #${issueNumber}\n\nImplemented by ${identity.name} (run ${input.agentRunId}).`;
        await emitStage("changes_committing", "Committing the Coder's changes");
        await executeSandboxCommand({
          sandbox,
          command: `git commit -m ${shellQuote(commitMessage)}`,
          cwd: REPOSITORY_PATH,
          timeout: 120,
          logs,
          redactions,
        });
      }

      // The real gate is whether the branch has any commits ahead of the default
      // branch — that is what a pull request pushes. A clean tree with the agent's own
      // commits is a valid PR; only a branch with zero commits ahead is a genuine
      // "nothing to open a pull request from" failure. Skipped for a babysit round:
      // the single-branch clone of the Coder branch never fetched origin/<default>,
      // and the pull request already exists, so a no-new-commit push is a harmless
      // no-op rather than a failure.
      if (!babysit) {
        const commitsAheadOutput = await executeSandboxCommand({
          sandbox,
          command: `git rev-list --count ${shellQuote(`origin/${input.defaultBranch}..HEAD`)}`,
          cwd: REPOSITORY_PATH,
          timeout: 60,
          logs,
          redactions,
        });
        const commitsAhead = Number.parseInt(commitsAheadOutput.trim(), 10);
        if (!Number.isFinite(commitsAhead) || commitsAhead <= 0) {
          throw new ImplementationSandboxRunError(
            "The Coder produced no changes to open a pull request from: the working tree is clean and the branch has no commits ahead of the default branch.",
            { sandboxId },
          );
        }
      }

      // Push straight to the authenticated URL passed as a positional argument, never
      // writing the installation token into .git/config. The untrusted agent had full
      // shell control over this repo before this point (issue bodies are attacker
      // controllable), so a token persisted in the remote would be readable by an
      // agent-planted `.git/hooks/pre-push`, `core.fsmonitor` command, or
      // `credential.helper`, and an agent-planted `remote.origin.pushurl` could
      // silently redirect a `git push origin`. Passing the URL positionally makes git
      // ignore the configured remote (and any planted pushurl) entirely, and hooks /
      // fsmonitor / credential helpers are neutralized for this one invocation so none
      // of them can execute or capture the token. The remote stays the tokenless URL
      // set right after clone, so there is nothing left to scrub.
      await emitStage("branch_pushing", `Pushing ${branch}`, { branch });
      await executeSandboxCommand({
        sandbox,
        command: `GIT_TERMINAL_PROMPT=0 git -c core.hooksPath=/dev/null -c core.fsmonitor= -c credential.helper= push ${shellQuote(
          authenticatedCloneUrl,
        )} ${shellQuote(`HEAD:refs/heads/${branch}`)}`,
        cwd: REPOSITORY_PATH,
        timeout: 300,
        logs,
        redactions,
      });

      const artifacts = [
        {
          name: ISSUE_CONTEXT_PATH,
          contentType: "text/markdown",
          content: issueContext,
        },
      ];

      if (babysit) {
        // The pull request already exists; the push re-triggers review via
        // `synchronize`. Post a progress comment noting the fix round and return the
        // existing branch + pull request unchanged.
        await emitStage("issue_comment_posting", "Posting babysit progress comment on the issue");
        await emitTool("post_issue_progress_comment", "started", "Posting issue progress comment", {
          issueNumber,
        });
        const comment = await postIssueComment(githubClient, input, {
          issueNumber,
          body: `Pushed updates to \`${branch}\` addressing the latest review on pull request #${babysit.pullRequestNumber}.`,
        });
        await emitTool(
          "post_issue_progress_comment",
          "completed",
          "Posted issue progress comment",
          {
            issueNumber,
            commentId: comment.commentId,
          },
        );

        completedResult = {
          sandboxProvider: "daytona",
          sandboxId,
          model,
          summary: agentOutcome.summary,
          artifacts,
          branch,
          pullRequestNumber: babysit.pullRequestNumber,
          pullRequestState: "open",
        };
      } else {
        await emitStage("pull_request_opening", `Opening pull request for #${issueNumber}`, {
          branch,
          base: input.defaultBranch,
        });
        await emitTool("create_pull_request", "started", "Opening pull request", {
          head: branch,
          base: input.defaultBranch,
          issueNumber,
        });
        const pullRequest = await openPullRequest(githubClient, {
          owner: input.owner,
          repo: input.repo,
          title: issue.title,
          head: branch,
          base: input.defaultBranch,
          issueNumber,
          summary: agentOutcome.summary,
        });
        await emitTool("create_pull_request", "completed", "Opened pull request", {
          pullRequestNumber: pullRequest.number,
          pullRequestUrl: pullRequest.htmlUrl,
        });
        logs.push(`opened pull request #${pullRequest.number}`);

        // Post a progress comment on the issue AS the Coder, linking the pull request.
        await emitStage("issue_comment_posting", "Posting progress comment on the issue");
        await emitTool("post_issue_progress_comment", "started", "Posting issue progress comment", {
          issueNumber,
        });
        const comment = await postIssueComment(githubClient, input, {
          issueNumber,
          body: pullRequest.htmlUrl
            ? `Opened pull request #${pullRequest.number} (${pullRequest.htmlUrl}) to close this issue.`
            : `Opened pull request #${pullRequest.number} to close this issue.`,
        });
        await emitTool(
          "post_issue_progress_comment",
          "completed",
          "Posted issue progress comment",
          {
            issueNumber,
            commentId: comment.commentId,
          },
        );

        completedResult = {
          sandboxProvider: "daytona",
          sandboxId,
          model,
          summary: agentOutcome.summary,
          artifacts,
          branch,
          pullRequestNumber: pullRequest.number,
          pullRequestState: pullRequest.state,
          pullRequestUrl: pullRequest.htmlUrl ?? undefined,
        };
      }
    } catch (error) {
      runError = error;
    } finally {
      try {
        await emitStage("sandbox_cleanup", "Deleting Daytona sandbox", { sandboxId });
        await sandbox.delete(60);
        logs.push(`daytona sandbox ${sandboxId} deleted`);
        await input.onEvent?.({ type: "sandbox.deleted", sandboxId });
      } catch (error) {
        const message = error instanceof Error ? error.message : "unknown error";
        logs.push(`daytona sandbox ${sandboxId} deletion failed: ${message}`);
        await input.onEvent?.({
          type: "sandbox.delete_failed",
          sandboxId,
          errorMessage: message,
        });
      } finally {
        await client[Symbol.asyncDispose]?.();
      }
    }

    if (runError) {
      throw new ImplementationSandboxRunError(errorMessage(runError), {
        logs: logs.join("\n"),
        sandboxId,
      });
    }

    if (!completedResult) {
      throw new Error("Daytona implementation completed without a result.");
    }

    return {
      ...completedResult,
      logs: logs.join("\n"),
    };
  }
}
