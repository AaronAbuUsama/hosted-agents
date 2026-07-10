# Goal: Coder MVP overnight — issues board finished + working Coder loop

We are in `/Users/abuusama/projects/capxul-alpha/hosted-agents`. Run this as an
autonomous overnight goal with ultracode (multi-agent workflows). Aaron is
asleep; when he wakes he logs into a RUNNING app and watches issues flow
Backlog → Ready → Executing → In PR → Merged, driven by real agents.

## Objective

Ship every issue in the GitHub milestone **Coder MVP (overnight)** on
`AaronAbuUsama/hosted-agents`. Specs of record: issue #19 (board) and the
Coder MVP spec issue. When the milestone is done, the full loop must have been
proven LIVE on `AaronAbuUsama/test-repo`: label issue → kick-off → Coder claims
(one at a time) → branch → PR (Coder app identity) → Reviewer auto-reviews →
babysit rounds (max 3) → approval → auto-merge → Merged lane. Evidence
captured, runbook written, app left running.

## Branch discipline

- Integration branch: **`claude/coder-mvp`**, cut from `claude/issues-board`.
- `main` and `claude/issues-board` are FROZEN — never commit to or merge into
  either. Never touch other agents' branches. Plain git, no GitButler.
- One issue = one branch off `claude/coder-mvp` = one PR into
  `claude/coder-mvp`. Self-merge ONLY when green (below). At the end, open a
  DRAFT PR `claude/coder-mvp` → `main` as Aaron's morning review surface — do
  NOT merge it.

## Per-issue workflow (no exceptions)

1. Branch `coder-mvp/<issue-number>-<slug>` off latest `claude/coder-mvp`.
2. Implement exactly the issue's acceptance criteria. Discover UI via
   `bunx astryx build/component/template/search` — Astryx only, tokens only,
   no div/raw hex/px/shadcn/lucide/sonner/tailwind.
3. Tests at the highest existing seam (webhook harness / procedure / pure fn)
   + `bun test` + typecheck green. RESTART the API after any packages/api
   change — flue dev does not hot-reload it.
4. Sub-agent review loop: review the diff with a reviewer agent; fix findings;
   repeat until clean, max 3 rounds. Report unresolved findings in the PR.
5. Live e2e proof where the issue demands it — on `AaronAbuUsama/test-repo`
   ONLY. Browser-drive the affected surface, screenshot before/after.
6. PR into `claude/coder-mvp` with summary + evidence; merge it yourself when
   1–5 are all green; delete the branch.

## Model policy

- Orchestration, review passes, and hard verification: **Fable**
  (claude-fable-5). Implementation subagents: **Opus** (claude-opus-4-8).
  **NEVER Sonnet.** Don't waste Fable on mechanical work.
- Product agent runs (Coder/Reviewer in Daytona): **`gpt-5.6-lunar` at lowest
  reasoning effort** — verify the exact slug against the live Codex API before
  pinning; if it doesn't exist, use the closest 5.6 codex slug and flag it.
- Live model runs are allowed per feature (Aaron approved). If Codex returns a
  usage-limit error: FLAG it in the run log, fall back to synthetic
  verification for remaining issues, and NEVER retry-loop against a dead quota.

## Environment

- API: `cd apps/server && CORS_ORIGIN=http://localhost:3005 bun run dev` (:3000)
- Web: `cd apps/web && bunx next dev --port 3005`
- Implementation + review workers and the smee webhook proxy
  (`GITHUB_WEBHOOK_PROXY_URL` in apps/server/.env; see
  docs/runbooks/local-github-webhooks.md) must be running for live loops.
- Board: http://localhost:3005/app/projects/50ebd641-694f-4beb-911e-cf9c50c76031
  (hosted-agents, READ-ONLY surface) and the test-repo project for live writes.
- Coder GitHub App credentials are in apps/server/.env (`GITHUB_CODER_APP_*`);
  private key in ~/.config/hosted-agents/ (Downloads is EPERM-blocked).

## Hard guardrails

- Live Coder writes (claims, branches, PRs, merges, comments) happen on
  `AaronAbuUsama/test-repo` ONLY. `hosted-agents` board stays read-only;
  never let the Coder claim a hosted-agents issue tonight.
- Do NOT change any GitHub App's settings/permissions — flag and continue.
- Do NOT touch `main`, `claude/issues-board`, or other agents' branches.
- Humans always win: any human activity on a Coder PR ends its babysitting.
- Auto-merge only on the `CODER_AUTOMERGE_REPOS` allow-list (= test-repo).
- Keep GitHub issue statuses current: comment progress + close each milestone
  issue as its PR merges.

## Dependency order

C1 (per-role app creds), C2 (model policy), P1, P3, P4 in parallel first.
P2 (webhook sync) → P5 (live board refresh).
C3 (role adapter) → C4 (kick-off) → C5 (write runner) → C6 (babysit) →
C7 (auto-merge) → C8 (full-loop proof + runbook). P6 (polish) last.

## Done means

1. Every milestone issue closed via a merged PR on `claude/coder-mvp`.
2. C8's runbook exists at docs/runbooks/coder-mvp-e2e.md with screenshots of
   every lane transition + the runs log; at least 2 issues driven through the
   entire live loop on test-repo without manual GitHub intervention.
3. API, web, workers, and smee all RUNNING; board renders live at the URL
   above; login works (Aaron's existing account).
4. Draft PR `claude/coder-mvp` → `main` open, summarizing the night: features,
   evidence, flagged risks, anything skipped and why.
5. A morning-note comment on the milestone: what shipped, what's flagged,
   exact URLs to click first.
