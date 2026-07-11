import {
  CODE_REVIEW_WORKER_DISPLAY_NAME,
  CODE_REVIEW_WORKER_ROLE,
  GITHUB_ISSUE_IMPLEMENTATION_RUN_TYPE,
  GITHUB_PULL_REQUEST_REVIEW_RUN_TYPE,
  IMPLEMENTATION_WORKER_DISPLAY_NAME,
  IMPLEMENTATION_WORKER_ROLE,
  LEGACY_CODE_REVIEW_COWORKER_SLUG,
  LEGACY_IMPLEMENTATION_COWORKER_SLUG,
} from "@hosted-agents/db/schema/agent-runs";

export type GitHubRunPlan = {
  workerRole: string;
  workerDisplayName: string;
  legacyCoworkerSlug: string;
  runType: string;
};

// Kept as an alias for callers that predate the second worker role.
export type GitHubPullRequestRunPlan = GitHubRunPlan;

export function planGitHubPullRequestRun(): GitHubRunPlan {
  return {
    workerRole: CODE_REVIEW_WORKER_ROLE,
    workerDisplayName: CODE_REVIEW_WORKER_DISPLAY_NAME,
    legacyCoworkerSlug: LEGACY_CODE_REVIEW_COWORKER_SLUG,
    runType: GITHUB_PULL_REQUEST_REVIEW_RUN_TYPE,
  };
}

// The implementation ("Coder") role adapter. A ready-for-agent issue kicked off
// by a member (C4) inserts one queued run with this plan; the implementation
// worker (limit: 1) claims it and drives it to a branch + pull request.
export function planGitHubIssueImplementationRun(): GitHubRunPlan {
  return {
    workerRole: IMPLEMENTATION_WORKER_ROLE,
    workerDisplayName: IMPLEMENTATION_WORKER_DISPLAY_NAME,
    legacyCoworkerSlug: LEGACY_IMPLEMENTATION_COWORKER_SLUG,
    runType: GITHUB_ISSUE_IMPLEMENTATION_RUN_TYPE,
  };
}
