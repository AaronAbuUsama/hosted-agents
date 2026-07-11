// Poll cadence for the agent-run collections (runs list, run events, run artifacts).
// Split out from lib/collections/agent-runs so the interval policy is unit-testable
// without pulling in the oRPC client and its env.

export const RUN_COLLECTION_REFETCH_INTERVAL_MS = 5_000;

// While a poll is erroring (the API is briefly unreachable), keep polling at a
// slower cadence rather than stopping. Returning `false` here freezes the surface
// until a manual reload — the "doesn't self-heal on API return" half of issue #53:
// the single reconnecting indicator only clears when SOME query succeeds again
// (queryCache.onSuccess → connection.reportSuccess), so a run collection that stops
// polling on error never fires that success and the indicator sticks forever. A
// slower interval lets the very next successful poll after the API returns clear it
// and resume the normal cadence on its own. Mirrors issuesRevisionPollInterval,
// which already does this for the board.
export const RUN_COLLECTION_ERROR_REFETCH_INTERVAL_MS = 10_000;

// Typed structurally like the issues-revision helper so any TanStack Query satisfies
// it. Never returns `false` — an errored collection must keep polling so it can heal.
export function refetchRunCollectionInterval(query: { state: { error: unknown } }): number {
  return query.state.error
    ? RUN_COLLECTION_ERROR_REFETCH_INTERVAL_MS
    : RUN_COLLECTION_REFETCH_INTERVAL_MS;
}
