/// <reference types="bun" />

import { describe, expect, test } from "bun:test";

import {
  classifyIssueAuthor,
  formatIssueDate,
  issueAuthorDisplayName,
  issueClaimable,
  issueStage,
  issueStageLabel,
  type StageDerivable,
} from "./issue-detail-view-model";

describe("classifyIssueAuthor", () => {
  test("treats a GitHub App's [bot] login as an agent", () => {
    expect(classifyIssueAuthor("coder-app[bot]")).toBe("agent");
    expect(classifyIssueAuthor("code-review[bot]")).toBe("agent");
  });

  test("is tolerant of casing on the suffix", () => {
    expect(classifyIssueAuthor("Coder-App[Bot]")).toBe("agent");
  });

  test("treats a plain human login as a member", () => {
    expect(classifyIssueAuthor("octocat")).toBe("member");
  });

  test("does not misread a member whose name merely contains 'bot'", () => {
    expect(classifyIssueAuthor("robot")).toBe("member");
    expect(classifyIssueAuthor("bot-wrangler")).toBe("member");
  });

  test("falls back to member when the login is missing", () => {
    expect(classifyIssueAuthor(null)).toBe("member");
    expect(classifyIssueAuthor(undefined)).toBe("member");
    expect(classifyIssueAuthor("")).toBe("member");
  });
});

describe("issueAuthorDisplayName", () => {
  test("drops the [bot] suffix so an agent reads as its app name", () => {
    expect(issueAuthorDisplayName("coder-app[bot]")).toBe("coder-app");
  });

  test("returns a plain login unchanged", () => {
    expect(issueAuthorDisplayName("octocat")).toBe("octocat");
  });

  test("returns Unknown for a missing login", () => {
    expect(issueAuthorDisplayName(null)).toBe("Unknown");
    expect(issueAuthorDisplayName("   ")).toBe("Unknown");
  });
});

describe("issueStage / issueStageLabel", () => {
  const openBacklog: StageDerivable = { state: "open", labels: [] };
  const readyForAgent: StageDerivable = { state: "open", labels: ["ready for agent"] };

  test("an open, unlabeled issue is backlog", () => {
    expect(issueStage(openBacklog)).toBe("backlog");
    expect(issueStageLabel(openBacklog)).toBe("Backlog");
  });

  test("the gating label moves the issue to ready_for_agent", () => {
    expect(issueStage(readyForAgent)).toBe("ready_for_agent");
    expect(issueStageLabel(readyForAgent)).toBe("Ready for agent");
  });

  test("matches the gating label tolerant of separators", () => {
    expect(issueStage({ state: "open", labels: ["ready-for-agent"] })).toBe("ready_for_agent");
  });
});

describe("issueClaimable", () => {
  test("a ready-for-agent issue is claimable", () => {
    expect(issueClaimable({ state: "open", labels: ["ready for agent"] })).toBe(true);
  });

  test("a plain backlog issue is not claimable", () => {
    expect(issueClaimable({ state: "open", labels: [] })).toBe(false);
  });

  test("human-in-the-loop gates the agent out even with the ready label", () => {
    expect(
      issueClaimable({ state: "open", labels: ["ready for agent", "human in the loop"] }),
    ).toBe(false);
  });
});

describe("formatIssueDate", () => {
  test("formats an ISO timestamp to a stable, locale-fixed date", () => {
    expect(formatIssueDate("2026-07-08T13:45:00Z")).toBe("Jul 8, 2026");
  });

  test("renders an em dash for null / undefined", () => {
    expect(formatIssueDate(null)).toBe("—");
    expect(formatIssueDate(undefined)).toBe("—");
  });

  test("renders an em dash for an unparseable value rather than 'Invalid Date'", () => {
    expect(formatIssueDate("not-a-date")).toBe("—");
  });
});
