// Single source of truth for the Codex model + reasoning-effort policy used by
// every worker agent run (Reviewer today, Coder next). Both the API package and
// apps/server import from here so the default lives in exactly one place.
//
// MODEL SLUG — the milestone charter asked for `gpt-5.6-lunar`. Verified live
// against the ChatGPT-account Codex backend on 2026-07-10: `gpt-5.6-lunar` (and
// every other 5.6-family / *-codex slug probed) is rejected with
//   400 { "detail": "The 'gpt-5.6-lunar' model is not supported when using
//   Codex with a ChatGPT account." }
// The models this account DOES accept are gpt-5.5, gpt-5.4, gpt-5.4-mini, and
// gpt-5.3-codex-spark. The closest supported slug to the requested 5.6 is the
// flagship `gpt-5.5`, so the default is pinned there and the requested slug is
// recorded below. Flip DEFAULT_CODEX_MODEL_ID to REQUESTED_CODEX_MODEL_ID once
// the backend accepts it — no other change is needed.
export const REQUESTED_CODEX_MODEL_ID = "gpt-5.6-lunar";
export const DEFAULT_CODEX_MODEL_ID = "gpt-5.5";

// Model specifier form (`<provider>/<model>`) consumed by the Flue runtime.
export const OPENAI_CODEX_PROVIDER = "openai-codex";
export const DEFAULT_CODEX_MODEL = `${OPENAI_CODEX_PROVIDER}/${DEFAULT_CODEX_MODEL_ID}`;

// Reasoning-effort tiers accepted by a Codex worker run. Mirrors Flue's
// ThinkingLevel enum minus "off": a coder/reviewer always reasons, and "off"
// would silently disable it. "minimal" is the lowest tier; for the Codex
// models this account exposes it maps to wire effort "low" (they have no true
// minimal tier), which is the cheapest reasoning setting available.
export const REASONING_EFFORTS = ["minimal", "low", "medium", "high", "xhigh"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

// "Lowest reasoning effort" per the milestone charter.
export const DEFAULT_CODEX_REASONING_EFFORT: ReasoningEffort = "minimal";

export function isReasoningEffort(value: string): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(value);
}

// Resolve a configured effort string (worker-config override) to a valid tier,
// falling back to the default when unset or unrecognized.
export function resolveReasoningEffort(configured?: string | null): ReasoningEffort {
  const trimmed = configured?.trim();
  return trimmed && isReasoningEffort(trimmed) ? trimmed : DEFAULT_CODEX_REASONING_EFFORT;
}
