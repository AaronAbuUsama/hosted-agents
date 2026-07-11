/// <reference types="bun" />

import { describe, expect, test } from "bun:test";

import {
  classifyIssueAuthor,
  createPostCommentHandlers,
  formatIssueDate,
  issueAuthorDisplayName,
  issueStage,
  issueStageDotVariant,
  issueStageLabel,
  normalizeCommentBody,
  stageDotVariant,
  type StageDerivable,
} from "./issue-detail-view-model";
import type { IssueStage } from "@hosted-agents/api/issues/stage";

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

describe("stageDotVariant", () => {
  test("maps every stage to the StatusDot variant the detail renders", () => {
    const expected: Record<IssueStage, ReturnType<typeof stageDotVariant>> = {
      backlog: "neutral",
      ready_for_agent: "accent",
      executing: "warning",
      in_pr: "accent",
      merged: "success",
      failed_blocked: "warning",
    };
    for (const [stage, variant] of Object.entries(expected)) {
      expect(stageDotVariant(stage as IssueStage)).toBe(variant);
    }
  });

  test("derives the dot variant straight from an issue's stage", () => {
    expect(issueStageDotVariant({ state: "open", labels: [] })).toBe("neutral");
    expect(issueStageDotVariant({ state: "open", labels: ["ready for agent"] })).toBe("accent");
  });
});

describe("normalizeCommentBody", () => {
  test("trims the draft before it is posted", () => {
    expect(normalizeCommentBody("  ship it  ")).toBe("ship it");
  });

  test("returns null for an empty or all-whitespace draft so nothing is posted", () => {
    expect(normalizeCommentBody("")).toBeNull();
    expect(normalizeCommentBody("   \n\t ")).toBeNull();
  });
});

describe("createPostCommentHandlers", () => {
  test("onSuccess clears the draft, re-reads the thread, then confirms — in that order", async () => {
    const order: string[] = [];
    let draft = "typed comment";
    let refetches = 0;
    const toasts: { body: string; type?: string }[] = [];

    const handlers = createPostCommentHandlers({
      setDraft: (value) => {
        draft = value;
        order.push("setDraft");
      },
      refetch: async () => {
        refetches += 1;
        order.push("refetch");
      },
      showToast: (toast) => {
        toasts.push(toast);
        order.push("toast");
      },
    });

    await handlers.onSuccess();

    expect(draft).toBe("");
    expect(refetches).toBe(1);
    expect(toasts).toEqual([{ body: "Comment posted to GitHub." }]);
    // The draft is cleared and the thread re-read before the confirmation toast, so
    // the confirmed comment is already in order by the time the user sees success.
    expect(order).toEqual(["setDraft", "refetch", "toast"]);
  });

  test("onError surfaces an Error's message as an error toast", () => {
    const toasts: { body: string; type?: string }[] = [];
    const handlers = createPostCommentHandlers({
      setDraft: () => {},
      refetch: async () => {},
      showToast: (toast) => toasts.push(toast),
    });

    handlers.onError(new Error("GitHub rejected the comment"));

    expect(toasts).toEqual([{ body: "GitHub rejected the comment", type: "error" }]);
  });

  test("onError falls back to a generic message for a non-Error rejection", () => {
    const toasts: { body: string; type?: string }[] = [];
    const handlers = createPostCommentHandlers({
      setDraft: () => {},
      refetch: async () => {},
      showToast: (toast) => toasts.push(toast),
    });

    handlers.onError("nope");

    expect(toasts).toEqual([{ body: "Couldn't post the comment.", type: "error" }]);
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
