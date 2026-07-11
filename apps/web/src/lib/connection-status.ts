// When the API restarts or drops for a moment, every in-flight query error used to
// surface its own red toast through the global queryCache.onError — the board, the
// detail read, and each runs collection all fail at once and their toasts stack
// ("Error: Service Unavailable" ×N), then restack on the next poll (issue #53).
//
// This module is the pure brain behind a single, calm "reconnecting" affordance:
//   1. classify a query error as a transient connectivity blip vs. a real app error,
//   2. reduce a stream of error/success events into one status effect at a time, and
//   3. expose the retry/backoff policy that lets a quick blip heal before it ever
//      surfaces.
// The stateful glue (holding the toast dismiss handle, forwarding to the toast
// bridge) lives in utils/orpc; everything here is side-effect-free so the board's
// self-heal behaviour is unit-testable without a DOM or a live server.

import type { ToastDismissFn, ToastOptions } from "@astryxdesign/core/Toast";

// Stable id so repeated connectivity errors collapse onto one toast in the viewport
// even if two land in the same tick — the reducer already guards this, but the id is
// the belt to the reducer's suspenders (and satisfies the ticket's "dedupe" ask).
export const CONNECTION_TOAST_ID = "connection-status";

// A single, unobtrusive indicator — info-styled, not the alarming red the ticket
// complains about — that persists until connectivity returns.
export const RECONNECTING_TOAST_BODY = "Reconnecting…";

// Retry a connectivity blip a bounded number of times before it is allowed to
// surface, so an API restart that returns within a second or two never toasts at all.
export const MAX_CONNECTIVITY_RETRIES = 2;
const RETRY_BASE_DELAY_MS = 1_000;
const RETRY_MAX_DELAY_MS = 4_000;

// HTTP statuses that mean "try again shortly", not "this request was wrong": request
// timeout, too-early, rate-limit, and the 5xx band an API sheds while it restarts.
const TRANSIENT_STATUSES: ReadonlySet<number> = new Set([408, 425, 429, 500, 502, 503, 504]);

// A thrown fetch rejection carries no status; its cause only shows up in the text.
// Match the phrasings the major browsers and oRPC use for an unreachable server.
const NETWORK_MESSAGE_PATTERN =
  /failed to fetch|load failed|network ?error|fetch failed|networkerror|connection (refused|reset|closed|timed out)|econnrefused|the internet connection appears to be offline|service unavailable|bad gateway|gateway timeout/i;

function readStatus(error: unknown): number | undefined {
  if (typeof error === "object" && error !== null && "status" in error) {
    const status = (error as { status: unknown }).status;
    if (typeof status === "number" && Number.isFinite(status)) {
      return status;
    }
  }
  return undefined;
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return "";
}

// True when an error looks like the server being briefly unreachable rather than a
// request the caller got wrong. A 403/404/422 (or any oRPC "defined" error) is a real
// failure and stays classified as an app error so it still surfaces on its own.
export function isConnectivityError(error: unknown): boolean {
  const status = readStatus(error);
  if (status !== undefined) {
    // status 0 is the classic "no response reached us" sentinel.
    return status === 0 || TRANSIENT_STATUSES.has(status);
  }
  // No usable status: a raw fetch rejection (browsers throw TypeError) or an Error
  // whose message is the only place the transient cause is recorded.
  return error instanceof TypeError || NETWORK_MESSAGE_PATTERN.test(errorMessage(error));
}

// ---- retry / backoff policy (consumed by the QueryClient defaults) -------------

// Only connectivity blips are worth retrying; a 403 should fail fast and surface its
// real message immediately instead of stalling behind backoff.
export function connectionRetry(failureCount: number, error: unknown): boolean {
  return isConnectivityError(error) && failureCount < MAX_CONNECTIVITY_RETRIES;
}

// Capped exponential backoff: 1s, 2s, … up to 4s.
export function connectionRetryDelay(failureCount: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** failureCount, RETRY_MAX_DELAY_MS);
}

