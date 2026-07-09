import { Buffer } from "node:buffer";

import { env } from "@hosted-agents/env/server";
import { Daytona, type Sandbox } from "@daytona/sdk";
import { defineAgent } from "@flue/runtime";
import { createFlueContext, resolveModel } from "@flue/runtime/internal";
import { CODE_REVIEW_WORKER_DISPLAY_NAME } from "@hosted-agents/db/schema/agent-runs";
import * as v from "valibot";

import { registerOpenAICodexCredentialModel } from "../lib/provider-credential-model";
import { daytona } from "../sandboxes/daytona";
import type {
  CodeReviewSandboxRunInput,
  CodeReviewSandboxRunner,
  CodeReviewSandboxRunResult,
} from "./code-review-sandbox-runner";
import { CodeReviewSandboxRunError } from "./code-review-sandbox-runner";
import { createGitHubCodeReviewTools } from "./github-code-review-tools";

const DEFAULT_CODEX_MODEL = "openai-codex/gpt-5.5";
const REPOSITORY_PATH = "repo";
const REVIEW_CONTEXT_PATH = "coworker-review-context.md";
const SKILLS_PATH = "skills";
const MAX_DIFF_CHARS = 180_000;

const severitySchema = v.picklist(["low", "medium", "high", "critical"]);
const findingSchema = v.object({
  title: v.string(),
  severity: severitySchema,
  file: v.optional(v.string()),
  line: v.optional(v.number()),
  detail: v.string(),
  recommendation: v.optional(v.string()),
});
const reviewResultSchema = v.object({
  summary: v.string(),
  findings: v.array(findingSchema),
});

type ReviewResult = v.InferOutput<typeof reviewResultSchema>;

export type DaytonaSandboxCleanupResult =
  | {
      sandboxId: string;
      status: "deleted";
    }
  | {
      sandboxId: string;
      status: "delete_failed";
      errorMessage: string;
    };

function sanitizeSecret(value: string, secret: string) {
  return secret ? value.replaceAll(secret, "[redacted]") : value;
}

