import type { SandboxLifecycleEvent } from "./sandbox-lifecycle-event";

// The write-capable sandbox seam for the implementation ("Coder") role. The
// worker (implementation-run-worker.ts) owns the claim + serial drain and hands a
// resolved run to a runner implementing this interface. The Daytona
// implementation (branch → commit → push → pulls.create → issue comment) lands in
// coder-mvp C5; this file is the stable contract both the worker and that runner
// build against.

// A skill bundle: a directory of markdown files with a SKILL.md entry file.
export type ImplementationWorkerSkillFile = {
  path: string;
  content: string;
};

export type ImplementationWorkerSkill = {
  name: string;
  files: ImplementationWorkerSkillFile[];
};

export type ImplementationSandboxRunInput = {
  agentRunId: string;
  organizationId: string;
  workerRole: string;
  workerDisplayName: string;
  configuredModel?: string;
  configuredReasoningEffort?: string;
  configuredInstructions?: string;
  skills?: ImplementationWorkerSkill[];
  providerCredentialId?: string;
  githubInstallationId: string;
  githubRepositoryId: string;
  installationId: string;
  installationAccessToken: string;
  owner: string;
  repo: string;
  // The branch the sandbox checks out and cuts the Coder's branch from.
  defaultBranch: string;
  // The issue this run implements. Kick-off (C4) links the issue to the run;
  // optional here so the seam type is stable across that slice.
  issueNumber?: number;
  issueTitle?: string;
  issueBody?: string;
  onEvent?: (event: SandboxLifecycleEvent) => void | Promise<void>;
};

export type ImplementationSandboxArtifact = {
  name: string;
  contentType: string;
  content: string;
};

export type ImplementationSandboxRunResult = {
  sandboxProvider: string;
  sandboxId: string;
  model: string;
  summary: string;
  artifacts: ImplementationSandboxArtifact[];
  logs: string;
  // The branch + pull request the Coder opened, when it got that far. The worker
  // stamps these onto the run row so the board's In PR lane is immediate; webhook
  // sync keeps them fresh thereafter (C5 populates them).
  branch?: string;
  pullRequestNumber?: number;
  pullRequestState?: string;
  pullRequestUrl?: string;
};

export interface ImplementationSandboxRunner {
  run(input: ImplementationSandboxRunInput): Promise<ImplementationSandboxRunResult>;
}

export class ImplementationSandboxRunError extends Error {
  readonly logs?: string;
  readonly sandboxId?: string;

  constructor(message: string, options: { logs?: string; sandboxId?: string } = {}) {
    super(message);
    this.name = "ImplementationSandboxRunError";
    this.logs = options.logs;
    this.sandboxId = options.sandboxId;
  }
}
