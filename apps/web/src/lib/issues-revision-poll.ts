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

// While the poll is erroring (the API is briefly unreachable), keep polling at a
// slower backoff cadence rather than stopping. Returning `false` here would freeze
// the board until a manual reload — the exact "doesn't self-heal on API return" bug
// in issue #53. A slower interval lets the very next successful poll clear the error
// and resume the normal cadence on its own. This no longer spams: connectivity
// errors are deduped into one indicator and bounded-retried upstream (utils/orpc).
export const ISSUES_REVISION_ERROR_POLL_INTERVAL_MS = 10_000;

// Typed structurally like the runs helper so any TanStack Query satisfies it.
export function issuesRevisionPollInterval(query: { state: { error: unknown } }): number | false {
  return query.state.error
    ? ISSUES_REVISION_ERROR_POLL_INTERVAL_MS
    : ISSUES_REVISION_POLL_INTERVAL_MS;
}
