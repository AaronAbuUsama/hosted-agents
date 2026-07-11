import { describe, expect, test } from "bun:test";

import {
  CODE_REVIEW_WORKER_DISPLAY_NAME,
  CODE_REVIEW_WORKER_ROLE,
  GITHUB_ISSUE_IMPLEMENTATION_RUN_TYPE,
  GITHUB_PULL_REQUEST_REVIEW_RUN_TYPE,
  IMPLEMENTATION_WORKER_DISPLAY_NAME,
  IMPLEMENTATION_WORKER_ROLE,
} from "@hosted-agents/db/schema/agent-runs";

import { planGitHubIssueImplementationRun, planGitHubPullRequestRun } from "./github-run-planner";

describe("github run planner", () => {
  test("plans a pull request review run for the code review role", () => {
    expect(planGitHubPullRequestRun()).toEqual({
      workerRole: CODE_REVIEW_WORKER_ROLE,
      workerDisplayName: CODE_REVIEW_WORKER_DISPLAY_NAME,
      legacyCoworkerSlug: "code-review",
      runType: GITHUB_PULL_REQUEST_REVIEW_RUN_TYPE,
    });
  });

  test("plans an issue implementation run for the implementation role", () => {
    const plan = planGitHubIssueImplementationRun();

    expect(plan).toEqual({
      workerRole: IMPLEMENTATION_WORKER_ROLE,
      workerDisplayName: IMPLEMENTATION_WORKER_DISPLAY_NAME,
      legacyCoworkerSlug: "implementation",
      runType: GITHUB_ISSUE_IMPLEMENTATION_RUN_TYPE,
    });
    // The run type sits beside code review, not on top of it — one queue key per
    // role so the two workers never claim each other's runs.
    expect(plan.runType).toBe("github.issue_implementation");
    expect(plan.runType).not.toBe(planGitHubPullRequestRun().runType);
    expect(plan.workerRole).not.toBe(CODE_REVIEW_WORKER_ROLE);
  });
});
