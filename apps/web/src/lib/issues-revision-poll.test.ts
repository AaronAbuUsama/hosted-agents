/// <reference types="bun" />

import { describe, expect, test } from "bun:test";

import {
  ISSUES_REVISION_ERROR_POLL_INTERVAL_MS,
  ISSUES_REVISION_POLL_INTERVAL_MS,
  issuesRevisionPollInterval,
} from "./issues-revision-poll";

// The refetchInterval callback only ever reads query.state.error, so a minimal stub
// stands in for a real TanStack Query.
function query(error: unknown) {
  return { state: { error } };
}

describe("issuesRevisionPollInterval", () => {
  test("polls at the normal cadence while healthy", () => {
    expect(issuesRevisionPollInterval(query(null))).toBe(ISSUES_REVISION_POLL_INTERVAL_MS);
  });

  test("keeps polling (backoff cadence) after an error instead of freezing — the board self-heals", () => {
    // Returning `false` here would stop the timer, freezing the board until a manual
    // reload (issue #53). A number keeps it alive so the next successful poll resumes.
    const interval = issuesRevisionPollInterval(query(new Error("Service Unavailable")));
    expect(interval).toBe(ISSUES_REVISION_ERROR_POLL_INTERVAL_MS);
    expect(interval).not.toBe(false);
  });

  test("backs off (polls less often) while erroring than when healthy", () => {
    expect(ISSUES_REVISION_ERROR_POLL_INTERVAL_MS).toBeGreaterThan(
      ISSUES_REVISION_POLL_INTERVAL_MS,
    );
  });
});
