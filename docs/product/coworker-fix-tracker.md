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

- [ ] **B1 — Skills use the wrong mechanism** · P0 · L · *the big one*
  Today: one skill = one text blob typed into a textarea, uploaded as a flat
  `skills/<name>` file, with a prompt line telling the agent to read it. Flue
  has a first-class skills system we're bypassing: `defineSkill` →
  `SkillReference`, `PackagedSkillDirectory` (a **multi-file bundle** with a
  `SKILL.md` entry + description), auto-discovery from `.agents/skills/<name>/`,
  and `session.skill()` invocation by name. Rework: skills become uploadable
  bundles; runner registers them on `defineAgent({ skills })` and writes them to
  `.agents/skills/`; UI becomes IDE-shaped (see design proposal).
- [ ] **B2 — Model is free text** · P1 · S
  Raw string → `${provider}/${modelId}` with no validation. Make it a `Selector`
  dropdown over a curated Codex model list we define (scoped to the connected
  provider). Free-typing garbage currently fails at the OpenAI API.
- [ ] **B3 — Triggers are hardcoded text** · P1 · S
  Render as `Badge`/`Token` chips, not a plain text list. Editing them is a
  later schema+planner change — read-only badges are fine for now.
- [x] Display name — verified working end to end (flows to the GitHub check
  name + review comments). No action.
- [x] Multiple enabled skills — already supported (per-skill toggle; worker
  loads all enabled). Stays.

## R. Runs list

- [ ] **R1 — Runs view → `table-page`, not `table-grouped`** · P1 · M
  Drop the status-lane grouping. Runs are a log, not a pipeline. Rebuild on the
  `table-page` template: flat `Table` + `PowerSearch` (filter by status / worker
  / repo) + toolbar. Richer columns: worker, repo, PR/issue, status, findings
  count, model, duration, started. A filterable flat list is what scales to
  multiple agents (filter by worker), and uses only real Astryx components.
- **Kanban: dropped.** We have no board component and won't invent one; runs
  aren't stage-based work. When the Coder lands, its issue-driven runs appear in
  this same list filtered by worker — no separate board.

## C. Run workspace

- [ ] **C1 — Double-width overflow bug** · P0 · S
  Measured: `astryx-layout-content` scrollWidth 2160px vs 1645px viewport. The
  workspace `Layout` has no `contentWidth` and the content track lacks
  `min-width: 0`, so wide `CodeBlock`s blow the column out. Chat should be
  contained and scroll inside its own box.
- [ ] **C2 — Tool calls all render as generic fallback** · P1 · M
  `ChatToolCalls` supports `additions/deletions/node/stats/duration/errorMessage`
  but we pass minimal fields + `status: "complete"` for every call. Map real
  tool semantics (read → file target, shell → command+output, github tools →
  review/check result, status from success/failure). No invented tools.

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