function shellQuote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function assertGitHubName(value: string, label: string) {
  if (!/^[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error(`Unsafe GitHub ${label}: ${value}`);
  }
}

function truncate(value: string, maxChars: number) {
  if (value.length <= maxChars) {
    return value;
  }

  return `${value.slice(0, maxChars)}\n\n[diff truncated at ${maxChars} characters]\n`;
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Unknown Daytona code review failure";
}

function commandOutput(result: Awaited<ReturnType<Sandbox["process"]["executeCommand"]>>) {
  return result.result || result.artifacts?.stdout || "";
}

async function executeSandboxCommand({
  sandbox,
  command,
  cwd,
  env,
  timeout,
  logs,
  redactions,
}: {
  sandbox: Sandbox;
  command: string;
  cwd?: string;
  env?: Record<string, string>;
  timeout?: number;
  logs: string[];
  redactions: string[];
}) {
  const redactedCommand = redactions.reduce(
    (current, secret) => sanitizeSecret(current, secret),
    command,
  );
  logs.push(`$ ${redactedCommand}`);
  const result = await sandbox.process.executeCommand(`${command} 2>&1`, cwd, env, timeout);
  const output = redactions.reduce(
    (current, secret) => sanitizeSecret(current, secret),
    commandOutput(result),
  );

  if (output.trim()) {
    logs.push(output.trimEnd());
  }

  if (result.exitCode !== 0) {
    throw new Error(`Sandbox command failed with exit code ${result.exitCode}: ${redactedCommand}`);
  }

  return output;
}

function createReviewContext(input: CodeReviewSandboxRunInput, diffStat: string, diff: string) {
  return [
    "# Coworker Code Review Context",
    "",
    `Agent run: ${input.agentRunId}`,
    `Repository: ${input.owner}/${input.repo}`,
    `Pull request: #${input.pullRequestNumber}`,
    `Base: ${input.baseRef} (${input.baseSha})`,
    `Head: ${input.headRef} (${input.headSha})`,
    "",
    "## Diff Stat",
    "",
    "```text",
    diffStat.trim() || "No diff stat produced.",
    "```",
    "",
    "## Diff",
    "",
    "```diff",
    truncate(diff, MAX_DIFF_CHARS).trim() || "No diff produced.",
    "```",
  ].join("\n");
}

async function runFlueReview({
  sandbox,
  input,
  model,
  onFlueEvent,
}: {
  sandbox: Sandbox;
  input: CodeReviewSandboxRunInput;
  model: string;
  onFlueEvent?: (event: unknown) => void | Promise<void>;
}): Promise<ReviewResult> {
  const githubTools = createGitHubCodeReviewTools(input);
  const skillNames = (input.skills ?? []).map((skill) => skill.name);
  const configuredInstructions = input.configuredInstructions?.trim();
  const agent = defineAgent(() => ({
    model,
    sandbox: daytona(sandbox),
    cwd: REPOSITORY_PATH,
    tools: githubTools.tools,
    instructions: [
      "You are Coworker's code review worker.",
      `Your configured display name is ${input.workerDisplayName || CODE_REVIEW_WORKER_DISPLAY_NAME}.`,
      "Your worker role is code_review. Do not assume a personal identity beyond the configured display name.",
      "First call start_github_review before inspecting files or running shell commands.",
      "Review the checked-out pull request inside the sandbox workspace.",
      `Read ../${REVIEW_CONTEXT_PATH} first, then inspect repository files as needed.`,
      ...(skillNames.length > 0
        ? [
            `Then load every team skill under ../${SKILLS_PATH}/ (${skillNames.join(", ")}): each is a directory whose SKILL.md entry describes the skill and references any sibling files. Apply them as review guidance.`,
          ]
        : []),
      "Return only supported findings. Do not invent files, tests, or execution proof.",
      "Prefer high-signal findings about correctness, security, data loss, migrations, runtime behavior, and test gaps.",
      "Submit your review through submit_pull_request_review. Use inline comments only when you can anchor them to the diff.",
      "Use comment_on_pull_request only as a fallback or for additional top-level context.",
      "After submitting the review, call complete_review_check with the final conclusion and summary.",
      "If there is no actionable issue, return a concise summary and an empty findings array.",
      ...(configuredInstructions
        ? ["", "Team review guidance (configured by the organization):", configuredInstructions]
        : []),
    ].join("\n"),
  }));
  const ctx = createFlueContext({
    id: input.agentRunId,
    runId: input.agentRunId,
    env: process.env,
    agentConfig: {
      resolveModel,
    },
    createDefaultEnv: async () => {
      throw new Error("Daytona runner requires an explicit sandbox.");
    },
  });
  const unsubscribe = onFlueEvent ? ctx.subscribeEvent((event) => onFlueEvent(event)) : undefined;
  const harness = await ctx.initializeRootHarness(agent);

  try {
    const session = await harness.session();
    const response = await session.prompt(
      [
        "Review this pull request end to end.",
        "",
        `Repository: ${input.owner}/${input.repo}`,
        `Pull request: #${input.pullRequestNumber}`,
        `Base SHA: ${input.baseSha}`,
        `Head SHA: ${input.headSha}`,
        "",
        "First call start_github_review.",
        `Then read ../${REVIEW_CONTEXT_PATH}. Use shell/file tools only inside this sandbox.`,
        "Submit the GitHub review and complete the GitHub check before returning the structured result.",
      ].join("\n"),
      {
        result: reviewResultSchema,
        model,
      },
    );

    if (!githubTools.state.started) {
      throw new Error("Code review worker did not call start_github_review.");
    }
    if (!githubTools.state.submittedReview) {
      throw new Error("Code review worker did not call submit_pull_request_review.");
    }
    if (!githubTools.state.completedCheck) {
      throw new Error("Code review worker did not call complete_review_check.");
    }

    return response.data;
  } finally {
    await harness.close();
    await ctx.flushEventCallbacks();
    unsubscribe?.();
  }
}

export async function cleanupDaytonaSandboxesByLabels({
  labels,
  timeout = 60,
}: {
  labels: Record<string, string>;
  timeout?: number;
}): Promise<DaytonaSandboxCleanupResult[]> {
  if (!env.DAYTONA_API_KEY) {
    throw new Error("DAYTONA_API_KEY is required to clean up Daytona sandboxes.");
  }

  const client = new Daytona({
    apiKey: env.DAYTONA_API_KEY,
    apiUrl: env.DAYTONA_API_URL,
    otelEnabled: false,
  });
  const results: DaytonaSandboxCleanupResult[] = [];

  try {
    for await (const sandbox of client.list({ labels })) {
      try {
        await sandbox.delete(timeout);
        results.push({ sandboxId: sandbox.id, status: "deleted" });
      } catch (error) {
        results.push({
          sandboxId: sandbox.id,
          status: "delete_failed",
          errorMessage: errorMessage(error),
        });
      }
    }
  } finally {
    await client[Symbol.asyncDispose]?.();
  }

  return results;
}

export class DaytonaCodeReviewSandboxRunner implements CodeReviewSandboxRunner {
  async run(input: CodeReviewSandboxRunInput): Promise<CodeReviewSandboxRunResult> {
    if (!env.DAYTONA_API_KEY) {
      throw new Error("DAYTONA_API_KEY is required to run code reviews in Daytona.");
    }

    assertGitHubName(input.owner, "owner");
    assertGitHubName(input.repo, "repository name");

    const client = new Daytona({
      apiKey: env.DAYTONA_API_KEY,
      apiUrl: env.DAYTONA_API_URL,
      otelEnabled: false,
    });
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
    let completedResult: Omit<CodeReviewSandboxRunResult, "logs"> | undefined;
    let runError: unknown;

    try {
      logs.push(`daytona sandbox ${sandboxId} created`);
      const cloneUrl = `https://github.com/${input.owner}/${input.repo}.git`;
      const authenticatedCloneUrl = `https://x-access-token:${encodedInstallationAccessToken}@github.com/${input.owner}/${input.repo}.git`;
      await emitStage("repository_cloning", `Cloning ${input.owner}/${input.repo}`);
      await executeSandboxCommand({
        sandbox,
        command: `GIT_TERMINAL_PROMPT=0 git clone --no-checkout ${shellQuote(
          authenticatedCloneUrl,
        )} ${shellQuote(REPOSITORY_PATH)}`,
        timeout: 600,
        logs,
        redactions,
      });
      await emitStage("repository_fetching", "Fetching pull request base and head SHAs", {
        baseSha: input.baseSha,
        headSha: input.headSha,
      });
      await executeSandboxCommand({
        sandbox,
        command: `GIT_TERMINAL_PROMPT=0 git fetch --no-tags origin ${shellQuote(
          input.baseSha,
        )} ${shellQuote(input.headSha)}`,
        cwd: REPOSITORY_PATH,
        timeout: 600,
        logs,
        redactions,
      });
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
      await emitStage("repository_checkout", "Checking out pull request head SHA", {
        headSha: input.headSha,
      });
      await executeSandboxCommand({
        sandbox,
        command: `git checkout --force ${shellQuote(input.headSha)}`,
        cwd: REPOSITORY_PATH,
        timeout: 120,
        logs,
        redactions,
      });
      await emitStage("diff_stat", "Computing pull request diff stat");
      const diffStat = await executeSandboxCommand({
        sandbox,
        command: `git diff --stat ${shellQuote(input.baseSha)}...${shellQuote(input.headSha)}`,
        cwd: REPOSITORY_PATH,
        timeout: 120,
        logs,
        redactions,
      });
      await emitStage("diff_full", "Computing pull request diff");
      const diff = await executeSandboxCommand({
        sandbox,
        command: `git diff --find-renames --find-copies ${shellQuote(input.baseSha)}...${shellQuote(
          input.headSha,
        )}`,
        cwd: REPOSITORY_PATH,
        timeout: 300,
        logs,
        redactions,
      });
      const reviewContext = createReviewContext(input, diffStat, diff);
      await emitStage("review_context_uploading", "Uploading review context into sandbox", {
        path: REVIEW_CONTEXT_PATH,
      });
      await sandbox.fs.uploadFile(Buffer.from(reviewContext, "utf8"), REVIEW_CONTEXT_PATH);

      // FLUE ADAPTER — runtime skill registration seam.
      // Writes each enabled skill bundle into the sandbox skills dir as
      // skills/<name>/<file path> (SKILL.md entry + sibling markdown files)
      // and the instructions line above points the agent at it. This is the
      // only place that binds bundles to the Flue runtime; when the runner
      // moves to Eve (eve.dev), swap this block to write the same files into
      // Eve's skills/ directory — the bundle shape maps 1:1, so nothing
      // outside apps/server/src/runners should change.
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
      const model = input.providerCredentialId
        ? await registerOpenAICodexCredentialModel(input.providerCredentialId, configuredModelId)
        : configuredModelId
          ? `openai-codex/${configuredModelId}`
          : DEFAULT_CODEX_MODEL;
      await emitStage("flue_review", "Starting Flue code review session", { model });
      const review = await runFlueReview({
        sandbox,
        input,
        model,
        onFlueEvent: (event) => input.onEvent?.({ type: "flue.event", event }),
      });

      logs.push(
        `review completed with ${review.findings.length} finding${
          review.findings.length === 1 ? "" : "s"
        }`,
      );
      await emitStage("result_received", "Flue review returned a structured result", {
        findings: review.findings.length,
      });

      completedResult = {
        sandboxProvider: "daytona",
        sandboxId,
        model,
        summary: review.summary,
        findingsJson: JSON.stringify(review.findings),
        artifacts: [
          {
            name: REVIEW_CONTEXT_PATH,
            contentType: "text/markdown",
            content: reviewContext,
          },
        ],
      };
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
      throw new CodeReviewSandboxRunError(errorMessage(runError), {
        logs: logs.join("\n"),
        sandboxId,
      });
    }

    if (!completedResult) {
      throw new Error("Daytona code review completed without a result.");
    }

    return {
      ...completedResult,
      logs: logs.join("\n"),
    };
  }
}
