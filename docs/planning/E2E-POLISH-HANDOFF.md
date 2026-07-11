# E2E Polish Handoff — finish this stage, then Flue→Eve

Written 2026-07-11 ~11:00 by the QA-reset session at Aaron's request. A FRESH
session owns everything below. Goal: the Coder product working end to end with
the approved UI, visually verified — so the NEXT stage (Flue→Eve runtime
migration, issue #20) can start clean. Do not start the migration.

## Non-negotiable working rules (Aaron's — violated before, do not repeat)

1. **Screenshots he can SEE**: drive Aaron's real Chrome (claude-in-chrome MCP)
   and capture with `save_to_disk: true` — those attach to your message. The
   in-app Browser pane screenshots are visible only to you. Screenshot every
   surface you touch, before/after, and attach them as you go.
2. **Never claim done without browser proof.** Per surface, per state.
3. **Never ask a question without the evidence in front of him**: UI decisions →
   rendered mockups; code decisions → the diff. Ask in prose after. NEVER a bare
   options dialog.
4. **Don't invent components.** Compose from Astryx templates/components that
   already exist (`bunx astryx build/template/component`). The codebase's own
   runs-table and the `ai-chat` template are the two references for this stage.
5. Be fast and cheap. No detours, no gold-plating, no giant bespoke pages.

## Environment

- Branch `claude/coder-mvp`, main checkout `/Users/abuusama/projects/capxul-alpha/hosted-agents`
  (worktrees have no .env). API: `cd apps/server && CORS_ORIGIN=http://localhost:3005 bun run dev`
  (port 3000). Web: `cd apps/web && bunx next dev --port 3005`. Workers when the
  loop must run: `bun scripts/run-code-review-worker.mjs` from repo root (sources
  `~/.config/hosted-agents/secrets.env`; running `bun run worker:*` directly misses
  DAYTONA keys). smee for webhooks (URL in apps/server/.env).
- Headless auth for your own poking: mint a session cookie —
  `bun <scratchpad>/mint-session.mjs` pattern (insert session row + signed
  better-auth cookie; script exists in prior session scratchpads, or re-derive:
  HMAC-SHA256 of token with BETTER_AUTH_SECRET, cookie
  `better-auth.session_token=<token>.<b64sig>`). Aaron's Chrome is already
  signed in — prefer it for proof shots.
- Boards: test-repo project `7843c9c7-9879-4492-98c5-9a7fdd87a661` (has the full
  proven loop: issues #3/#4, PRs #5/#6, 5 runs); hosted-agents
  `50ebd641-694f-4beb-911e-cf9c50c76031`. Xelmar-tech repos 403 on Issues
  (permission not granted — that's the P4 inline state, expected).

## THE APPROVED DESIGN (Aaron's words, distilled — this is settled, do not re-litigate)

- **Runs = flat audit list.** No status group headers at all (runs are only ever
  read after the fact). Plain table, newest first. Whole row is the click target
  → lands DIRECTLY in the workspace. No "Open" link. Optional ⋯ menu at row end.
- **Issues = swim lanes.** Keep the collapsible stage groups (Backlog → Ready →
  Executing → In PR → Merged / Closed / Failed) — issues are live work in
  stages. Rows get runs-table-substance columns: Labels · Pull request · Runs ·
  Comments · Updated. ONE status dot per row (leading cell) — no other colored
  dots anywhere. Whole row click → issue detail; no "Open" link. **Kick off is
  an action at the END of the row** (its own slot, where Open used to be), only
  on claimable rows; ⋯ menu for secondary actions.
- **The workspace IS the run page.** `/app/runs/[runId]` becomes the ai-chat
  composition — approved mock at `apps/web/src/app/prototype/run-workspace/`
  (live at localhost:3005/prototype/run-workspace, real data fixture from run
  8bb74d17): one-row header (back · status dot · title · repo/branch tokens ·
  duration | Open on GitHub + context-panel toggle top-right), full-height chat
  transcript, curated stage dividers as ChatSystemMessage, collapsed tool chips
  with targets, composer pinned at bottom (placeholder only — steer-mid-run is
  spec'd, NOT built; runtime inbox doesn't exist), resizable right context panel
  (run facts + artifacts + artifact preview). NO tabs, NO timeline page, NO
  3-pane. Board-columns reference mock: /prototype/issues-board-columns (flat —
  note Aaron corrected this: issues KEEP lanes; the mock's value is the row/
  column treatment only).
- Delete the prototype pages once the real screens land and are verified.

## Work plan (audited against code 2026-07-11; all file:line verified)

### W1 — Workspace screen (the big one)

- Rewrite `apps/web/src/components/coworker/run-rollout.tsx` to the mock's
  composition (mock is a working reference — port it, don't re-derive).
  Transcript rendering (TranscriptContent/TranscriptMessage, run-rollout.tsx:293-458)
  already works; recompose in ChatLayout with composer + dividers + end panel.
- Curated dividers: filter events where `flueEventType` is empty, types in the
  divider set (see mock's DIVIDER_TYPES). DB fact: empty `flue_event_type` =
  ~2.1k curated human events; set = ~29k runtime noise. Add a pure selector in
  `apps/web/src/lib/run-view-model.ts` next to mapAgentRunEventToTimelineRow
  (:276) + unit tests in run-view-model.test.ts.
- Artifacts for the context panel: reuse `createAgentRunArtifactsCollection`
  (already consumed by run-workspace-data-island.tsx:64) in run-detail's data
  island. Preview: Markdown for text/markdown, CodeBlock otherwise (mock shows both).
- Delete: `run-workspace.tsx` (969 lines), `run-workspace-client.tsx`,
  `run-workspace-data-island.tsx`; `app/(app)/app/runs/[runId]/workspace/page.tsx`
  → `redirect(\`/app/runs/${runId}\`)`. Remove the Tabs (run-rollout.tsx:146-150),
  the "Open workspace" link (:135), keep `?tab=` parsing in
  `app/(app)/app/runs/[runId]/page.tsx:13-19` but ignore it (old links resolve).
- Update `lib/coworker-ia-contracts.ts:191` run-detail entry (it already says
  "should become the live cockpit"). Check contract tests still pass.
- Issue detail run links (`run-view-model.ts:238`, href `/app/runs/${id}`) now
  land on the transcript automatically — #54's re-point is free.

### W2 — Runs list goes flat

- `apps/web/src/components/coworker/runs-table.tsx`: delete the status group
  header rows + `statusOrder` grouping (:49-57, group header at :237); flat sort
  newest-first (runOrderTimestamp exists in run-view-model.ts:246). Rows already
  navigate on click (:265, :293) — remove the redundant "Open" link column
  (stopPropagation at :349) and the `actions` column, or replace with ⋯. Apply to
  both column sets (columns :59, compactColumns :70). Same treatment wherever the
  project workspace Runs tab reuses this table.

### W3 — Issues board rows get substance (lanes STAY)

- API: `packages/api/src/issues/service.ts` — the overlay already carries
  `linkedPullRequest` (:32, :43) for stage derivation but `BoardIssue` doesn't
  expose it. Add it (+ whatever number/state shape the overlay holds) to the
  BoardIssue spread in buildBoard (:60-70) so the UI can render "PR #57 · open".
- Runs count per issue: zero-API option — client-side group-by over the
  org-scoped `agentRunsCollection` on (repositoryLabel, issueNumber); the exact
  matching logic exists in `selectIssueRunRows` (run-view-model.ts:218-232).
  Render plain text ("2 runs"), no dot.
- `apps/web/src/components/coworker/issues-board.tsx`: extend columns (:50-56)
  with `pr` + `runs`; plain-text cells (the "—" pattern already there); move
  Kick off from the title cell (:283-291) to a trailing action cell (claimable
  rows only); make issue rows real click targets — lane headers (:235) already
  have role/tabIndex/keyboard, issue rows (:263) have onClick only: add
  role="link"-equivalent, tabIndex, Enter/Space, cursor pointer.
- Keep: lanes, collapse behavior (#56 verified working), watermark polling.

### W4 — #53 leftovers (all three verified broken today, evidence in session)

1. **Stuck "Reconnecting…" toast**: with a loaded board, kill API → single calm
   info toast appears (correct); restart API → polls return 200 for 40+ seconds
   and the toast NEVER clears (self-heal broken; manual X works). Suspects:
   the reporter's dismiss handle goes stale — `createConnectionStatusReporter`
   apply() (`apps/web/src/lib/connection-status.ts:177-196`) vs Astryx Toast
   `collisionBehavior: "ignore"` returning a dead handle for an ignored
   duplicate (reconnectingToast :140-150), or toast-bridge handler remount
   (`lib/toast-bridge.ts`). Fix + a regression test at the reporter level, then
   re-verify live (kill/restart API).
2. **Xelmar 403 redundant toast**: board renders the correct inline P4 state
   ("This installation doesn't have Issues access" + Open GitHub settings CTA)
   AND a red toast fires per board visit for the same 403 (deduped by message so
   no stack — but it's noise). Consolidate: queries whose surface renders the
   error inline should not also toast — add a query `meta` flag consumed by
   `queryCache.onError` in `apps/web/src/utils/orpc.ts:21` before
   `connection.reportError`, or filter the board's listRepositoryIssues error
   classification. Verify on all three Xelmar repos: inline state, zero toasts.
3. **API-down hard navigation crashes SSR**: `apps/web/src/app/(app)/app/layout.tsx:10`
   — `authClient.getSession({ fetchOptions: { headers, throw: true } })`
   unguarded; with API down, any full page load = unhandled "fetch failed"
   (dev overlay / prod 500). Guard it (try/catch → redirect to /login or a
   calm offline state).

### W5 — Stage consistency (small)

- test-repo #4: board lane says **Merged**, issue detail header/sidebar says
  **Closed**. The board derives stage via `deriveStage`
  (packages/api/src/issues/stage.ts); the detail derives its own display.
  Unify — detail should use the same derived stage (check
  `apps/web/src/lib/issue-detail-view-model.ts`).

### W6 — Verify + issue hygiene (last)

- Per-surface proof shots via Aaron's Chrome (save_to_disk), before/after each W.
- Then GitHub issue states, honestly: #56 close (verified fixed today —
  collapse/expand proven), #52 close (both agent comment shapes render clean;
  raw markers confirmed present in DB so stripping is active), #54 stays closed
  (links verified; transcript landing satisfied by W1), **#53 stays open** until
  W4 all-three are fixed and re-proven. Post evidence comments.
- Full-loop smoke on test-repo when workers are up: issue → Kick off →
  Executing → PR → review → auto-merge → Merged lane. (Loop itself proven
  2026-07-11 — see docs/runbooks/coder-mvp-e2e.md; Codex quota errors are
  account quota, not code.)

## Evidence already banked today (do not redo)

- #56 collapsible lanes work (test-repo + hosted-agents at scale).
- #52 metadata stripping works on issue detail (#3 and #4, both comment kinds).
- #54 run links render + navigate correctly.
- #53: calm reconnect toast works on API-down; self-heal broken; Xelmar
  redundant toast; SSR crash — all reproduced with exact steps (this doc, W4).
- Approved workspace mock renders real run 8bb74d17 end to end through the real
  view-model mappers (fixture: apps/web/src/app/prototype/run-workspace/fixture.json).

## Completion note (e2e-polish stage — done 2026-07-11)

All six work packages shipped to `claude/coder-mvp`, each its own squash-merged PR,
each browser-proven on the real app (Aaron's Chrome). What shipped:

- **W1 (#61) — the workspace IS the run page.** `/app/runs/[runId]` is now the
  approved ai-chat composition: one-row header, full-height chat transcript with
  curated stage dividers, collapsed tool chips, a disabled placeholder composer
  (steer-mid-run still not built), and a resizable Run context panel (facts +
  artifacts + preview). Old tabs/timeline and the 3-pane `run-workspace*` deleted;
  `workspace/page.tsx` redirects. Pure `selectRunTranscriptFeed` selector + tests.
  Design-critique round applied (composer disabled + clean copy, capped reading
  column, truncated header branch token).
- **W2 (#62) — runs list flat.** No status-group headers; newest-first via pure
  `sortRunRowsByRecency` (+ `orderTimestamp` on the row model); no "Open" link;
  whole-row click. Shared table, so the project Runs tab matches.
- **W3 (#63) — issues board substance, lanes kept.** Columns now Labels · Pull
  request · Runs · Comments · Updated; Kick off moved to a trailing action slot on
  claimable rows only; rows are real click targets; one status dot per row. API:
  `BoardIssue.linkedPullRequest` (number + state); web: pure `countRunsByIssue`.
- **W4 (#64) — the three #53 defects.** (1) reconnect-toast self-heal: the agent-run
  collections stopped polling on error and never fired the success that clears the
  indicator — now slow-poll on error (`lib/run-collection-poll`), plus a reporter
  hardening (overwrite so the dismiss handle can't go stale). (2) Xelmar 403 double
  toast: `RENDERS_ERROR_INLINE` query meta gates the global toast. (3) API-down SSR
  crash: `app/(app)/app/layout.tsx` `getSession` guarded → redirect to /login.
- **W5 (#65) — stage consistency.** The detail now renders the server's
  overlay-derived `stage` (was re-deriving from state+labels), so a merged-then-closed
  issue reads "Merged" on both board and detail. Labels-only client derivation removed.
- **W6 (this PR) — proof pass + hygiene.** Deleted the `/prototype/*` mock pages;
  full typecheck now clean. Closed #56, #52 (banked evidence) and #53 (all three W4
  defects re-proven live) with evidence comments; #54 stays closed (comment confirms
  W1 satisfies transcript-landing).

**Open / not done (honest):**
- **Full-loop worker smoke (issue → Kick off → PR → review → merge) was NOT re-run
  this session.** The dev API process is reaped ~every 2 minutes in this environment,
  so a multi-minute worker run can't complete here. The loop end-to-end is already
  banked (2026-07-11, `docs/runbooks/coder-mvp-e2e.md`). The Kick-off *UI* is proven:
  a claimable test issue (test-repo #7, since closed) rendered the Kick off button in
  the board's trailing slot; non-claimable rows have an empty trailing cell.
- **Steer-mid-run composer** is a disabled placeholder — the runtime inbox doesn't
  exist. Spec'd, not built.
- W2's desktop 7-column table and W3's Kick-off button were captured once the Chrome
  window recovered to desktop width; some wide-board columns clip in-capture (window
  wider than the screenshot canvas) and are DOM-verified where pixels fall off-edge.

## After this stage — where Eve migration starts

Flue→Eve runtime migration (issue #20) — a different agent framework replacing Flue
in the worker runtime. NOT part of this handoff. Starts clean from `claude/coder-mvp`
at the W6 merge: the Coder product works end to end with the approved UI, all six W
packages merged and proven, `main` and `claude/issues-board` still FROZEN. The
transcript/runs/board/detail surfaces are stable; Eve changes the worker runtime
behind them, not these screens.
