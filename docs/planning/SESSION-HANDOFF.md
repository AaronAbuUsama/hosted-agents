# Coworker session handoff — issue-centric pivot

Single source of truth for resuming after compaction. Read this first.
Last updated: 2026-07-09.

## Mission

Coworker is a control room for named AI workers operating inside GitHub. Two
threads of work:

1. **Done this session** — reviewer configuration polish + a dedicated Skills
   IDE screen + app-shell fixes (see "What's done").
2. **Next (the pivot)** — make the product **issue-centric**, not PR-centric.
   Clicking a repo/project should land on its **issues board**, not runs. Then
   integrate the **second agent (the Coder)** that works issues → PRs, and
   migrate the runtime **Flue → Eve**. Order and locked decisions below.

## What's done (committed, pushed to origin)

Two GitButler stacks, all on `origin`. Nothing merged.

**Stack A** (on `claude/settings-astryx-rebuild`, bottom→top):
- `cf48b69` `claude/model-selector` — B2: reviewer model is an Astryx `Selector` over a curated Codex list (`gpt-5.5`, `gpt-5.5-codex`, `gpt-5.1-codex`, `gpt-5.1-codex-mini`), clear = platform default.
- `7e3e0c0` `claude/trigger-chips` — B3: triggers render as read-only `Token` chips on the reviewer page + `settings/reviewer`; shared list in `components/coworker/reviewer-triggers.ts`.
- `3d69bb2` `claude/skill-bundles` — B1 (P0): skills are multi-file markdown **bundles**. New `worker_skill_file` table (migration `0005_large_vulture.sql`), API saves/loads whole bundles, runner uploads `skills/<name>/<path>` (marked **FLUE ADAPTER** in `apps/server/src/runners/daytona-code-review-sandbox-runner.ts`).
- `6221b49` `claude/app-shell-fixes` — fixed 3 shell errors + nav dedupe (see below).
- `1ea1ac7` `claude/skills-screen` — dedicated `/app/skills` IDE: merged explorer (skills as folders → files), **syntax-highlighted `CodeBlock` editor** (markdown, line numbers) with a Source/Edit toggle, file search, config panel, New-skill dialog. Reviewer page slimmed to base prompt + attached-skills card.

**Stack B** (on `claude/runs-table-page`, bottom→top):
- `0d21541` `claude/tracker-notes` — tracker ticks for B1/B2/B3/C2.
- `668e5c3` `claude/tool-call-semantics` — C2: run transcript maps real tool semantics (read/write/bash/grep/glob/github tools), status + output joined by `toolCallId`.

**app-shell-fixes detail** (`6221b49`): live-data side nav extracted to `components/coworker/app-side-nav.tsx`, mounted client-only behind a mounted gate in `app-frame.tsx` (kills the `getServerSnapshot` SSR warning); **next-themes removed** (it wrote `class` while the app themes via `data-theme`; also killed the "script tag while rendering" error); dropped the redundant footer "active runs" nav item (count now a badge on Runs); added the **Skills** nav item.

## LOCKED decisions for the next work (issue-centric)

These were settled in a grill on 2026-07-09. Treat as spec.

### Product model
- **Issue-centric.** Repo click → **issues board** (primary). Runs are just a log/secondary tab.
- The board is the Astryx **`table-grouped`** template — a table grouped by a stage-header column that reads like a kanban. **Not** a drag-drop kanban and **not** a new component.
- Whole feature is likely **feature-flagged** initially (there is a `FeatureNotEnabled` pattern already in use — `components/coworker/feature-not-enabled.tsx`).

### Stages (board columns)
`Backlog → Ready for agent → Executing (claimed) → In PR → Merged`, with
**Failed/Blocked** as a terminal state reachable from any stage. (User was
unsure "fail" is the exact word — treat as Failed/Blocked; confirm copy.)

### Labels (what enters the board / gates the agent)
- Issues carry a label: **`ready for agent`** or **`human in the loop`**.
- `ready for agent` → the Coder may claim and work it autonomously.
- (Exact label strings/όslug TBD — confirm the literal GitHub label names; likely configurable.)

### The Coder (second agent) contract
- Trigger: user creates issues (from a PRD), labels one `ready for agent`.
- On claim it works **autonomously**: issue → branch → PR.
- **Concurrency limit**: only N agents work at once; agents **cannot double-claim** (claim mechanism already exists — reuse it).
- When the Coder opens a PR it **automatically kicks off a Reviewer run** (the review loop).
- The Coder then **babysits** the PR for a **maximum number of rounds** until it's blocked by human review.
- Second agent is a new `workerRole` (Reviewer = `code_review`; runs are role-generic already).

### Sync
- Use **GitHub webhooks** (parallel to the existing PR webhook — see `github_webhook_delivery` table + `apps/server` webhook admission). Issues webhook + stored sync.

