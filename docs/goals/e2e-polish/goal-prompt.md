# Goal: E2E polish — approved UI live, everything working, ready for Eve

We are in `/Users/abuusama/projects/capxul-alpha/hosted-agents`. The spec of
record is **`docs/planning/E2E-POLISH-HANDOFF.md`** (same repo) — read it FIRST
and in full. It contains the approved design (settled with Aaron — do not
re-litigate), the audited work plan W1–W6 with file:line references, the
environment recipe, and the evidence already banked. This goal prompt adds the
execution rules; the handoff carries the substance.

## Objective

The Coder product working end to end with the approved UI, visually verified:

- **W1** `/app/runs/[runId]` becomes the workspace (ai-chat composition; mock
  at `apps/web/src/app/prototype/run-workspace/` is the approved reference).
  Tabs, timeline page, and the 3-pane `run-workspace*` are deleted.
- **W2** Runs list goes flat (no status groups, whole-row click, no Open link).
- **W3** Issues board keeps its swim lanes and gains real columns (Labels ·
  Pull request · Runs · Comments · Updated), Kick off moves to a trailing
  action slot on claimable rows only, whole-row click, one status dot per row.
- **W4** The three verified #53 defects fixed (stuck Reconnecting toast,
  redundant Xelmar 403 toast, API-down SSR crash).
- **W5** Board/detail stage consistency. **W6** proof pass + issue hygiene.

Done = all six live on `claude/coder-mvp`, screenshot-proven, GitHub issues
honestly closed/kept-open per evidence, app left running. Then STOP — the next
stage (Flue→Eve migration, issue #20) is explicitly out of scope.

## Branch discipline

- Integration branch **`claude/coder-mvp`**. `main` and `claude/issues-board`
  are FROZEN. Plain git, no GitButler.
- One work package = one branch `e2e-polish/<w#>-<slug>` off latest
  `claude/coder-mvp` = one PR into `claude/coder-mvp`. Self-merge only when
  green (tests + typecheck + review loop clean + visual proof captured).

## Per-surface workflow (no exceptions)

1. Implement per the handoff's W-item. Astryx only — discover via
   `bunx astryx build/component/template/search`; compose from existing
   components and templates (runs-table and the `ai-chat` template are the
   quality bars); NO invented components, no div/raw hex/px.
2. Tests at the highest existing seam + `bun test` + typecheck. Restart the API
   after any packages/api or apps/server change.
3. **Look at it.** Open the surface in the browser and use it like a person:
   click through, resize, collapse, empty states, long titles, error states.
4. **Taste review — mandatory, separate eyes.** After functional verification,
   run a design-critique pass with a fresh reviewing agent (e.g. the design
   critique skill or a sub-agent given only the screenshots + the two quality
   bars). It must answer: does this actually look good? Is the hierarchy
   right? Is the spacing/density right? Does it make sense next to the runs
   table and the ai-chat template? Would Aaron's eye stop on anything weird?
   Fix what it finds; repeat until the critique pass is clean, max 3 rounds —
   unresolved taste findings go in the PR description, not under the rug.
5. Evidence: screenshots of every touched surface/state. For anything Aaron
   should see, capture via his real Chrome (claude-in-chrome MCP) with
   `save_to_disk: true` — in-app browser screenshots are invisible to him.
   Self-iteration screenshots can use the in-app browser.

## Working rules (Aaron's — violated before, non-negotiable)

- Never claim done without browser proof, per surface, per state.
- Never put a question to Aaron without the evidence inline first (rendered
  screenshots for UI, diffs for code); ask in prose, never a bare options
  dialog.
- Fast and cheap: no detours, no gold-plating, no re-deriving what the
  handoff already settles.
- Delete the `/prototype/*` mock pages in the final work package once the real
  screens are live and verified.

## End state

- All W1–W6 merged into `claude/coder-mvp`, each with attached visual proof.
- Issues: #56/#52 closed with evidence comments, #53 closed only if all three
  W4 defects are fixed and re-proven, #54 stays closed. Full-loop smoke on
  `AaronAbuUsama/test-repo` (issue → Kick off → PR → review → merge → Merged
  lane) with workers running.
- A short completion note appended to `docs/planning/E2E-POLISH-HANDOFF.md`
  listing what shipped, what's open, and the exact state Eve migration starts
  from. App left running on :3000/:3005.
