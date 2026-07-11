// The kickOffIssue mutation's client-side round-trip, as a pure factory over plain
// callbacks — the board and the issue detail both un-gate their kick-off button
// onto it (spec #21 stories 1–2). On success it re-reads the surface so the issue
// lands in its new lane (Executing) without a manual refresh, then confirms with a
// toast whose copy depends on whether the click actually started work or was an
// idempotent no-op (the issue was already claimed). On failure it surfaces the
// error text. Extracting it lets the wiring run under `bun test` without React /
// react-query, mirroring createPostCommentHandlers.

// Minimal structural view of Astryx's showToast, so this module stays React-free.
export type ShowKickOffToast = (toast: { body: string; type?: "info" | "error" }) => unknown;

// The shape kickOffIssue returns that the client cares about.
export type KickOffResult = { alreadyQueued: boolean };

export type KickOffHandlers = {
  onSuccess: (result: KickOffResult) => Promise<void>;
  onError: (error: unknown) => void;
};

export function createKickOffHandlers(deps: {
  refetch: () => Promise<unknown>;
  showToast: ShowKickOffToast;
}): KickOffHandlers {
  return {
    onSuccess: async (result) => {
      // Re-read first so the row has moved to Executing before we confirm it.
      await deps.refetch();
      deps.showToast({
        body: result.alreadyQueued
          ? "This issue is already being worked on by the Coder."
          : "Kicked off the Coder — the issue is now executing.",
      });
    },
    onError: (error) => {
      deps.showToast({
        body: error instanceof Error ? error.message : "Couldn't kick off the agent.",
        type: "error",
      });
    },
  };
}
