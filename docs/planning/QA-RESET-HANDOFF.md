# QA Reset Handoff — read this before touching anything

Written 2026-07-11 ~07:30 by the overnight session, at Aaron's request, after his QA
found the UI direction wrong and several "fixed" claims unverified. The overnight
session burned its context; a FRESH session owns everything below.

## Non-negotiable working rules (Aaron's, violated before — do not repeat)

1. **Never claim a UI change is done without a browser screenshot of it running.**
   Verify → screenshot → then say done. Every surface, every state you touched.
2. **When Aaron says "categorize / make a plan", do exactly that.** Do not file
   issues, launch fix waves, or merge anything until he says go on the plan.
3. Decisions go to him as: the problem in real code (file:line), blast radius,
   options as concrete code, graded — then the question. (His global CLAUDE.md.)

## Environment (running as of handoff)

- Branch: `claude/coder-mvp` (main checkout of /Users/abuusama/projects/capxul-alpha/hosted-agents).
  `main` + `claude/issues-board` frozen. Draft PR #50 → main was CLOSED at Aaron's
  request; the branch is the source of truth.
- Services: API :3000 (`cd apps/server && CORS_ORIGIN=http://localhost:3005 bun run dev`),
  web :3005 (`cd apps/web && bunx next dev --port 3005`), `bun run worker:code-reviews`,
  `bun run worker:implementations`, smee (`npx smee-client -u <GITHUB_WEBHOOK_PROXY_URL from apps/server/.env> -t http://localhost:3000/api/github/webhook`).
  RESTART API + workers after any packages/api or apps/server change.
- Authenticated browsing for proofs: mint a session via
  `/private/tmp/claude-501/.../scratchpad/mint-session.mjs` pattern — insert a session
  row for the existing user + set the signed better-auth cookie. (Or ask Aaron to drive.)
- Boards: hosted-agents project 50ebd641-694f-4beb-911e-cf9c50c76031; test-repo
  project 7843c9c7-9879-4492-98c5-9a7fdd87a661 (reviewer-app record).
- Migrations healthy through 0011. DB pragmas (WAL + busy_timeout) set at connection init.

## Aaron's product model (in his words, paraphrased tightly)

- **Issues must get the Runs treatment.** The runs list has collapsible status
  groups and a proper detail family; the issues board and issue detail must feel
  identical in quality. Board lanes = Linear-style collapsible swim lanes.
- **Issue detail**: comment ✓, open-on-GitHub ✓, edit issue (follow-up, needs a real
  editor, not bare textareas), and runs as LINKS.
- **A run link from an issue must land directly on the TRANSCRIPT.**
- **The transcript IS the workspace** — its own dedicated screen (what he calls the
  IDE view): the agent ROLLOUT rendered full-bleed (the rich chat with tool calls
  that already exists in run-rollout.tsx on this branch), with at most a collapsible
  sidebar of important stuff. NOT a tab. The current 3-pane run-workspace.tsx is
  rejected. The Transcript-as-tab on run detail is rejected.
- **Timeline is itself a problem**: it currently surfaces raw Flue events
  ("operation_start: prompt", "Flue event: agent_start"...). Internal runtime noise
  must not be user-facing; the timeline needs a curated, human-meaningful set of
  stages — and it does NOT belong on issues at all.
- **Future (spec it, don't build it)**: a composer on the rollout so a human can
  jump in and steer a long-running agent mid-run. Runtime needs an inbox the runner
  polls between model turns; nothing exists today.

## Disputed / unverified state — VERIFY FIRST with screenshots, then fix

Issues #52 (comment metadata leak), #53 (toast spam / "resource not accessible by
integration" red toasts still seen on Xelmar repos), #56 (collapsible lanes) were
reopened: code was merged claiming fixes (PRs #57-#60) but never visually verified
per-surface. #54 (issue→run links) rendered correctly on issue #3 but must be
re-pointed at the transcript screen once it exists.

Also check: Xelmar boards should show the P4 inline error state with the
grant-permissions CTA once — not stacked red toasts. If toasts still fire for
`openPullRequests` or other queries on those repos, the connection-status
classifier (apps/web/src/lib/connection-status.ts) is treating a 403 app error as
toast-worthy per-query; consolidate.

## Suggested order for the fresh session

1. Reproduce + screenshot the current state of #52/#53/#56/#54 surfaces. Reopen/
   close honestly. Show Aaron the evidence.
2. Take the transcript/workspace redesign to Aaron as a graded options doc with
   mock-level code sketches (rollout-first screen, curated timeline, issue-run →
   transcript deep link, kill 3-pane + transcript tab). NO implementation until he
   picks.
3. Only then run fix waves, one surface at a time, screenshot before/after each.

## Context docs

- Product specs: issues #19, #21 (closed, shipped). Milestones: 1 (Coder MVP, done),
  2 (QA round 1, in dispute).
- Run narrative + defects found live: docs/runbooks/coder-mvp-e2e.md.
- Overnight charter (ops rules, still binding for guardrails): docs/goals/coder-mvp-overnight/goal-prompt.md.
- The nice-ui branch (abuusama/coworker-ui-shell-reset-handoff) is static mocks —
  its run views are POORER than this branch's; only its composition ideas matter
  (URL-synced tabs, 4-tab issue detail, board/table toggle). Do not port it blindly.
