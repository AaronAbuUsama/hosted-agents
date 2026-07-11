import { describe, expect, test } from "bun:test";

import {
  BABYSIT_ROUND_CAP,
  BABYSIT_STOP_HUMAN,
  BABYSIT_STOP_ROUND_CAP,
  decideBabysitReview,
  type BabysitReviewInput,
} from "./babysit";

function review(overrides: Partial<BabysitReviewInput> = {}): BabysitReviewInput {
  return {
    reviewState: "changes_requested",
    senderIsHuman: false,
    babysitRound: 0,
    alreadyStopped: false,
    ...overrides,
  };
}

describe("decideBabysitReview", () => {
  test("a bot changes_requested below the cap enqueues the next round", () => {
    expect(decideBabysitReview(review({ babysitRound: 0 }))).toEqual({
      action: "babysit",
      round: 1,
    });
    // Seeded at round 1 (one fix already done), the next review is round 2.
    expect(decideBabysitReview(review({ babysitRound: 1 }))).toEqual({
      action: "babysit",
      round: 2,
    });
    // The last allowed round: round 2 → 3 is still under the cap (< 3 is checked
    // before enqueue, and 2 < 3).
    expect(decideBabysitReview(review({ babysitRound: 2 }))).toEqual({
      action: "babysit",
      round: 3,
    });
  });

  test("a bot changes_requested at the cap blocks instead of enqueuing", () => {
    expect(decideBabysitReview(review({ babysitRound: BABYSIT_ROUND_CAP }))).toEqual({
      action: "blocked",
      reason: BABYSIT_STOP_ROUND_CAP,
    });
    // And anything beyond the cap stays blocked.
    expect(decideBabysitReview(review({ babysitRound: BABYSIT_ROUND_CAP + 1 }))).toEqual({
      action: "blocked",
      reason: BABYSIT_STOP_ROUND_CAP,
    });
  });

  test("a human review yields regardless of state or round — humans always win", () => {
    expect(
      decideBabysitReview(review({ senderIsHuman: true, reviewState: "changes_requested" })),
    ).toEqual({ action: "yield", reason: BABYSIT_STOP_HUMAN });
    expect(decideBabysitReview(review({ senderIsHuman: true, reviewState: "commented" }))).toEqual({
      action: "yield",
      reason: BABYSIT_STOP_HUMAN,
    });
    // Even with rounds still available, a human ends babysitting.
    expect(decideBabysitReview(review({ senderIsHuman: true, babysitRound: 0 }))).toEqual({
      action: "yield",
      reason: BABYSIT_STOP_HUMAN,
    });
  });

  test("an approved review is a no-op here (C7 owns the approval path)", () => {
    expect(decideBabysitReview(review({ reviewState: "approved" }))).toEqual({
      action: "noop",
      reason: "approved_review",
    });
    // A human approval is still C7's, not a yield.
    expect(decideBabysitReview(review({ reviewState: "approved", senderIsHuman: true }))).toEqual({
      action: "noop",
      reason: "approved_review",
    });
    // An approval after the cap is still handed to C7, not swallowed by the stop.
    expect(
      decideBabysitReview(
        review({ reviewState: "approved", alreadyStopped: true, babysitRound: BABYSIT_ROUND_CAP }),
      ),
    ).toEqual({ action: "noop", reason: "approved_review" });
  });

  test("an already-stopped PR never resumes (no run, no double-block)", () => {
    expect(
      decideBabysitReview(review({ alreadyStopped: true, reviewState: "changes_requested" })),
    ).toEqual({ action: "noop", reason: "babysit_already_stopped" });
    expect(decideBabysitReview(review({ alreadyStopped: true, senderIsHuman: true }))).toEqual({
      action: "noop",
      reason: "babysit_already_stopped",
    });
  });

  test("a non-actionable bot review state (commented / dismissed) does nothing", () => {
    expect(decideBabysitReview(review({ reviewState: "commented" }))).toEqual({
      action: "noop",
      reason: "review_state_not_actionable",
    });
    expect(decideBabysitReview(review({ reviewState: "dismissed" }))).toEqual({
      action: "noop",
      reason: "review_state_not_actionable",
    });
  });

  test("the cap is configurable for the decision", () => {
    expect(decideBabysitReview(review({ babysitRound: 1, cap: 1 }))).toEqual({
      action: "blocked",
      reason: BABYSIT_STOP_ROUND_CAP,
    });
    expect(decideBabysitReview(review({ babysitRound: 0, cap: 1 }))).toEqual({
      action: "babysit",
      round: 1,
    });
  });
});
