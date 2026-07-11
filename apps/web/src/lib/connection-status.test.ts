/// <reference types="bun" />

import { describe, expect, mock, test } from "bun:test";

import type { ToastDismissFn, ToastOptions } from "@astryxdesign/core/Toast";

import {
  CONNECTION_TOAST_ID,
  MAX_CONNECTIVITY_RETRIES,
  RECONNECTING_TOAST_BODY,
  connectionRetry,
  connectionRetryDelay,
  createConnectionStatusReporter,
  initialConnectionState,
  isConnectivityError,
  reconnectingToast,
  reduceConnectionError,
  reduceConnectionSuccess,
  suppressesGlobalErrorToast,
  RENDERS_ERROR_INLINE,
} from "./connection-status";

// A faithful-enough model of the Astryx toast viewport for the self-heal contract:
// every show() gets a fresh internal id, but toasts dedupe by uniqueID. The dismiss
// handle returned by show() is bound to THAT call's id — so under collisionBehavior
// "ignore", a colliding show is dropped yet still returns a dismiss for an id that was
// never added (a dead handle). This is the exact Astryx behavior behind issue #53's
// stuck indicator; a reporter that survives it must not depend on such a dead handle.
function fakeViewport() {
  let counter = 0;
  const onScreen = new Map<string, number>(); // uniqueID -> current internal id
  const show = (options: ToastOptions): ToastDismissFn => {
    const id = ++counter;
    const uid = options.uniqueID ?? `anon-${id}`;
    const existing = onScreen.get(uid);
    if (existing !== undefined && options.collisionBehavior === "ignore") {
      // Dropped — but Astryx still hands back a dismiss for this never-added id.
      return () => {
        /* dead: nothing on screen carries `id` */
      };
    }
    onScreen.set(uid, id); // add, or overwrite the existing entry in place
    return () => {
      if (onScreen.get(uid) === id) {
        onScreen.delete(uid);
      }
    };
  };
  return { show, isVisible: (uid: string) => onScreen.has(uid) };
}

// oRPC surfaces an unreachable/restarting API as an error carrying an HTTP status
// (503 Service Unavailable, 502, …). A dead server rejects fetch with a TypeError
// whose message is the only signal. A 403/404/422 is a real app error, not a blip.
function statusError(status: number, message = "Service Unavailable"): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

describe("isConnectivityError", () => {
  test("treats the 5xx restart band and rate/timeout statuses as connectivity blips", () => {
    for (const status of [500, 502, 503, 504, 408, 425, 429]) {
      expect(isConnectivityError(statusError(status))).toBe(true);
    }
  });

  test("treats status 0 (no response reached us) as a connectivity blip", () => {
    expect(isConnectivityError(statusError(0, "network request failed"))).toBe(true);
  });

  test("treats a thrown fetch rejection (TypeError) as a connectivity blip", () => {
    expect(isConnectivityError(new TypeError("Failed to fetch"))).toBe(true);
    expect(isConnectivityError(new TypeError("Load failed"))).toBe(true);
  });

  test("recognises the transient cause from the message when there is no status", () => {
    expect(isConnectivityError(new Error("Service Unavailable"))).toBe(true);
    expect(isConnectivityError(new Error("NetworkError when attempting to fetch resource"))).toBe(
      true,
    );
    expect(isConnectivityError("fetch failed")).toBe(true);
  });

  test("classifies real application errors as NOT connectivity", () => {
    expect(isConnectivityError(statusError(403, "Forbidden"))).toBe(false);
    expect(isConnectivityError(statusError(404, "Not Found"))).toBe(false);
    expect(isConnectivityError(statusError(422, "Unprocessable"))).toBe(false);
    // The board's real 403 — must stay an app error so it surfaces its own copy.
    expect(isConnectivityError(new Error("resource not accessible by integration"))).toBe(false);
    expect(isConnectivityError("some validation failed")).toBe(false);
    expect(isConnectivityError(null)).toBe(false);
  });
});

describe("suppressesGlobalErrorToast", () => {
  test("true only when the query meta opts out of the global toast", () => {
    expect(suppressesGlobalErrorToast({ [RENDERS_ERROR_INLINE]: true })).toBe(true);
    expect(suppressesGlobalErrorToast({ [RENDERS_ERROR_INLINE]: false })).toBe(false);
    expect(suppressesGlobalErrorToast({ other: true })).toBe(false);
    expect(suppressesGlobalErrorToast(undefined)).toBe(false);
  });
});

describe("connectionRetry / connectionRetryDelay", () => {
  test("retries a connectivity blip up to the bounded limit, then gives up", () => {
    const error = statusError(503);
    for (let attempt = 0; attempt < MAX_CONNECTIVITY_RETRIES; attempt++) {
      expect(connectionRetry(attempt, error)).toBe(true);
    }
    expect(connectionRetry(MAX_CONNECTIVITY_RETRIES, error)).toBe(false);
  });

  test("never retries a real application error — it should fail fast and surface", () => {
    expect(connectionRetry(0, statusError(403))).toBe(false);
  });

  test("backs off exponentially, capped", () => {
    expect(connectionRetryDelay(0)).toBe(1_000);
    expect(connectionRetryDelay(1)).toBe(2_000);
    // Capped at 4s so a long outage never schedules a multi-minute retry.
    expect(connectionRetryDelay(5)).toBe(4_000);
  });
});

