# Coder MVP — Live E2E Proof (overnight run, 2026-07-10 → 2026-07-11)

Note: worker-role naming per `docs/runbooks/worker-runtime.md` — the role is
`implementation`; "The Coder" is a display name. Localhost GitHub Apps:
`localhost-abu-bakr-at-coworker` (reviewer) and `localhost-coder-at-coworker`
(Coder, App ID 4268393, installation 145769942).

## What was proven, live

The complete issue → merged loop ran against `AaronAbuUsama/test-repo` with
zero manual GitHub-UI intervention (one deliberate human approval, which is
the designed C7 path):

1. **Seed + sync**: issue #4 ("Add a MAKEFILE…") created with the
   `ready for agent` label → `issues.opened` + `issues.labeled` webhooks →
   smee → admission `accepted` → `github_issue` row.
2. **Kick-off from the board UI**: one click on the Kick-off button →
   `kickOffIssue` → atomic claim + queued `github.issue_implementation` run
   (`b52a2148`). Board row moved *Ready for agent → Executing* live (revision
   watermark, no reload).
3. **Autonomous implementation**: implementation worker (serial, `limit: 1`)
   claimed the run → Daytona sandbox → full clone (token scrubbed) → branch
   `coder/issue-4-add-a-makefile-with-build-test-and-clean-targets` → Flue
   session on `openai-codex/gpt-5.5` (reasoning: low) wrote the Makefile →
   commit → push with the Coder installation token (scrubbed after) →
   **PR test-repo#5 opened by `localhost-coder-at-coworker[bot]`** with
   "Closes #4" → progress comment on the issue as the Coder → linked-PR stamp
   → board *In PR* lane.
4. **Auto-review**: `pull_request.opened` (reviewer app's copy) → review run
   `6a03c310` → Daytona + Codex reviewed the Coder's PR → verdict COMMENTED
   (admission correctly ignored it as `review_state_not_actionable`).
5. **Approval → agent merge (C7)**: human approval on the PR →
   `pull_request_review.submitted` (approved, Coder-app copy admitted) →
   allow-list check (`CODER_AUTOMERGE_REPOS=AaronAbuUsama/test-repo`) →
   **the Coder squash-merged its own PR** (`mergedBy:
   app/localhost-coder-at-coworker`, 05:53Z) → Merged-lane stamp → GitHub
   auto-closed issue #4 → closure webhook synced back. Board shows #4 in
   **Merged**.

Also proven earlier the same night:

- **Failed/Blocked path**: run `a9410060` (issue #3) executed 20 durable
  stages (claim → Coder token → sandbox → clone → scrub → branch → context →
  Flue start) and failed at the model step during a genuine Codex quota
  outage — recorded cleanly, no retry loop, issue held by its claim.
- **Board realtime**: comment posted on GitHub appeared on the board row
  (count 3→4) within one 5s poll with no reload — webhook → store → revision
  watermark → refetch. (The poll pauses in hidden tabs by design.)
- **Serial concurrency**: `drainQueuedImplementationRuns({ limit: 1 })` — one
  Coder run at a time; verified at the drain seam plus the two live runs
  executing strictly in sequence.

## Defects found BY the live run (all fixed the same night)

1. **Issue-read token minted with the wrong app** — kick-off read the issue
   with the reviewer JWT against a Coder-only installation → 404. Fixed:
   `getGitHubIssue` threads `resolveGitHubAppWorkerRole(installation.appSlug)`
   (commit `09f95c1`).
2. **Runs pinned to the transport installation** — a kick-off from the
   board's reviewer-app repo record stored the reviewer installation on the
   run, so the worker minted a Coder JWT against the reviewer installation.
   Fixed: implementation runs resolve the Coder-app installation covering the
   repository; claims/lanes stay on the board's record (commit `25c19b9`).
3. **Cross-app webhook dedup swallowed deliveries** — GitHub sends ONE
   delivery GUID to every subscribed app; the ledger deduped by GUID, so a
   dual-installed repo lost whichever app's copy arrived second (live: the
   reviewer's `pull_request.opened` for PR #5 — no auto-review). Fixed:
   ledger keys `guid:installationId` (PR #49); the swallowed delivery was
   redelivered via `POST /app/hook/deliveries/{id}/attempts` and admitted.
   (Gotcha: delivery ids exceed JS safe integers — parse as strings.)

## Environment (as left running)

- API :3000 (`CORS_ORIGIN=http://localhost:3005 bun run dev` in apps/server),
  web :3005 (`bunx next dev --port 3005`), `bun run worker:code-reviews`,
  `bun run worker:implementations`, smee forwarder → `/api/github/webhook`.
- `local.db` switched to WAL (`PRAGMA journal_mode=WAL`) after both workers
  crashed on `SQLITE_BUSY` under the 5s revision-poll load. **Follow-up:** set
  WAL + `busy_timeout` at connection init in code.
- Migration ledger repaired: 0005 (hand-applied, unrecorded) and 0006 (never
  applied — `github_issue` tables were missing) reconciled; journal and
  `__drizzle_migrations` agree through 0009.

## Rerunning the loop

1. Seed a small issue on test-repo, label `ready for agent` (label matching is
   separator-insensitive).
2. Open the board: http://localhost:3005/app/projects/7843c9c7-9879-4492-98c5-9a7fdd87a661
   → Kick off. (hosted-agents board:
   http://localhost:3005/app/projects/50ebd641-694f-4beb-911e-cf9c50c76031)
3. Watch: Executing → In PR (with auto-review) → approve the PR → Merged.
   Babysit: request changes on the Coder's PR instead of approving — the Coder
   pushes a fix round (max 3, then Failed/Blocked); any human push/comment
   makes it yield.

## Known follow-ups (morning list)

- Reviewer verdicts are COMMENTED-only in practice; if the loop should close
  fully autonomously, the review worker needs an approve policy (product
  decision).
- Repo-record duality: claims live on the repo record the transport used;
  the board reads the reviewer-app record. Overlays for the *other* record's
  claims aren't shown (e.g. issue #3's claim from the Coder-record era).
  Consider canonicalizing repo records by fullName.
- `gpt-5.6-lunar` does not exist on the ChatGPT-account Codex backend (400);
  default pinned to verified `gpt-5.5`, requested slug recorded in
  `codex-model-policy.ts`.
- WAL + busy_timeout at connection init; `local.db` is 193MB (event/log
  growth) — consider retention.
- Production deployment: per ADR-0001, create the production Coder GitHub App
  (this run used the localhost app).
