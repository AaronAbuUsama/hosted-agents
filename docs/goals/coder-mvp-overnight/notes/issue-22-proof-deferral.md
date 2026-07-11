# Issue #22 — live-proof deferral into C8/P5

**Issue:** #22 "P1: Issue detail + comments view" · **PR:** #38 · **Branch:**
`coder-mvp/22-issue-detail`

> **STATUS — DO NOT SELF-MERGE.** This is a *proposed* deferral, not an accepted
> one. Orchestrator (Fable) acceptance is **PENDING**; no agent on this branch can
> grant it — recording a deferral does not accept it. PR #38's self-merge stays
> blocked until **either** the orchestrator explicitly accepts this deferral into
> C8/P5 **or** the live proof below is captured. The compensating verification on
> this branch (now including executed runtime-contract tests, below) narrows the
> gap but does **not** discharge the gate.

## Fix-agent re-verification pass (2026-07-11, HEAD `4de37aa`)

A fix agent re-ran the branch's verification and established, empirically, that
**neither** of the finding's two resolution paths is dischargeable from a fix
worktree — so this note's gate stands and the decision belongs to the
orchestrator. Findings of the pass:

1. **The live proof cannot be captured from a fix worktree — proven, not
   asserted.** With the stack running live (API `:3000` → `OK`, web `:3005` →
   Coworker), an unauthenticated GET of the board/detail surface
   (`/app/projects/50ebd641-694f-4beb-911e-cf9c50c76031`) returns **HTTP 307 →
   `/login`**. The detail route is auth-gated; the *read* half of the proof
   therefore requires Aaron's authenticated session, which exists only in his
   own browser — a fix agent cannot log in (no password/OAuth entry). The
   *write* half (post a comment on `AaronAbuUsama/test-repo`) is a live external
   GitHub side-effect the charter routes to C8 and the note below deliberately
   does not perform unilaterally. Both halves are out of a fix worktree's reach;
   this is exactly why the proof lives in C8/P5.

2. **Orchestrator acceptance remains the only in-scope unblock.** Accepting the
   deferral is a Fable-only decision (per the STATUS block); a fix agent cannot
   self-grant it. This note is left as the decision surface, not the decision.

3. **Code-level evidence re-confirmed green at this HEAD.**
   - `apps/web` `tsc --noEmit` exits **0**.
   - `bun test apps/web/src/lib/issue-detail-view-model.test.ts` → **24 pass /
     0 fail**.
   - The 17 failures seen in a whole-repo `bun test` are **pre-existing and
     unrelated to #22**: the same 17 fail on the branch base `c7942e3` (full
     suite: 58 pass / 17 fail) *before any #22 commit exists*. They are a
     `packages/api` cross-file test-isolation issue (the hermetic
     `DATABASE_URL` / db singleton leaks between files in a combined run, so the
     router queries a DB without the migrated schema → `no such table: member`);
     the same API file passes **19/19 in isolation**. This branch's diff touches
     **zero** files under `packages/api|db|env` (only `apps/web/**` + this note),
     so it neither caused nor can responsibly fix those failures here. #22 adds
     24 passing tests and **no new failures**.

4. **Stale-lockfile hygiene fix (incidental, committed).** The committed
   `bun.lock` still referenced `sonner` and `@hosted-agents/ui` for `apps/web`,
   but the committed `apps/web/package.json` lists neither (sonner is
   charter-banned; the view is Astryx/toast-native). `bun install` reconciled
   the lockfile; a CI `--frozen-lockfile` install would otherwise fail. This is
   the only code-adjacent change in the fix pass.

**Net:** the fix pass reinforces the gate rather than discharging it. No
self-merge, no self-accept, no unilateral live write was performed. The two
unresolved items are handed to the orchestrator exactly as framed below.

## The finding

Review flagged that the charter's per-issue **step 5** (`docs/goals/coder-mvp-overnight/goal-prompt.md:42`)
— *"Live e2e proof where the issue demands it — on `AaronAbuUsama/test-repo`
ONLY. Browser-drive the affected surface, screenshot before/after."* — was not
satisfied for this issue. The new detail UI had never been rendered in a
browser, and the reviewer's point stands that typecheck + the pure view-model
tests (`apps/web/src/lib/issue-detail-view-model.test.ts`) cannot by themselves
catch runtime / layout / query-wiring regressions.

Per the finding, self-merge of PR #38 is gated until **either** the live proof
is captured **or** the orchestrator explicitly accepts deferral of that proof
into **C8** (full-loop e2e proof + runbook) and **P5** (live board refresh),
recorded in a tracking note. This is that note.

## Why the live proof is deferred rather than captured here

Capturing the charter-grade proof requires the whole stack standing live with
an authenticated session and the Coder GitHub App credentials, plus a **comment
write against `AaronAbuUsama/test-repo`** — exactly the surface C8 exists to
drive end to end. Per the charter's hard guardrails, live Coder writes happen on
test-repo only and belong to the full-loop proof; folding this issue's isolated
screenshot into C8/P5 avoids a second, redundant live-write setup and keeps all
live evidence in one runbook.

This is well-founded because **Done criterion #2**
(`docs/goals/coder-mvp-overnight/goal-prompt.md`) already requires C8's runbook
to drive **≥2 issues through the entire live loop with screenshots of every lane
transition**. Opening an issue's detail + comments view is on that path — the
detail route *is* the surface a reviewer lands on per lane — so the live render
+ comment write for this UI is captured as a byproduct of C8, not skipped.

