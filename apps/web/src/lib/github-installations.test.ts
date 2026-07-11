/// <reference types="bun" />

import { describe, expect, test } from "bun:test";

import {
  IMPLEMENTATION_WORKER_ROLE,
  isCoderInstallation,
  isReviewerInstallation,
} from "./github-installations";

const reviewer = { workerRole: "code_review" };
const coder = { workerRole: IMPLEMENTATION_WORKER_ROLE };
// Any unknown/legacy role must be treated as reviewer, matching the server's
// resolveGitHubAppWorkerRole default (only the Coder slug maps to implementation).
const legacy = { workerRole: "something-else" };

describe("isCoderInstallation", () => {
  test("is true only for the implementation worker role", () => {
    expect(isCoderInstallation(coder)).toBe(true);
    expect(isCoderInstallation(reviewer)).toBe(false);
    expect(isCoderInstallation(legacy)).toBe(false);
  });
});

describe("isReviewerInstallation", () => {
  test("is true for reviewer and legacy roles, false for the Coder app", () => {
    expect(isReviewerInstallation(reviewer)).toBe(true);
    expect(isReviewerInstallation(legacy)).toBe(true);
    expect(isReviewerInstallation(coder)).toBe(false);
  });

  test("filters a mixed installation list down to reviewer installations", () => {
    const installations = [reviewer, coder, legacy];
    expect(installations.filter(isReviewerInstallation)).toEqual([reviewer, legacy]);
  });

  test("de-duplicates a repo that both apps expose to a single reviewer copy", () => {
    // The same GitHub repo appears under both installations with distinct ids.
    // Reviewer surfaces must keep only the reviewer copy.
    const installations = [
      { workerRole: "code_review", repositories: [{ id: "reviewer-repo" }] },
      { workerRole: IMPLEMENTATION_WORKER_ROLE, repositories: [{ id: "coder-repo" }] },
    ];

    const repositories = installations
      .filter(isReviewerInstallation)
      .flatMap((installation) => installation.repositories);

    expect(repositories).toEqual([{ id: "reviewer-repo" }]);
  });
});
