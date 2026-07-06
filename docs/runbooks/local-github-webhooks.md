# Local GitHub Webhooks

Use Smee to forward GitHub App webhooks into the local Hono server.

## Local Command

Run the full local stack:

```bash
bun run dev:localhost
```

That command starts:

- the Next web app
- the Flue/Hono server
- the code-review worker that drains queued GitHub agent runs into Daytona
- the Smee forwarder

Before testing webhook admission against a durable local database, apply the
committed Drizzle migrations:

```bash
bun run db:migrate
bun run proof:preflight
```

Use `bun run db:push` only for disposable local databases. Production and
Dokploy deploys use `bun run db:migrate`; see `docs/runbooks/database-migrations.md`.

If the web app is already running and you only need server plus webhooks:

```bash
bun run dev:github-webhooks
```

To run the review worker once against already-queued GitHub agent runs:

```bash
bun run worker:code-reviews -- --once
```

Pass `--no-worker` to `bun run dev:localhost` when you only want webhook
admission and do not want queued reviews to start executing.

The worker launcher runs the same private-key readability preflight before it
starts polling. If the key is still in a macOS-protected Downloads location,
move it to a terminal-readable path or set `GITHUB_APP_PRIVATE_KEY` before
triggering another real PR webhook.

The current local key copy is:

```text
/Users/abuusama/.config/hosted-agents/localhost-abu-bakr-at-coworker.2026-07-05.private-key.pem
```

## Real PR Proof Watcher

In a second terminal, wait on durable run/event state for the linked proof repo:

```bash
bun run proof:real-pr -- --repo AaronAbuUsama/test-repo
```

If you know the pull request number:

```bash
bun run proof:real-pr -- --repo AaronAbuUsama/test-repo --pr 1
```

To require real GitHub output proof, including fetching the bot-created start
comment, pull request review, and check run back from GitHub, add:

```bash
bun run proof:real-pr -- --repo AaronAbuUsama/test-repo --pr 1 --require-completed --require-github-output
```

The watcher does not post payloads, replay fixtures, or call admission functions.
It only reads `agent_run`, `agent_run_event`, and `agent_run_sandbox` rows that
were produced by the real webhook/worker path. When Daytona credentials are
available, it also lists Daytona sandboxes by the run labels and fails if any
matching sandbox remains after the run reaches a terminal state.

## Local Environment

The local scripts read `~/.config/hosted-agents/secrets.env`, `apps/server/.env`, and `.env.braintrust`. If local secrets still use the old `DATONA_API_KEY` / `DATONA_API_URL` spelling, they alias them to `DAYTONA_API_KEY` / `DAYTONA_API_URL` before starting the server or worker.

Required for Smee forwarding:

```env
GITHUB_WEBHOOK_PROXY_URL=https://smee.io/PC7aK4wjTehMZYZp
GITHUB_WEBHOOK_SECRET=generated_or_pasted_secret
```

Required for local GitHub App OAuth, installation validation, and installation tokens:

```env
GITHUB_APP_ID=4223358
GITHUB_APP_SLUG=localhost-abu-bakr-at-coworker
GITHUB_APP_PRIVATE_KEY_PATH=/Users/abuusama/.config/hosted-agents/localhost-abu-bakr-at-coworker.2026-07-05.private-key.pem
GITHUB_CLIENT_ID=Iv23lijISDNLQhWZFgIL
GITHUB_CLIENT_SECRET=local_client_secret
```

Use `GITHUB_APP_PRIVATE_KEY` instead of `GITHUB_APP_PRIVATE_KEY_PATH` in deployed
environments.

If `GITHUB_WEBHOOK_SECRET` is missing, `bun run dev:localhost` generates one and appends it to `apps/server/.env`. It does not print the secret.

To copy the secret for the GitHub App form:

```bash
grep '^GITHUB_WEBHOOK_SECRET=' apps/server/.env | sed 's/^GITHUB_WEBHOOK_SECRET=//' | pbcopy
```

## GitHub App Webhook Settings

For the dev GitHub App:

- Homepage URL: `http://localhost:3001`
- Callback URL: `http://localhost:3000/api/auth/callback/github`
- Setup URL: `http://localhost:3001/dashboard/github/setup`
- Webhook URL: `https://smee.io/PC7aK4wjTehMZYZp`
- Webhook secret: the value of `GITHUB_WEBHOOK_SECRET`
- SSL verification: enabled
- Request user authorization during installation: disabled
- Redirect on update: enabled