## Compensating verification done on this branch (not a substitute for step 5)

Run in this worktree at HEAD of `coder-mvp/22-issue-detail`:

1. **Web typecheck clean** — `apps/web` `tsc --noEmit` exits 0. The view derives
   its data types straight from the router client
   (`apps/web/src/components/coworker/issue-detail.tsx:61`
   `type RepositoryIssue = Awaited<ReturnType<typeof client.getRepositoryIssue>>`),
   so every field the view reads is compiler-checked against the API output.
   Query/mutation inputs match the procedure schemas (`issueScopedInput` /
   `postIssueCommentInput`, `packages/api/src/routers/index.ts:594-600`), and the
   API returns exactly the fields consumed — `getGitHubIssue` /
   `listGitHubIssueComments` map `number/state/labels/createdAt/updatedAt/`
   `commentCount/authorLogin/authorAvatarUrl/htmlUrl/title/body` and
   comment `githubId/authorLogin/authorAvatarUrl/createdAt/body`
   (`packages/api/src/github-app.ts:323-407`). This closes the "query-wiring"
   half of the concern statically.

2. **Production build clean** — `next build` (React Compiler + typedRoutes on)
   exits 0 with *"Compiled successfully"*, and the route
   `/app/projects/[projectId]/issues/[issueId]` compiles and bundles as a
   dynamic route. This exercises the full module graph: the server page
   (`.../issues/[issueId]/page.tsx`), the `ssr:false` dynamic client boundary
   (`issue-detail-client.tsx`), the `IssueDetail` client component and every
   Astryx import it pulls in. It rebuts "the code can't wire up / build," though
   it does **not** prove live-data layout.

3. **Pure view-model + runtime-contract tests green** — 24/24 in
   `apps/web/src/lib/issue-detail-view-model.test.ts`. Beyond the original author
   classification / stage / date helpers, this now executes the parts of the
   view's runtime behaviour that were previously inline-and-untested in the
   component, in direct response to the reviewer's "query-wiring" concern:
   - `createPostCommentHandlers` — the **client half of the `postIssueComment`
     round-trip**. The success path is asserted to clear the draft, re-read the
     thread, then confirm with a toast **in that order** (so the confirmed comment
     is already in place when the user sees success); the error path is asserted to
     surface an `Error`'s message, and to fall back to a generic message for a
     non-`Error` rejection. The component now wires the mutation through this
     factory (`issue-detail.tsx`), so the tested handlers are the ones that run.
   - `normalizeCommentBody` — the composer's trim/empty guard: an all-whitespace
     draft yields `null` and is never sent to GitHub; a padded draft is trimmed
     before posting. It backs both the Post button's enabled state and the submit
     guard, so both share one tested source of truth.
   - `stageDotVariant` / `issueStageDotVariant` — the stage → StatusDot-colour map
     the header and metadata render, extracted from the component and asserted
     exhaustively over every `IssueStage` (a wrong lane colour is now a caught
     regression, not a live-only one).

What remains genuinely unproven until C8/P5 is now narrower: **pixel layout** with
live GitHub data, the two-column ↔ stacked responsive switch
(`useMediaQuery("(max-width:1040px)")`), the agent-comment accent treatment
against real bot vs. member logins, and the **server half** of the comment write —
the actual `postIssueComment` → `createGitHubIssueComment` call reaching GitHub and
the posted comment landing in-thread on refetch. The client-side round-trip
contract itself is no longer unexercised; it runs under `bun test`.

## Acceptance criteria to close this deferral (capture in C8, log in P5)

When C8 drives the live loop on `AaronAbuUsama/test-repo`, capture into
`docs/runbooks/coder-mvp-e2e.md` (the C8 runbook):

- [ ] **Read:** open a real `hosted-agents` issue detail from the board
  (read-only surface) and screenshot the rendered header, description, metadata
  panel, and comment thread — confirming stage dot/label, labels, author
  identity, and dates render.
- [ ] **Responsive:** one screenshot ≤1040px wide showing the metadata panel
  collapsed into the stacked in-content block.
- [ ] **Agent vs. member:** a thread containing at least one `[bot]` author,
  screenshotted, confirming the accent bar + "Agent" badge vs. "Member".
- [ ] **Write:** post a comment on a `test-repo` issue through the composer,
  screenshot the success toast and the comment landing in-thread after refetch
  (`onSuccess` → `issueQuery.refetch()`), confirming it posts as the app
  identity.

## Merge gate

Per the finding, **do not self-merge PR #38 on the strength of this note alone.**
Merge is unblocked only when the orchestrator (Fable) explicitly accepts this
deferral into C8/P5. If the orchestrator instead wants the proof up front, the
acceptance criteria above are the exact shots to capture before merge.

**Acceptance is PENDING and cannot be self-granted on this branch.** A fix agent
can (and did) shrink the runtime gap the finding named — the client-side
`postIssueComment` round-trip and the render-decision helpers are now executed
under `bun test` — but two things stay strictly outside a branch agent's lane and
must be resolved by the orchestrator, not asserted here:

1. **Orchestrator acceptance of the deferral** — a decision only Fable can record.
2. **The live `test-repo` comment-**write** proof** — a live external GitHub write
   the charter routes to C8 (full-loop proof), gated on the running stack + Coder
   App credentials. It is deliberately not performed unilaterally from a fix
   worktree.

Until one of those closes, PR #38 remains merge-blocked regardless of how green
the static + runtime-contract evidence on this branch is.
