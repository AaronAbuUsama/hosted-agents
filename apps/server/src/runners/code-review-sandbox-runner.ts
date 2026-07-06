export type CodeReviewSandboxRunInput = {
  agentRunId: string;
  organizationId: string;
  workerRole: string;
  workerDisplayName: string;
  providerCredentialId?: string;
  githubInstallationId: string;
  githubRepositoryId: string;
  installationId: string;
  installationAccessToken: string;
  owner: string;
  repo: string;
  pullRequestNumber: number;
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
  onEvent?: (event: CodeReviewSandboxLifecycleEvent) => void | Promise<void>;
};

export type CodeReviewSandboxArtifact = {
  name: string;
  contentType: string;
  content: string;
};

export type CodeReviewSandboxRunResult = {
  sandboxProvider: string;
  sandboxId: string;
  summary: string;
  findingsJson: string;
  artifacts: CodeReviewSandboxArtifact[];
  logs: string;
};

export interface CodeReviewSandboxRunner {
  run(input: CodeReviewSandboxRunInput): Promise<CodeReviewSandboxRunResult>;
}

export type CodeReviewSandboxLifecycleEvent =
  | {
      type: "sandbox.created";
      sandboxProvider: string;
      sandboxId: string;
      labels: Record<string, string>;
    }
  | {
      type: "sandbox.deleted";
      sandboxId: string;
    }
  | {
      type: "sandbox.delete_failed";
      sandboxId: string;
      errorMessage: string;
    }
  | {
      type: "stage";
      stage: string;
      message: string;
      payload?: unknown;
    }
  | {
      type: "flue.event";
      event: unknown;
    }
  | {
      type: "github.tool";
      toolName: string;
      status: "started" | "completed" | "failed";
      message: string;
      payload?: unknown;
    }
  | {
      type: "github.artifact";
      name: string;
      contentType: string;
      content?: string;
      payload?: unknown;
    };

export class CodeReviewSandboxRunError extends Error {
  readonly logs?: string;
  readonly sandboxId?: string;

  constructor(message: string, options: { logs?: string; sandboxId?: string } = {}) {
    super(message);
    this.name = "CodeReviewSandboxRunError";
    this.logs = options.logs;
    this.sandboxId = options.sandboxId;
  }
}
