# Coworker — consolidated fix tracker

Living list. Combines the code-review findings and the UI direction from the
2026-07-08 walkthrough. Severity: P0 (broken/wrong) · P1 (weak, should fix) ·
P2 (backlog). Effort: S/M/L. Add items freely under "Aaron's additions".

## A. App shell / navigation

- [ ] **A1 — Sidebar redesign** · P1 · M
  Flat `SideNav` (Runs/Reviewer/Settings) → two-tier `shell-side-nav` shape:
  a top primary section, then grouped sections below with individual items +
  status dots. Proposed grouping: **by repository → recent runs** (repo = the
  "workspace", run = the "conversation", dot = run status). Plus a "New review"
  primary action and run search. Components: `SideNav`, collapsible groups,
  `StatusDot`.

## B. Reviewer configuration

- [x] **B1 — Skills use the wrong mechanism** · DONE (branch `claude/skill-bundles`)
  Skills are now multi-file markdown bundles: `worker_skill_file` table
  (skill_id, path, content; unique per path) with `SKILL.md` as the enforced
  entry file; old `worker_skill.content` backfilled into a `SKILL.md` row and
  the column dropped (migration `0005`; local.db transformed by hand since it
  is push-managed). API saves/loads whole bundles (replace-all semantics).
  UI is IDE-shaped: file tree with folders, tabbed markdown editor, bundle
  details (description/enabled/save/delete), per-bundle "Add file" and
  drag-drop upload of a folder's `.md` files; New skill accepts an uploaded
  folder (generates a starter `SKILL.md` if missing). Runner uploads
  `skills/<name>/<path>` — the block in
  `daytona-code-review-sandbox-runner.ts` is marked **FLUE ADAPTER** for the
  Eve swap. Verified end to end: create-from-upload, edit, save, reload,
  DB rows, and a live run (`0e376269…`) whose `skills_uploading` event lists
  both bundles with all files; the run then failed at the model step on the
  Codex usage limit (quota, not code).
- [x] **B2 — Model is free text** · DONE (branch `claude/model-selector`)
  Model is now an Astryx `Selector` over a curated Codex list (`gpt-5.5`,
  `gpt-5.5-codex`, `gpt-5.1-codex`, `gpt-5.1-codex-mini`) with per-option
  descriptions; clear (×) restores the platform default (saves `null`). A
  legacy free-text value still renders as an extra option. Verified: select →
  save → reload sticks; clear → save returns to default.
- [x] **B3 — Triggers are hardcoded text** · DONE (branch `claude/trigger-chips`)
  Triggers render as read-only `Token` chips in the Reviewer worker-facts
  panel and the Settings→Reviewer row (right-aligned `endContent`). The list
  moved to a shared `reviewer-triggers.ts` so both surfaces stay in sync.
  Editing stays a later schema+planner change.
- [x] Display name — verified working end to end (flows to the GitHub check
  name + review comments). No action.
- [x] Multiple enabled skills — already supported (per-skill toggle; worker
  loads all enabled). Stays.

## R. Runs list

- [x] **R1 — Runs view → `table-page`, not `table-grouped`** · DONE (branch `claude/runs-table-page`)
  Drop the status-lane grouping. Runs are a log, not a pipeline. Rebuild on the
  `table-page` template: flat `Table` + `PowerSearch` (filter by status / worker
  / repo) + toolbar. Richer columns: worker, repo, PR/issue, status, findings
  count, model, duration, started. A filterable flat list is what scales to
  multiple agents (filter by worker), and uses only real Astryx components.
- **Kanban: dropped.** We have no board component and won't invent one; runs
  aren't stage-based work. When the Coder lands, its issue-driven runs appear in
  this same list filtered by worker — no separate board.

## C. Run workspace

- [x] **C1 — Double-width overflow bug** · DONE (branch `claude/runs-table-page`)
  Measured: `astryx-layout-content` scrollWidth 2160px vs 1645px viewport. The
  workspace `Layout` has no `contentWidth` and the content track lacks
  `min-width: 0`, so wide `CodeBlock`s blow the column out. Chat should be
  contained and scroll inside its own box.
- [x] **C2 — Tool calls all render as generic fallback** · DONE (branch `claude/tool-call-semantics`)
  Tool results are joined onto their calls by `toolCallId`: real targets per
  tool (read/write → path, bash → command, grep/glob → pattern in path,
  activate_skill → name, submit_pull_request_review → event,
  complete_review_check → conclusion, finish → summary), status/errorMessage
  from `isError`, and the output rendered inside the expandable call row
  (capped at 6k chars). Matched standalone "tool result" messages no longer
  render twice. Verified on run f89b9c6a (PR #773) incl. a real failed grep.
  Mapped tool names are the ones observed in run events — revisit after Eve.

## D. Settings

- [ ] **D1 — Dynamic/contextual sidebar** · P1 · M
  Kill the settings nav embedded as a card in the middle. Settings becomes a
  destination where the left sidebar contextually shows the settings sections;
  each section is a route; middle shows one section with inline-edit rows
  (`settings-sidebar` pattern). See design proposal + opinion.
- [ ] **D2 — Content still weak** · P1 · M
  Folded into D1 — real sections (Organization, GitHub & repos, Provider,
  Reviewer behavior, Billing-later), inline editing, no dead inputs.

## E. Backlog (P2)

- [ ] **E1** — Token/cost + model usage capture per run (needs Flue usage
  extraction; nothing modeled yet).
- [ ] **E2** — Marketing page is a bare title + button.
- [ ] **E3** — Live run streaming in the workspace (polls every 5s today).

## S. Strategic / architecture (decided 2026-07-08 walkthrough)

- **Multi-agent is already modelled** via `workerRole`. Adding agents = role
  adapters, not re-architecture. Reviewer ← PRs, Coder ← issues. Every worker
  produces `agent_run` rows; the Runs table is role-generic and needs no change
  to show a second agent's runs (tagged by worker).
- **Runs vs Issues:** Runs are a *log* (table + timeline — keep). Issues are a
  *pipeline* (Ready → Claimed → Implementing → PR open → Merged/Blocked) — that
  is the Kanban, and it is the **Coder's home**, not a runs view. Bring the
  board back with the implementation agent, not now.
- **Build order:** solidify the Reviewer before building the Coder. Design the
  IA (sidebar, nav slots, role-generic runs) so the Coder + Issues board slot in
  with zero rework; build one agent well.
- **S1 — Flue → Eve runtime refactor** · low risk, contained to runner package
  Eve (eve.dev) is conceptually near-identical to Flue: filesystem-first
  (`instructions.md`, `agent.ts`, `defineTool`, `sandbox/`), and **skills are the
  same abstraction** — a `skills/` directory of markdown files loaded
  contextually. So the skills *bundle format* transfers 1:1. The refactor is
  contained to `apps/server/src/runners/`; web app, API, and DB schema are
  untouched. B1 is ~95% runtime-agnostic — build the bundle model + upload + IDE
  editor now; only the ~30-line "write bundle into runtime skills dir + register"
  seam swaps at refactor time. Do the runner swap as its own focused task.

## Work split (given S1)

- **Safe now (any runtime):** A1 sidebar, D1/D2 settings, C1 width bug,
  B3 trigger badges, B1-agnostic (skills UI + bundle data model).
- **Gated on the Flue/Eve call:** B1 runtime seam, C2 tool-call semantics,
  everything Coder + Issues Kanban.

## Aaron's additions

_(dump items here — I'll fold them into the sections above)_

- [ ] …
