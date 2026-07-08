# Coworker UI v2 — Reviewer-first product definition

Status: Active. Supersedes `COWORKER_UI_REDESIGN_PLAN.md` (the persona-era
scaffold plan). Aligned 2026-07-08.

## Framing

Coworker is a control room for AI workers that operate inside GitHub. There
are no named personas in the product surface: the durable identity is the
**worker role** (`code_review` today, implementation later), per the
worker-roster PRD. A display name is one configurable field, not an identity.

The product loop: a PR opens (or a human asks) → the Reviewer runs in a
sandbox → the team reads **what happened** (report) and, when needed, **how
it happened** (workspace).

## Surfaces

### Session rail

`/setup` is the single post-auth entry. It resolves the first missing setup
step (organization → GitHub installation → provider credential) or lands on
`/app/runs`. Login and signup both use it; a fully set-up user never sees
onboarding again. The runs page soft-gates a missing provider credential
with a banner instead of redirecting, so deep links keep working.

### Onboarding — three real steps

`OnboardingStep` shell with an explicit `step` prop (1 Organization,
2 GitHub, 3 Provider). The GitHub step is `/dashboard/github/setup` (also
the GitHub App callback landing), rendered inside the shared shell. The old
`/onboarding/github` wizard is a redirect.

### Runs (`/app/runs`)

Grouped-by-status table. Human titles, whole-row click, findings-count
token in the result column (red = high severity present, green = none).

### Run report (`/app/runs/[id]`) — what happened

Tabs: **Review** (default) · Timeline · GitHub.

- Review: summary + structured findings (severity token, `file:line`,
  detail, recommendation) + link to the GitHub review.
- Failed runs show an error banner in the header on every tab.
- Timeline shows lifecycle milestones only. Raw Flue protocol events
  (message/turn/thinking frames) never appear here.

### Run workspace (`/app/runs/[id]/workspace`) — how it happened

Session transcript center stage (prompt, reasoning, tool calls, results).
Right panel: run facts + artifact list; selecting an artifact swaps the
panel into a viewer. No IDE chrome — that grammar belongs to worker
configuration, and later to live sandbox inspection.

### Reviewer (`/app/reviewer`) — the worker page

Per the PRD: configuration, history, and manual-run controls; read-only
navigation never starts work.

- Left: skills tree (named instruction files) + base prompt entry.
- Center: editor for the selected skill or the base prompt
  (display name, model id, review guidance).
- Right: worker facts (effective name/model, triggers, repo scope, skill
  count).
- **Request review**: pick an enabled repository → list open PRs → queue a
  manual `agent_run` (same pipeline as the webhook path).

### Settings (`/app/settings`)

Live org/GitHub/provider state, per-repository enable toggles (webhook
honors `github_repository.selected`), links out to the Reviewer page and
setup flows. No mock sections.

## Configuration model

- `worker_config` (org + role): `display_name`, `model`, `instructions`.
- `worker_skill` (org + role + name): markdown content, `enabled` flag.
- The role adapter owns the fixed protocol (GitHub tools, structured
  findings schema, check completion). Org config appends guidance; enabled
  skills upload into the sandbox under `skills/` and the agent is told to
  read them. The resolved model is persisted on `agent_run.model`.

## Explicitly out (for now)

Rules engine beyond skills/prompt, billing, the implementation worker's UI,
marketing page content, token/cost capture (needs Flue usage extraction),
live run streaming in the workspace.