// ---- the reducer: events in, one status effect out -----------------------------

export type ConnectionPhase = "connected" | "reconnecting";

export type ConnectionState = {
  phase: ConnectionPhase;
};

export type ConnectionEffect =
  // Nothing to do — the viewport already reflects reality.
  | { kind: "idle" }
  // Show the one persistent "reconnecting" indicator.
  | { kind: "show-reconnecting" }
  // Connectivity is back; dismiss the indicator so the board reads as healthy again.
  | { kind: "clear-reconnecting" }
  // A genuine application error the user should see, deduped by its message.
  | { kind: "surface-error"; message: string };

export const initialConnectionState: ConnectionState = { phase: "connected" };

// Fold a query error into the connection state. Connectivity errors flip us into
// "reconnecting" exactly once — subsequent blips while already reconnecting are
// absorbed, which is what keeps a 10s outage to a single indicator. App errors never
// change the phase; they just surface.
export function reduceConnectionError(
  state: ConnectionState,
  error: unknown,
): { state: ConnectionState; effect: ConnectionEffect } {
  if (!isConnectivityError(error)) {
    return { state, effect: { kind: "surface-error", message: errorMessage(error) } };
  }
  if (state.phase === "reconnecting") {
    return { state, effect: { kind: "idle" } };
  }
  return { state: { phase: "reconnecting" }, effect: { kind: "show-reconnecting" } };
}

// Any successful query while we were reconnecting means the server is back: clear the
// indicator and return to "connected". Successes during normal operation are no-ops.
export function reduceConnectionSuccess(state: ConnectionState): {
  state: ConnectionState;
  effect: ConnectionEffect;
} {
  if (state.phase === "reconnecting") {
    return { state: { phase: "connected" }, effect: { kind: "clear-reconnecting" } };
  }
  return { state, effect: { kind: "idle" } };
}

// ---- toast option builders (pure; the reporter decides when to fire them) -------

export function reconnectingToast(): ToastOptions {
  return {
    body: RECONNECTING_TOAST_BODY,
    type: "info",
    // Persist until we explicitly dismiss it on recovery.
    isAutoHide: false,
    uniqueID: CONNECTION_TOAST_ID,
    // Keep the indicator already on screen rather than replacing (and re-animating)
    // it every time another query fails.
    collisionBehavior: "ignore",
  };
}

export function appErrorToast(message: string): ToastOptions {
  return {
    body: `Error: ${message}`,
    type: "error",
    // Identical error messages collapse onto one toast instead of stacking.
    uniqueID: `query-error:${message}`,
    collisionBehavior: "ignore",
  };
}

// ---- stateful reporter: holds the phase + the live dismiss handle ---------------

export type ConnectionStatusReporter = {
  reportError(error: unknown): void;
  reportSuccess(): void;
};

// Wire the reducer to the toast bridge. `notify` returns a dismiss handle (a no-op
// when no viewport is mounted), which we keep so recovery can retract the single
// "reconnecting" toast. Injected rather than imported so tests drive it with a spy.
export function createConnectionStatusReporter(deps: {
  notify: (options: ToastOptions) => ToastDismissFn;
}): ConnectionStatusReporter {
  let state = initialConnectionState;
  let dismissReconnecting: ToastDismissFn | null = null;

  function apply(effect: ConnectionEffect): void {
    switch (effect.kind) {
      case "show-reconnecting":
        dismissReconnecting = deps.notify(reconnectingToast());
        return;
      case "clear-reconnecting":
        dismissReconnecting?.();
        dismissReconnecting = null;
        return;
      case "surface-error":
        deps.notify(appErrorToast(effect.message));
        return;
      case "idle":
        return;
    }
  }

  return {
    reportError(error: unknown): void {
      const next = reduceConnectionError(state, error);
      state = next.state;
      apply(next.effect);
    },
    reportSuccess(): void {
      const next = reduceConnectionSuccess(state);
      state = next.state;
      apply(next.effect);
    },
  };
}
