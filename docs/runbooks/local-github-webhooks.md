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
- the Smee forwarder

Before testing webhook admission against a durable local database, apply the
committed Drizzle migrations:

```bash
bun run db:migrate
```

Use `bun run db:push` only for disposable local databases. Production and
Dokploy deploys use `bun run db:migrate`; see `docs/runbooks/database-migrations.md`.

If the web app is already running and you only need server plus webhooks:

```bash
bun run dev:github-webhooks
```

## Local Environment

The script reads `~/.config/hosted-agents/secrets.env`, `apps/server/.env`, and `.env.braintrust`. If local secrets still use the old `DATONA_API_KEY` / `DATONA_API_URL` spelling, the dev script aliases them to `DAYTONA_API_KEY` / `DAYTONA_API_URL` before starting the server.

Required for Smee forwarding:

```env
GITHUB_WEBHOOK_PROXY_URL=https://smee.io/PC7aK4wjTehMZYZp
GITHUB_WEBHOOK_SECRET=generated_or_pasted_secret
```

Required for local GitHub App OAuth, installation validation, and installation tokens:

```env
GITHUB_APP_ID=4223358
GITHUB_APP_SLUG=localhost-abu-bakr-at-coworker
GITHUB_APP_PRIVATE_KEY_PATH=/Users/abuusama/Downloads/localhost-abu-bakr-at-coworker.2026-07-05.private-key.pem
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
repository to a Coworker organization, and creating one queued `review_run` with
PR metadata. Duplicate delivery ids return `202` without creating another run.

The Hono server remains the control plane. Agent execution is not run in the
service container; the execution-plane path is Daytona through Flue.
