# Adopt Abu Bakr Locally

This runbook takes a local developer from a clean checkout to a linked GitHub App
installation for Abu Bakr at Coworker.

## Current Boundary

Proven now:

- local Hono/Flue server starts on Node
- Next app starts on `http://localhost:3001`
- Smee forwards GitHub webhooks to `http://localhost:3000/api/github/webhook`
- webhook signatures are verified
- GitHub App private key auth works
- a Coworker organization can generate an org-scoped GitHub App install URL
- GitHub redirects back to `/dashboard/github/setup`
- the setup page can claim and store an installation after GitHub grants one

Not implemented yet:

- automatic pull request events creating `review_run` rows
- branch wildcard trigger rules
- sandbox-backed review execution
- GitHub check runs, blocking checks, or inline PR comments

Until those slices land, the GitHub App install flow proves repository access and
event ingress. Manual dashboard reviews remain a development fallback only.

## Local Prerequisites

The local GitHub App is:

- App name: `[LOCALHOST]: Abu Bakr at Coworker`
- App id: `4223358`
- App slug: `localhost-abu-bakr-at-coworker`
- Client id: `Iv23lijISDNLQhWZFgIL`

The private key should exist locally at:

```text
/Users/abuusama/Downloads/localhost-abu-bakr-at-coworker.2026-07-05.private-key.pem
```

The ignored local server env is `apps/server/.env`. It should contain:

```env
GITHUB_WEBHOOK_PROXY_URL=https://smee.io/PC7aK4wjTehMZYZp
GITHUB_WEBHOOK_SECRET=generated_or_pasted_secret
GITHUB_APP_ID=4223358
GITHUB_APP_SLUG=localhost-abu-bakr-at-coworker
GITHUB_APP_PRIVATE_KEY_PATH=/Users/abuusama/Downloads/localhost-abu-bakr-at-coworker.2026-07-05.private-key.pem
GITHUB_CLIENT_ID=Iv23lijISDNLQhWZFgIL
GITHUB_CLIENT_SECRET=local_client_secret
```

Do not commit the real client secret or private key.

## GitHub App Settings

In GitHub Developer Settings, configure the local app with:

- Homepage URL: `http://localhost:3001`
- Callback URL: `http://localhost:3000/api/auth/callback/github`
- Setup URL: `http://localhost:3001/dashboard/github/setup`
- Webhook URL: `https://smee.io/PC7aK4wjTehMZYZp`
- Webhook secret: the value from `apps/server/.env`
- Request user authorization during installation: enabled
- Redirect on update: enabled
- SSL verification: enabled

Copy the local webhook secret with:

```bash
grep '^GITHUB_WEBHOOK_SECRET=' apps/server/.env | sed 's/^GITHUB_WEBHOOK_SECRET=//' | pbcopy
```

Minimum permissions for Abu Bakr:

- Repository metadata: read-only
- Contents: read-only
- Pull requests: read and write
- Checks: read and write
- Commit statuses: read and write
- Account email addresses: read-only

Subscribe to these events:

- Pull request
- Installation
- Installation repositories

## Start Locally

Run:

```bash
bun run db:push
bun run dev:localhost
```

Expected services:

- web: `http://localhost:3001`
- server: `http://localhost:3000`
- webhook target: `http://localhost:3000/api/github/webhook`
- Smee source: `https://smee.io/PC7aK4wjTehMZYZp`

The dev script starts the web app, server, and Smee forwarder together.

## Adopt In The Web App

1. Open `http://localhost:3001/login`.
2. Sign up or sign in. GitHub OAuth is available, but email/password is still
   useful for local testing.
3. Create a Coworker organization.
4. Connect OpenAI Codex from the Provider Connections card.
5. In the GitHub App card, click `Install`.
6. On GitHub, select the account or organization and the repositories Abu Bakr
   may access.
7. Confirm the installation grant.
8. GitHub should redirect to:

```text
http://localhost:3001/dashboard/github/setup?installation_id=...&setup_action=install&state=...
```

9. The setup page claims the installation and redirects you back to the
   dashboard.
10. The GitHub App card should show the installation as connected with a repo
    count.

The `state` query parameter is the Coworker organization id. That is how the
setup page links the GitHub installation to the selected organization.

## Validate The Local Plumbing

Health checks:

```bash
curl -fsS http://localhost:3000/
curl -fsS http://localhost:3000/api/github/webhook
```

Expected output:

```text
OK
{"ok":true,"endpoint":"github-webhook"}
```

The server log should show Flue registering:

```text
Agents:      code-review
Workflows:   code-review
```

Smee should show:

```text
Connected to https://smee.io/PC7aK4wjTehMZYZp
Forwarding https://smee.io/PC7aK4wjTehMZYZp to http://localhost:3000/api/github/webhook
```

## Next Implementation Slice

After installation is proven, the next slice is:

1. Store webhook deliveries idempotently.
2. Resolve `installation.id` to the Coworker organization and GitHub repository.
3. Add branch wildcard trigger rules.
4. Create `review_run` rows from accepted `pull_request` events.
5. Enqueue the run into a sandbox worker, not the Hono request process.
6. Mint a short-lived GitHub installation token per run.
7. Run Abu Bakr in the sandbox with the organization Codex credential.
8. Post a GitHub check and review output as Abu Bakr.
