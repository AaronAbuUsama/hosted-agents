import {
  CODE_REVIEW_WORKER_DISPLAY_NAME,
  CODE_REVIEW_WORKER_ROLE,
  GITHUB_PULL_REQUEST_REVIEW_RUN_TYPE,
  LEGACY_CODE_REVIEW_COWORKER_SLUG,
} from "@hosted-agents/db/schema/agent-runs";

export type GitHubPullRequestRunPlan = {
  workerRole: string;
  workerDisplayName: string;
  legacyCoworkerSlug: string;
  runType: string;
};

export function planGitHubPullRequestRun(): GitHubPullRequestRunPlan {
  return {
    workerRole: CODE_REVIEW_WORKER_ROLE,
    workerDisplayName: CODE_REVIEW_WORKER_DISPLAY_NAME,
    legacyCoworkerSlug: LEGACY_CODE_REVIEW_COWORKER_SLUG,
    runType: GITHUB_PULL_REQUEST_REVIEW_RUN_TYPE,
  };
}
