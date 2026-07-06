# Code Review Worker Real PR E2E Goal Prompt

Note: this proof was originally run through a local GitHub App whose display
name and slug included `Abu Bakr`. Runtime code should now use
`workerRole=code_review` plus `workerDisplayName` for user-defined naming.
Personal names are not backend module identity.

We are in `/Users/abuusama/projects/capxul-alpha/hosted-agents`.

Run this as a deterministic end-to-end proof goal.

## Objective

Prove the code review worker can run a real code-review workflow end-to-end
from a real GitHub PR webhook through Hono, Flue, Daytona, and Codex, with
durable run events available for the UI.

## Operator Setup

The localhost Abu Bakr GitHub App is installed on this linked proof repo:

```text
AaronAbuUsama/test-repo
```

Use that repo for the real PR proof unless current GitHub installation records contradict it.

Current proof PR:

```text
https://github.com/AaronAbuUsama/test-repo/pull/1
```

The first real `pull_request.opened` webhook for PR #1 was received through
Smee and created durable run events. It failed before Daytona creation because
the worker could not read the key from the macOS-protected Downloads path:

```text
/Users/abuusama/Downloads/localhost-abu-bakr-at-coworker.2026-07-05.private-key.pem
```

The observed durable failure was:

```text
EPERM: operation not permitted, open '/Users/abuusama/Downloads/localhost-abu-bakr-at-coworker.2026-07-05.private-key.pem'
```

That blocker was resolved by copying the key to a terminal-readable path:

```text
/Users/abuusama/.config/hosted-agents/localhost-abu-bakr-at-coworker.2026-07-05.private-key.pem
```

`apps/server/.env` now points `GITHUB_APP_PRIVATE_KEY_PATH` at that readable
copy for local runs.

On July 6, 2026, a real `pull_request.synchronize` webhook for PR #1 arrived
through Smee and completed the proof:

```text
agent_run: b24bf28e-93c2-4597-8372-4186a6118d0c
sandboxId: 27b2deed-b504-4690-8959-804442b17b40
status: completed
durable events: 68 ordered agent_run_event rows
first event: github.webhook.accepted
last event: result.completed
Daytona cleanup: sandbox.deleted, no matching orphaned sandbox remained
API proof: agentRuns listed the run, agentRunEvents returned all 68 events
```

Later on July 6, 2026, after adding Flue-native GitHub posting tools, another
real sync commit on PR #1 completed the product proof with real GitHub bot
output:

```text
commit: 031715f
agent_run: e44b8522-ea95-4ca9-8a15-6f522cde7f43
sandboxId: fe4f6fbd-2375-4eba-9733-ed8d18fde4ff
status: completed
durable events: 106 ordered agent_run_event rows
GitHub start comment: https://github.com/AaronAbuUsama/test-repo/pull/1#issuecomment-4891614140
GitHub PR review: https://github.com/AaronAbuUsama/test-repo/pull/1#pullrequestreview-4634864096
GitHub check run: https://github.com/AaronAbuUsama/test-repo/runs/85346920073
check conclusion: success
bot: localhost-abu-bakr-at-coworker[bot]
Daytona cleanup: sandbox.deleted, no matching orphaned sandbox remained
API proof: agentRuns listed the run, agentRunEvents returned all 106 events
GitHub output proof: proof watcher fetched comment/review/check back from GitHub by ID
```

During that proof, concurrent Flue callbacks exposed a duplicate event sequence
race. The event append helper now serializes appends per run, and migration
`0003_tricky_vulcan.sql` resequences existing events before creating a unique
`run_id`/`sequence` index.

## Hard Constraints

- Do not claim success from fake PR payloads, direct function calls, fixture replay, synthetic events, or terminal-only logs.
- Completion proof must use a real GitHub PR event delivered through Smee.
- Use GitButler for version control. Do not push unless asked.
- Docker/Dokploy is only the service deployment plane. Agent execution happens in Daytona sandboxes.
- Keep UI work minimal: backend/API/event surfaces only, enough for the separate UI worktree.
- Use Flue correctly. Re-read Flue workflow, React, observability, sandboxes, Daytona adapter, GitHub channel, skills, and subagents docs before changing runner code.

## Accepted Planning Decisions

- Introduce generic runtime tables now: `agent_runs`, `agent_run_events`, `agent_run_artifacts`, `agent_run_sandboxes`.
- Treat code review as one agent run type, not the whole runtime model.
- Keep `review_run` only as legacy/manual compatibility if needed.
- Prefer a real Flue workflow for the code review worker so run events can use official Flue run/event surfaces.
- UI should consume app-owned run events, with selected Flue event payloads attached.

## Implementation Outcomes

- Persist sandbox lifecycle events.
- Persist Flue/model/tool/result events or the closest official Flue event stream.
- Persist `sandboxId` immediately after Daytona sandbox creation.
- Add heartbeat/stage updates.
- Add stale `running` run recovery.
- Clean orphaned Daytona sandboxes by labels.
- Add minimal run list/detail/events API.
- Add deterministic local proof loop using Smee and a real GitHub PR.
- Tests, typecheck, and migrations must pass.

## Local Proof Commands

Start/reuse the Hono/Flue server at `localhost:3000`, then run:

```bash
bun run db:migrate
bun run proof:preflight
bun run worker:code-reviews
npx --yes smee-client -u https://smee.io/PC7aK4wjTehMZYZp -t http://localhost:3000/api/github/webhook
bun run proof:real-pr -- --repo AaronAbuUsama/test-repo --pr 1 --require-completed --require-github-output
```

Do not use the watcher as proof unless it observes events created from a real
GitHub webhook delivery.

`bun run proof:preflight` must pass before syncing PR #1 again. It currently
fails if the GitHub App key points at an unreadable path.

## Completion Proof Checklist

- Real GitHub PR webhook arrives through Smee.
- Hono/Flue GitHub channel verifies/adopts it.
- A queued `agent_run` is created.
- Worker claims it.
- Daytona sandbox is created and `sandboxId` is recorded immediately.
- Durable run events appear while executing.
- Flue/Codex review completes or fails with durable explanatory events.
- The code review worker calls bounded Flue GitHub tools to post the start comment, submit the PR review, and complete the check run.
- Proof watcher can fetch the bot-created GitHub comment, review, and check run back from GitHub by ID.
- Daytona sandbox is deleted or cleanup reports exact failure.
- No orphaned Daytona sandbox remains for the run labels.
- API/dashboard surface can list the run and events.
- Tests/typecheck/migrations pass.
