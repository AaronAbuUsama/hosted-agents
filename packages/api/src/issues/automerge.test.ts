import { describe, expect, test } from "bun:test";

import { BABYSIT_STOP_HUMAN, BABYSIT_STOP_HUMAN_APPROVED, BABYSIT_STOP_ROUND_CAP } from "./babysit";
import {
  decideAutoMerge,
  isRepositoryAutomergeAllowed,
  parseAutomergeRepositories,
  type AutoMergeInput,
} from "./automerge";

function input(overrides: Partial<AutoMergeInput> = {}): AutoMergeInput {
  return {
    reviewState: "approved",
    repositoryAllowListed: true,
    pullRequestOpen: true,
    babysitBlockedReason: null,
    alreadyMerged: false,
    ...overrides,
  };
}

describe("parseAutomergeRepositories", () => {
  test("splits on commas and whitespace, trims, and lowercases", () => {
    const set = parseAutomergeRepositories("AaronAbuUsama/test-repo, Octo/Widgets\nfoo/bar");
    expect([...set].sort()).toEqual(["aaronabuusama/test-repo", "foo/bar", "octo/widgets"]);
  });

  test("an unset or empty value yields an empty set — nothing auto-merges", () => {
    expect(parseAutomergeRepositories(undefined).size).toBe(0);
    expect(parseAutomergeRepositories(null).size).toBe(0);
    expect(parseAutomergeRepositories("").size).toBe(0);
    expect(parseAutomergeRepositories("   ,  \n ").size).toBe(0);
  });

  test("membership is case-insensitive", () => {
    const set = parseAutomergeRepositories("AaronAbuUsama/test-repo");
    expect(isRepositoryAutomergeAllowed(set, "aaronabuusama/test-repo")).toBe(true);
    expect(isRepositoryAutomergeAllowed(set, "AaronAbuUsama/Test-Repo")).toBe(true);
    expect(isRepositoryAutomergeAllowed(set, "octo/widgets")).toBe(false);
  });
});

describe("decideAutoMerge", () => {
  test("allow-listed + approved + open + not-stopped merges (the point of the loop)", () => {
    expect(decideAutoMerge(input())).toEqual({ action: "merge" });
  });

  test("a human approval on an allow-listed Coder PR still merges", () => {
    // `human_approved` is a stop that keeps the PR mergeable — it must NOT block the
    // merge. The transport records the stop AND then merges.
    expect(decideAutoMerge(input({ babysitBlockedReason: BABYSIT_STOP_HUMAN_APPROVED }))).toEqual({
      action: "merge",
    });
  });

  test("a non-allow-listed repo never merges — it comments ready and stops", () => {
    expect(decideAutoMerge(input({ repositoryAllowListed: false }))).toEqual({
      action: "comment_ready",
      reason: "repository_not_allow_listed",
    });
  });

  test("a non-approved review never merges", () => {
    for (const reviewState of ["changes_requested", "commented", "dismissed", "pending"]) {
      expect(decideAutoMerge(input({ reviewState }))).toEqual({
        action: "skip",
        reason: "review_not_approved",
      });
    }
  });

  test("a human takeover blocks the merge (humans always win) even when allow-listed", () => {
    expect(decideAutoMerge(input({ babysitBlockedReason: BABYSIT_STOP_HUMAN }))).toEqual({
      action: "skip",
      reason: "babysit_stopped",
    });
  });

  test("a round-cap-exhausted (Failed / Blocked) PR never merges", () => {
    expect(decideAutoMerge(input({ babysitBlockedReason: BABYSIT_STOP_ROUND_CAP }))).toEqual({
      action: "skip",
      reason: "babysit_stopped",
    });
  });

  test("a closed pull request never merges", () => {
    expect(decideAutoMerge(input({ pullRequestOpen: false }))).toEqual({
      action: "skip",
      reason: "pull_request_not_open",
    });
  });

  test("an already-merged PR is an idempotent no-op (redelivered approval)", () => {
    expect(decideAutoMerge(input({ alreadyMerged: true }))).toEqual({
      action: "skip",
      reason: "already_merged",
    });
    // The already-merged guard wins even if the repo is (still) allow-listed and the
    // PR reads closed on the redelivery.
    expect(decideAutoMerge(input({ alreadyMerged: true, pullRequestOpen: false }))).toEqual({
      action: "skip",
      reason: "already_merged",
    });
  });
});
