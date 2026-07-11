import { describe, expect, test } from "bun:test";

import type { GitHubIssueSummary } from "../github-app";
import { READY_FOR_AGENT_LABEL } from "./stage";
import { buildBoard, type IssueOverlay } from "./service";

function issue(overrides: Partial<GitHubIssueSummary> = {}): GitHubIssueSummary {
  return {
    number: 1,
    nodeId: null,
    githubId: null,
    title: "An issue",
    body: null,
    state: "open",
    htmlUrl: null,
    authorLogin: "octocat",
    authorAvatarUrl: null,
    labels: [],
    commentCount: 0,
    createdAt: null,
    updatedAt: null,
    ...overrides,
  };
}

function column(board: ReturnType<typeof buildBoard>, stage: string) {
  return board.find((c) => c.stage === stage);
}

describe("buildBoard", () => {
  test("always returns all seven stage columns, even when empty", () => {
    const board = buildBoard([]);
    expect(board.map((c) => c.stage)).toEqual([
      "backlog",
      "ready_for_agent",
      "executing",
      "in_pr",
      "merged",
      "closed",
      "failed_blocked",
    ]);
    expect(board.every((c) => c.issues.length === 0)).toBe(true);
  });

  test("a closed issue that did not merge groups into the Closed lane, not Backlog", () => {
    const board = buildBoard([issue({ number: 7, state: "closed" })]);
    expect(column(board, "backlog")?.issues).toHaveLength(0);
    expect(column(board, "closed")?.issues.map((i) => i.number)).toEqual([7]);
  });

  test("groups issues into the derived stage columns", () => {
    const board = buildBoard([
      issue({ number: 1, labels: [] }), // backlog
      issue({ number: 2, labels: [READY_FOR_AGENT_LABEL] }), // ready_for_agent
    ]);
    expect(column(board, "backlog")?.issues.map((i) => i.number)).toEqual([1]);
    expect(column(board, "ready_for_agent")?.issues.map((i) => i.number)).toEqual([2]);
  });

  test("applies store overlays: a claimed ready issue moves to Executing", () => {
    const overlays = new Map<number, IssueOverlay>([[2, { claimed: true }]]);
    const board = buildBoard([issue({ number: 2, labels: [READY_FOR_AGENT_LABEL] })], overlays);
    expect(column(board, "ready_for_agent")?.issues).toHaveLength(0);
    expect(column(board, "executing")?.issues.map((i) => i.number)).toEqual([2]);
  });

  test("an overlay with an open linked PR lands the issue In PR", () => {
    const overlays = new Map<number, IssueOverlay>([
      [3, { claimed: true, linkedPullRequest: { state: "open", merged: false } }],
    ]);
    const board = buildBoard([issue({ number: 3, labels: [READY_FOR_AGENT_LABEL] })], overlays);
    expect(column(board, "in_pr")?.issues.map((i) => i.number)).toEqual([3]);
  });

  test("exposes the overlay's linked PR (number + state) on the board issue", () => {
    const overlays = new Map<number, IssueOverlay>([
      [3, { claimed: true, linkedPullRequest: { number: 57, state: "open", merged: false } }],
    ]);
    const board = buildBoard([issue({ number: 3, labels: [READY_FOR_AGENT_LABEL] })], overlays);
    const boardIssue = column(board, "in_pr")?.issues[0];
    expect(boardIssue?.linkedPullRequest).toEqual({ number: 57, state: "open", merged: false });
  });

  test("board issues without a linked PR carry linkedPullRequest: null", () => {
    const board = buildBoard([issue({ number: 1 })]);
    expect(column(board, "backlog")?.issues[0]?.linkedPullRequest).toBeNull();
  });

  test("carries the claimable flag onto each board issue", () => {
    const board = buildBoard([issue({ number: 2, labels: [READY_FOR_AGENT_LABEL] })]);
    const boardIssue = column(board, "ready_for_agent")?.issues[0];
    expect(boardIssue?.claimable).toBe(true);
    expect(boardIssue?.stage).toBe("ready_for_agent");
  });
});
