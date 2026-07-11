// The issues board and the issue detail both refresh themselves off a store-only
// change-watermark (`repositoryIssuesRevision`) rather than polling GitHub: the
// watermark query polls our own store on an interval, and the GitHub-backed board
// / detail read is keyed on the returned revision so it refetches only when the
// watermark actually flips (issue #26; issue #19 stories 21–22). This module holds
// the shared poll cadence + interval policy so both surfaces stay in lockstep.

// Match the runs collection's 5s cadence (see lib/collections/agent-runs.ts). A
// webhook-synced change lands in the store almost immediately, so a 5s poll keeps
// the board comfortably inside the ticket's ~10s "appears without a refresh" bar.
export const ISSUES_REVISION_POLL_INTERVAL_MS = 5_000;

// Stop polling after an error instead of retry-looping, mirroring the runs
// collection's `refetchRunCollectionInterval`. The board / detail keep their last
// good view (the query cache's onError already surfaces the failure as a toast).
// Typed structurally like the runs helper so any TanStack Query satisfies it.
export function issuesRevisionPollInterval(query: { state: { error: unknown } }): number | false {
  return query.state.error ? false : ISSUES_REVISION_POLL_INTERVAL_MS;
}
