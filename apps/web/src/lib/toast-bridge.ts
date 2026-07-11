import type { ShowToastFn, ToastDismissFn, ToastOptions } from "@astryxdesign/core/Toast";

// Astryx toasts are hook-based (useToast), but a few call sites are outside the
// React tree — the global react-query error handler in utils/orpc, and imperative
// success/error feedback in event handlers. This bridge lets them dispatch through
// the one mounted viewport: a client component registers the hook's showToast via
// setToastHandler, and notify() forwards to it. The Astryx import is types-only,
// so this module stays runtime-free and safe to import from server code.
let handler: ShowToastFn | null = null;

export function setToastHandler(fn: ShowToastFn | null): void {
  handler = fn;
}

// Returns the toast's dismiss handle so callers (e.g. the connection-status reporter)
// can retract a persistent toast later. When no viewport is mounted yet, the toast is
// dropped and a no-op dismiss is returned so callers never have to null-check.
export function notify(options: ToastOptions): ToastDismissFn {
  return handler?.(options) ?? (() => {});
}
