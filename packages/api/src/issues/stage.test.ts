import { describe, expect, test } from "bun:test";

import {
  HUMAN_IN_THE_LOOP_LABEL,
  READY_FOR_AGENT_LABEL,
  deriveStage,
  isAgentClaimable,
  type StageInput,
} from "./stage";

function input(overrides: Partial<StageInput> = {}): StageInput {
  return {
    issueState: "open",
    labels: [],
    claimed: false,
    ...overrides,
  };
}

describe("deriveStage", () => {
  test("an open issue with no gating label is Backlog", () => {
    expect(deriveStage(input())).toBe("backlog");
  });

  test("a human-in-the-loop issue that has not started is Backlog", () => {
    expect(deriveStage(input({ labels: [HUMAN_IN_THE_LOOP_LABEL] }))).toBe("backlog");
  });

  test("a ready-for-agent issue that is not claimed is Ready for agent", () => {
    expect(deriveStage(input({ labels: [READY_FOR_AGENT_LABEL] }))).toBe("ready_for_agent");
  });

  test("a claimed issue with no pull request is Executing", () => {
    expect(deriveStage(input({ labels: [READY_FOR_AGENT_LABEL], claimed: true }))).toBe(
      "executing",
    );
  });

  test("an issue with an open linked pull request is In PR", () => {
    expect(
      deriveStage(input({ claimed: true, linkedPullRequest: { state: "open", merged: false } })),
    ).toBe("in_pr");
  });

  test("an issue whose linked pull request merged is Merged", () => {
    expect(deriveStage(input({ linkedPullRequest: { state: "closed", merged: true } }))).toBe(
      "merged",
    );
  });

  test("an issue closed by a merge is Merged even without a linked PR record", () => {
    expect(deriveStage(input({ issueState: "closed", closedByMerge: true }))).toBe("merged");
  });

  test("a closed issue that did not merge is Closed, not Backlog", () => {
    expect(deriveStage(input({ issueState: "closed" }))).toBe("closed");
  });

  test("a closed, ready-labelled issue is Closed, not Ready for agent", () => {
    expect(deriveStage(input({ issueState: "closed", labels: [READY_FOR_AGENT_LABEL] }))).toBe(
      "closed",
    );
  });

  test("a closed, claimed issue with no PR is Closed, not Executing", () => {
    expect(deriveStage(input({ issueState: "closed", claimed: true }))).toBe("closed");
  });

  test("a closed issue with an open linked PR stays In PR (the PR is still live)", () => {
    expect(
      deriveStage(
        input({ issueState: "closed", linkedPullRequest: { state: "open", merged: false } }),
      ),
    ).toBe("in_pr");
  });

  test("a closed issue whose run failed is Failed / Blocked, not Closed", () => {
    expect(deriveStage(input({ issueState: "closed", runStatus: "failed" }))).toBe(
      "failed_blocked",
    );
  });

  test("a failed run is Failed / Blocked from any stage", () => {
    expect(
      deriveStage(input({ labels: [READY_FOR_AGENT_LABEL], claimed: true, runStatus: "failed" })),
    ).toBe("failed_blocked");
  });

  test("an explicitly blocked issue is Failed / Blocked", () => {
    expect(
      deriveStage(input({ linkedPullRequest: { state: "open", merged: false }, blocked: true })),
    ).toBe("failed_blocked");
  });

  test("label matching is case- and whitespace-insensitive", () => {
    expect(deriveStage(input({ labels: ["  Ready For Agent "] }))).toBe("ready_for_agent");
  });

  test("label matching is separator-insensitive (hyphen / underscore)", () => {
    expect(deriveStage(input({ labels: ["ready-for-agent"] }))).toBe("ready_for_agent");
    expect(deriveStage(input({ labels: ["ready_for_agent"] }))).toBe("ready_for_agent");
  });

  test("Merged wins over an open-PR signal when the PR is merged", () => {
    // closed+merged PR must resolve to Merged, not In PR.
    expect(
      deriveStage(
        input({ issueState: "closed", linkedPullRequest: { state: "closed", merged: true } }),
      ),
    ).toBe("merged");
  });
});

describe("isAgentClaimable", () => {
  test("ready-for-agent, unclaimed, no PR is claimable", () => {
    expect(isAgentClaimable(input({ labels: [READY_FOR_AGENT_LABEL] }))).toBe(true);
  });

  test("human-in-the-loop is never claimable, even with the ready label", () => {
    expect(
      isAgentClaimable(input({ labels: [READY_FOR_AGENT_LABEL, HUMAN_IN_THE_LOOP_LABEL] })),
    ).toBe(false);
  });

  test("an unlabeled issue is not claimable", () => {
    expect(isAgentClaimable(input())).toBe(false);
  });

  test("an already-claimed (executing) issue is not re-claimable", () => {
    expect(isAgentClaimable(input({ labels: [READY_FOR_AGENT_LABEL], claimed: true }))).toBe(false);
  });

  test("a closed issue is never claimable, even with the ready label", () => {
    // The closed issue sits in the Closed lane, not ready_for_agent, so kick-off is
    // never offered on a resolved issue.
    expect(isAgentClaimable(input({ issueState: "closed", labels: [READY_FOR_AGENT_LABEL] }))).toBe(
      false,
    );
  });
});
