/// <reference types="bun" />

import { describe, expect, test } from "bun:test";

import {
  classifyIssueAuthor,
  createPostCommentHandlers,
  formatIssueDate,
  issueAuthorDisplayName,
  normalizeCommentBody,
  stageDotVariant,
  stageLabel,
  stripHtmlComments,
} from "./issue-detail-view-model";
import { ISSUE_STAGE_LABELS, type IssueStage } from "@hosted-agents/api/issues/stage";

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

describe("stageLabel", () => {
  test("labels the server-derived stage (W5: Merged reads Merged, not Closed)", () => {
    // The detail renders the stage the server derived WITH the store overlay, so a
    // merged-then-closed issue reads "Merged" here — matching the board lane —
    // rather than the "Closed" a client-side state+labels derivation produced.
    expect(stageLabel("merged")).toBe("Merged");
    expect(stageLabel("closed")).toBe("Closed");
    expect(stageLabel("in_pr")).toBe(ISSUE_STAGE_LABELS.in_pr);
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
      closed: "neutral",
      failed_blocked: "warning",
    };
    for (const [stage, variant] of Object.entries(expected)) {
      expect(stageDotVariant(stage as IssueStage)).toBe(variant);
    }
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

describe("stripHtmlComments", () => {
  test("drops the Coder's leading progress marker so the body renders clean (issue #52)", () => {
    // The exact shape the Coder posts: marker as an HTML comment, blank line, body.
    const stored =
      "<!-- worker-role:implementation role:progress run:run-1 issue:3 -->\n\nOpened pull request #6 with the fix.";
    expect(stripHtmlComments(stored)).toBe("Opened pull request #6 with the fix.");
  });

  test("leaves a body with no HTML comments untouched", () => {
    expect(stripHtmlComments("Just a normal comment.")).toBe("Just a normal comment.");
  });

  test("strips a multi-line HTML comment", () => {
    expect(stripHtmlComments("before\n<!--\nhidden\nmeta\n-->\nafter")).toBe("before\n\nafter");
  });

  test("removes every HTML comment, not just the first", () => {
    expect(stripHtmlComments("<!-- a -->keep<!-- b -->")).toBe("keep");
  });

  test("collapses the blank-line run a removed comment leaves behind", () => {
    expect(stripHtmlComments("line one\n\n<!-- meta -->\n\nline two")).toBe("line one\n\nline two");
  });

  test("returns an empty string when the body is only a comment", () => {
    expect(stripHtmlComments("<!-- worker-role:implementation role:progress -->")).toBe("");
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