### Comment identity
- **Agents are their own identities.** Agent comments post to GitHub **as the agent**; user comments post **as the user**. Do not collapse them.

### Existing UI to restore/reuse (IMPORTANT — user said "have a look")
- **`components/coworker/issue-detail.tsx`** — DELETED in commit `58a2b71` ("chore(web): delete fixture scaffold and dead demo surfaces"), **562 lines**, a real issue + comments view (Markdown body, comment `TextArea`, Table, TabList, MetadataList, StatusDot, Token). **Restore from git**: `git show 58a2b71^:apps/web/src/components/coworker/issue-detail.tsx`. This is the "whole UI around issues and comments" the user referenced.
- Current route `app/(app)/app/projects/[projectId]/issues/[issueId]/page.tsx` is a `FeatureNotEnabled` stub — wire it to the restored detail view.
- `app/kanban-board/page.tsx` — DELETED demo fixture (699 lines, Meta/Astryx drag-drop kanban). Reference only; we use `table-grouped`, not drag-drop.
- Board goes where `repository-workspace.tsx` currently shows the "Issues" tab placeholder ("Issues arrive with the coding agent"). Flip the default from Runs → Issues.

## Recommended order (next)

1. **Issues board first** — no runtime dependency; it's the visible product and the Coder's input.
   - Live-fetch (then webhook-sync) repo issues from GitHub (Octokit `issues.listForRepo`, exclude PRs via `!issue.pull_request`), filtered to the gating label.
   - Render on `table-grouped`, grouped by stage, as the repo's **default** view; demote Runs to a "log" tab.
   - Restore `issue-detail.tsx`; wire the `[issueId]` route to it (read + comment, agent vs user identity).
   - Kick-off button present but gated until the Coder exists.
2. **Flue → Eve** — do it right before the Coder so the new agent is born on Eve, not rewritten. Contained to `apps/server/src/runners/` (the marked FLUE ADAPTER seam).
3. **Coder (second agent)** — new `workerRole`, issue → branch → PR, concurrency + no-double-claim, auto-triggers Reviewer on PR, babysits N rounds. Wire the board's kick-off to it.

**Next immediate step:** write the **PRD** for the issues board (Phase 1), using the LOCKED decisions above. User approved moving from grill → PRD.

## Gotchas & risks

- **Codex quota** blocks live runs at the model step (`prompt failed: Codex error: The usage limit has been reached`). Infra/sandbox/skills verify up to that point; the model call may not. Not a code bug.
- **GitButler stacks**: shared files are dependency-locked. Commit on a new branch, then `but move <yours> <owner>` to stack, then `but amend` the locked file in. Do **NOT** push/amend other agents' branches. `but push <branch>` per branch (bare `but push` pushes all).
- **Build-break lesson**: when deleting a file + editing its importer across a GitButler stack, verify BOTH land in the commit (`git show <branch>:<file>`). We shipped `app-shell-fixes` briefly importing a deleted `theme-provider.tsx`; fixed in `6221b49`.
- **Screenshots via claude-in-chrome cap at ~1512px** and can't capture CSS top-layer (toasts/dialogs) reliably — verify those via the DOM. Collapse the app sidebar to fit wide IDE layouts. Extension drops occasionally (transient).
- **Uncommitted, NOT mine**: `apps/web/src/app/(marketing)/page.tsx` (another agent). Leave it.
- **Pre-existing debt (not blocking)**: `packages/db/src/migrate.ts` type errors; stale compiled tests in `apps/server/dist/` fail only when run alongside src tests; `agent_run.model` schema drift rode along in migration `0005`; `next-themes` still in `apps/web/package.json` deps (unused, safe to drop).
- `next-themes` gone from code; the app is permanently dark via `data-theme="dark"` in `app/layout.tsx` + Astryx `mode="dark"`.

## Key file pointers

- Trackers: `docs/product/coworker-fix-tracker.md`, `docs/product/coworker-ui-v2.md`.
- Migrations runbook: `docs/runbooks/database-migrations.md`. Schema: `packages/db/src/schema/worker-config.ts`.
- API router: `packages/api/src/routers/index.ts` (worker config, skills, `openPullRequests`, GitHub installs via `../github-app`).
- Runners (FLUE ADAPTER seam): `apps/server/src/runners/`.
- Repo workspace / issues tab: `apps/web/src/components/coworker/repository-workspace.tsx`.
- Restore issue UI: `git show 58a2b71^:apps/web/src/components/coworker/issue-detail.tsx`.
- Memory: `chrome-screenshot-quirks.md`, `hosted-agents-local-dev.md`, `screenshot-progress-preference.md`.
- Local dev: web `cd apps/web && bunx next dev --port 3005`; API `cd apps/server && CORS_ORIGIN=http://localhost:3005 bun run dev`; DB `local.db`; run a queued review `bun scripts/run-code-review-worker.mjs --once`.
