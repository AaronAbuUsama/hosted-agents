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

If the web app is already running and you only need server plus webhooks:

```bash
bun run dev:github-webhooks
```

## Local Environment

The script reads `apps/server/.env` and `.env.braintrust`.

Required for Smee forwarding:

```env
GITHUB_WEBHOOK_PROXY_URL=https://smee.io/PC7aK4wjTehMZYZp
GITHUB_WEBHOOK_SECRET=generated_or_pasted_secret
```

If `GITHUB_WEBHOOK_SECRET` is missing, `bun run dev:localhost` generates one and appends it to `apps/server/.env`. It does not print the secret.

To copy the secret for the GitHub App form:

```bash
grep '^GITHUB_WEBHOOK_SECRET=' apps/server/.env | sed 's/^GITHUB_WEBHOOK_SECRET=//' | pbcopy
```

## GitHub App Webhook Settings

For the dev GitHub App:

- Webhook URL: `https://smee.io/PC7aK4wjTehMZYZp`
- Webhook secret: the value of `GITHUB_WEBHOOK_SECRET`
- SSL verification: enabled

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

Use no organization or account permissions for the local dev app.

Subscribe to these webhook events:

- Pull request
- Installation
- Installation repositories

`Check run` and `Check suite` are not required for the first review flow. Add them later only if the app needs to react to checks created by other systems.

## Current Local Proof

The local endpoint verifies `x-hub-signature-256`, logs the GitHub event, action, delivery id, and installation id, then returns `202`.

The next product slice turns accepted `pull_request` events into `review_run` records.