describe("reduceConnectionError / reduceConnectionSuccess", () => {
  test("the first connectivity error flips to reconnecting and asks to show one indicator", () => {
    const { state, effect } = reduceConnectionError(initialConnectionState, statusError(503));
    expect(state.phase).toBe("reconnecting");
    expect(effect).toEqual({ kind: "show-reconnecting" });
  });

  test("further connectivity errors while reconnecting are absorbed (no second indicator)", () => {
    const first = reduceConnectionError(initialConnectionState, statusError(503));
    const second = reduceConnectionError(first.state, new TypeError("Failed to fetch"));
    expect(second.state.phase).toBe("reconnecting");
    expect(second.effect).toEqual({ kind: "idle" });
  });

  test("a success while reconnecting clears the indicator and returns to connected", () => {
    const down = reduceConnectionError(initialConnectionState, statusError(503));
    const up = reduceConnectionSuccess(down.state);
    expect(up.state.phase).toBe("connected");
    expect(up.effect).toEqual({ kind: "clear-reconnecting" });
  });

  test("a success during normal operation is a no-op", () => {
    const { state, effect } = reduceConnectionSuccess(initialConnectionState);
    expect(state.phase).toBe("connected");
    expect(effect).toEqual({ kind: "idle" });
  });

  test("an app error surfaces its message and never changes the connection phase", () => {
    const { state, effect } = reduceConnectionError(
      initialConnectionState,
      new Error("resource not accessible by integration"),
    );
    expect(state.phase).toBe("connected");
    expect(effect).toEqual({
      kind: "surface-error",
      message: "resource not accessible by integration",
    });
  });
});

// A spy `notify` that records every toast and hands back a dismiss spy, mirroring the
// Astryx ShowToastFn contract the real toast bridge exposes.
function fakeNotify() {
  const shown: ToastOptions[] = [];
  const dismiss = mock<ToastDismissFn>(() => {});
  const notify = (options: ToastOptions): ToastDismissFn => {
    shown.push(options);
    return dismiss;
  };
  return { notify, shown, dismiss };
}

describe("createConnectionStatusReporter (10s-outage acceptance)", () => {
  test("a burst of connectivity errors produces exactly one reconnecting indicator", () => {
    const { notify, shown } = fakeNotify();
    const reporter = createConnectionStatusReporter({ notify });

    // Board, detail, and two runs collections all fail at once, then the poll fails
    // again 5s and 10s later — the stacking scenario from the ticket.
    reporter.reportError(statusError(503));
    reporter.reportError(statusError(503));
    reporter.reportError(new TypeError("Failed to fetch"));
    reporter.reportError(statusError(502));

    expect(shown).toHaveLength(1);
    expect(shown[0]?.body).toBe(RECONNECTING_TOAST_BODY);
    expect(shown[0]?.type).toBe("info");
    expect(shown[0]?.isAutoHide).toBe(false);
    expect(shown[0]?.uniqueID).toBe(CONNECTION_TOAST_ID);
  });

  test("the board self-heals: the indicator is dismissed once the API answers again", () => {
    const { notify, dismiss } = fakeNotify();
    const reporter = createConnectionStatusReporter({ notify });

    reporter.reportError(statusError(503));
    expect(dismiss).not.toHaveBeenCalled();

    // The next successful poll after the API returns.
    reporter.reportSuccess();
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  test("re-enters reconnecting on a fresh outage after recovery (one indicator per outage)", () => {
    const { notify, shown, dismiss } = fakeNotify();
    const reporter = createConnectionStatusReporter({ notify });

    reporter.reportError(statusError(503));
    reporter.reportSuccess();
    reporter.reportError(statusError(503));

    expect(shown).toHaveLength(2);
    expect(dismiss).toHaveBeenCalledTimes(1);
  });

  test("a real app error surfaces as its own toast without touching the indicator", () => {
    const { notify, shown } = fakeNotify();
    const reporter = createConnectionStatusReporter({ notify });

    reporter.reportError(new Error("resource not accessible by integration"));

    expect(shown).toHaveLength(1);
    expect(shown[0]?.type).toBe("error");
    expect(shown[0]?.body).toBe("Error: resource not accessible by integration");
  });

  test("identical app-error messages collapse onto one toast (deduped by message)", () => {
    const { notify, shown } = fakeNotify();
    const reporter = createConnectionStatusReporter({ notify });

    reporter.reportError(new Error("Boom"));
    reporter.reportError(new Error("Boom"));

    // Both carry the same uniqueID, so the viewport's collisionBehavior collapses
    // them — the reporter itself still forwards both, but with a stable id.
    expect(shown).toHaveLength(2);
    expect(shown[0]?.uniqueID).toBe(shown[1]?.uniqueID);
    expect(shown[0]?.uniqueID).toBe("query-error:Boom");
  });

  // Regression for issue #53's stuck indicator: the reconnecting toast must use a
  // collisionBehavior that yields a LIVE dismiss handle. "ignore" would drop a
  // colliding show and hand back a dead handle (see fakeViewport), so recovery could
  // never retract the visible toast.
  test("the reconnecting toast overwrites (never ignores) so its dismiss handle stays live", () => {
    expect(reconnectingToast().collisionBehavior).toBe("overwrite");
  });

  test("recovery removes the reconnecting toast from a viewport modelled on Astryx", () => {
    const viewport = fakeViewport();
    const reporter = createConnectionStatusReporter({ notify: viewport.show });

    reporter.reportError(statusError(503));
    expect(viewport.isVisible(CONNECTION_TOAST_ID)).toBe(true);

    reporter.reportSuccess();
    // The indicator is gone — the reporter dismissed the toast actually on screen,
    // not a stale/dead handle. With the old "ignore" config a re-show would have
    // stranded it here.
    expect(viewport.isVisible(CONNECTION_TOAST_ID)).toBe(false);
  });
});