OAuth sign-in and GitHub App installation are separate flows. The callback URL is
for `Continue with GitHub`; App installation completion should go to the setup
URL.

The local server receives forwarded webhooks at:

```text
http://localhost:3000/api/github/webhook
```

## GitHub App Permissions

Minimum repository permissions for the code review agent:

- Metadata: Read-only
- Contents: Read-only
- Pull requests: Read and write
- Checks: Read and write
- Commit statuses: Read and write

Account permissions:

- Email addresses: Read-only

Use no organization permissions for the local dev app.

Subscribe to these webhook events:

- Pull request
- Installation
- Installation repositories

`Check run` and `Check suite` are not required for the first review flow. Add them later only if the app needs to react to checks created by other systems.

## Current Local Proof

The local endpoint is backed by Flue's GitHub channel. It verifies
`x-hub-signature-256` against the exact JSON body, rejects invalid signatures, and
returns `202` after admission decisions.

Verified `pull_request` deliveries with action `opened`, `reopened`,
`synchronize`, or `ready_for_review` are admitted by claiming
`X-GitHub-Delivery` in the database, resolving the GitHub installation and
repository to a Coworker organization, and creating one queued `agent_run` with
PR metadata plus initial durable `agent_run_event` rows. Duplicate delivery ids
return `202` without creating another run.

The Hono server remains the control plane. Agent execution is not run in the
service container; the execution-plane path is Daytona through Flue.

The local worker now claims queued GitHub-origin agent runs, mints a short-lived
GitHub App installation token, creates a Daytona sandbox, clones and fetches the
pull request refs inside that sandbox, stages review context, runs the
`code_review` worker through Flue/Codex with Daytona as the workspace, and gives
the Flue agent
bounded GitHub tools for posting the start comment, submitting the pull request
review, posting fallback PR comments, and completing the check run. Tool calls,
tool results, output refs, summary, findings, artifacts, execution logs, sandbox
provider/id, sandbox lifecycle, Flue events, stage heartbeats, and result events
are persisted back onto the `agent_run` tables.

The worker is covered by a fake-runner regression test. The full proof still
depends on a real GitHub PR webhook arriving through Smee, a linked GitHub
installation for `AaronAbuUsama/test-repo`, a selected repository, valid Daytona
credentials, and the worker completing or failing with durable events visible via
the API.

## Completed Real PR Proof

On July 6, 2026, the local proof path completed from a real Smee-delivered
`pull_request.synchronize` event for `AaronAbuUsama/test-repo` PR #1:

```text
agent_run: b24bf28e-93c2-4597-8372-4186a6118d0c
sandboxId: 27b2deed-b504-4690-8959-804442b17b40
status: completed
durable events: 68 ordered rows
first event: github.webhook.accepted
sandbox event: sandbox.created recorded sandboxId immediately
last event: result.completed
cleanup: sandbox.deleted and Daytona orphan check passed
API proof: agentRuns listed the run, agentRunEvents returned all 68 events
```

Later the same day, after adding Flue-native GitHub tools, a real commit was
pushed to PR #1 and another real `pull_request.synchronize` event completed with
actual GitHub bot output:

```text
commit: 031715f
agent_run: e44b8522-ea95-4ca9-8a15-6f522cde7f43
sandboxId: fe4f6fbd-2375-4eba-9733-ed8d18fde4ff
status: completed
durable events: 106 ordered rows
GitHub start comment: https://github.com/AaronAbuUsama/test-repo/pull/1#issuecomment-4891614140
GitHub PR review: https://github.com/AaronAbuUsama/test-repo/pull/1#pullrequestreview-4634864096
GitHub check run: https://github.com/AaronAbuUsama/test-repo/runs/85346920073
check conclusion: success
bot: localhost-abu-bakr-at-coworker[bot]
cleanup: sandbox.deleted and Daytona orphan check passed
API proof: agentRuns listed the run, agentRunEvents returned all 106 events
GitHub output proof: proof watcher fetched comment/review/check back from GitHub by ID
```

The proof watcher is still the repeatable check. It must observe rows produced
by a real GitHub delivery; direct function calls and fixture replay are not
accepted as end-to-end proof.
