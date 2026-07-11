import { describe, expect, test } from "bun:test";

import { createKickOffHandlers } from "./issue-kickoff";

describe("createKickOffHandlers", () => {
  test("onSuccess re-reads the surface, then confirms — in that order", async () => {
    const order: string[] = [];
    const toasts: { body: string; type?: "info" | "error" }[] = [];

    const handlers = createKickOffHandlers({
      refetch: async () => {
        order.push("refetch");
      },
      showToast: (toast) => {
        order.push("toast");
        toasts.push(toast);
      },
    });

    await handlers.onSuccess({ alreadyQueued: false });

    // Re-read before the toast so the row has moved to Executing when the user sees
    // the confirmation.
    expect(order).toEqual(["refetch", "toast"]);
    expect(toasts[0]?.type).toBeUndefined();
    expect(toasts[0]?.body).toContain("executing");
  });

  test("onSuccess reports an idempotent no-op distinctly from a fresh kick-off", async () => {
    const toasts: { body: string; type?: "info" | "error" }[] = [];
    const handlers = createKickOffHandlers({
      refetch: async () => {},
      showToast: (toast) => toasts.push(toast),
    });

    await handlers.onSuccess({ alreadyQueued: true });

    expect(toasts[0]?.body).toContain("already being worked on");
  });

  test("onError surfaces the error message as an error toast", async () => {
    const toasts: { body: string; type?: "info" | "error" }[] = [];
    const handlers = createKickOffHandlers({
      refetch: async () => {},
      showToast: (toast) => toasts.push(toast),
    });

    handlers.onError(new Error("GitHub installation is suspended."));

    expect(toasts[0]).toEqual({
      body: "GitHub installation is suspended.",
      type: "error",
    });
  });

  test("onError falls back to generic copy for a non-Error rejection", () => {
    const toasts: { body: string; type?: "info" | "error" }[] = [];
    const handlers = createKickOffHandlers({
      refetch: async () => {},
      showToast: (toast) => toasts.push(toast),
    });

    handlers.onError("boom");

    expect(toasts[0]).toEqual({
      body: "Couldn't kick off the agent.",
      type: "error",
    });
  });
});
