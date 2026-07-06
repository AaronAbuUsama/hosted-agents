export type CodeReviewSandboxRunInput = {
  reviewRunId: string;
  organizationId: string;
  githubInstallationId: string;
  githubRepositoryId: string;
  installationId: string;
  owner: string;
  repo: string;
  pullRequestNumber: number;
  baseRef: string;
  baseSha: string;
  headRef: string;
  headSha: string;
};

export type CodeReviewSandboxArtifact = {
  name: string;
  contentType: string;
  content: string;
};

export type CodeReviewSandboxRunResult = {
  sandboxId: string;
  summary: string;
  findingsJson: string;
  artifacts: CodeReviewSandboxArtifact[];
  logs: string;
};

export interface CodeReviewSandboxRunner {
  run(input: CodeReviewSandboxRunInput): Promise<CodeReviewSandboxRunResult>;
}
