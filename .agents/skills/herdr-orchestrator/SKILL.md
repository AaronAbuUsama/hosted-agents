---
name: herdr-orchestrator
description: Drive a fleet of herdr sessions and coding agents from one controller: spawn same-workspace tabs or panes, give work, require callback + Enter + ACK retry, monitor state, and coordinate GitButler-safe multi-agent work. Use when acting as a controller that launches, supervises, fans out, or coordinates herdr agents/sessions; when the user mentions herdr orchestration, workers, reviewers, callbacks, ACKs, tabs, panes, or multi-agent PR stacks. Requires running inside a herdr-managed pane (HERDR_ENV=1).
---

# herdr Orchestrator

Use **herdr** (a terminal-native agent multiplexer — "tmux for coding agents") as the control plane for a fleet of agents. This skill is for the **controller**: an agent that spawns other agents into panes, watches their state, coordinates them, unblocks them, and collects their results — across one or many sessions, locally or over SSH.

> This builds on herdr's official single-agent skill. The official skill teaches one agent to use herdr from inside its pane; this skill scales that up to a controller managing **many** agents/sessions.

## 0. Guardrail — check this first, every time

Before doing anything, verify you are inside herdr:

```bash
[ "$HERDR_ENV" = "1" ] || { echo "Not inside a herdr-managed pane; refusing to orchestrate."; exit 1; }
```

If `HERDR_ENV` is not `1`, you are **not** in a herdr pane — stop and say so. Never drive herdr from outside herdr. Inside a pane herdr also exports `HERDR_SOCKET_PATH`, `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, `HERDR_PANE_ID` — that is how you self-identify and find your session's socket.

## 1. Mental model (30 seconds)

Nesting: **Server → Session → Workspace → Tab → Pane → Agent**.

- **Session** — a persistent server namespace with its own socket. Default is `default`; create/select named ones with `--session <name>` or `HERDR_SESSION`. Use separate sessions to isolate the controller from worker fleets, or one fleet per project.
- **Workspace** — a project context (one repo / task / investigation). Owns tabs+panes; agent state rolls **up** (a blocked agent makes its tab+workspace look blocked).
- **Tab** — a layout inside a workspace (e.g. `agents`, `logs`, `review`).
- **Pane** — a real terminal running one process (shell, agent, server, log).
- **Agent** — a process herdr detects inside a pane; exposes one field, `agent_status`.

**`agent_status`** = `idle` | `working` | `blocked` | `done` | `unknown`.
`blocked` = needs input/approval (intervene). `done` = finished **and not yet viewed** — it flips to `idle` once you read the pane, so treat `done` as a one-shot edge, not a durable flag.

**IDs** come in two interchangeable forms the CLI both accepts:
compact (`workspace 1`, `tab 1:1`, `pane 1-1`) and long/canonical (`w654…`, `w654…:1`, `w654…-1`, terminal `term_…`). **JSON responses always return the long form plus a `number`.**

> **Hard rule:** IDs compact when panes/tabs/workspaces close. Never hardcode or cache an ID across a close. Always parse the ID out of the JSON response that created the thing, and reuse that exact string. See `references/orchestration-patterns.md`.

## 2. The orchestration loop

```
spawn → monitor → coordinate → intervene → collect → tear down
```

1. **Spawn** an agent into its own pane (and capture its `pane_id`).
2. **Monitor** state — poll with `wait`, or subscribe to socket events for push.
3. **Coordinate** — block until an agent is `done`/`blocked`, then act.
4. **Intervene** on `blocked` agents (send input / approve / redirect).
5. **Collect** results by reading the pane's scrollback.
6. **Tear down** panes/workspaces (or stop the session) when finished.

## 2.1 Controller/worker contract

Use this contract whenever you delegate work to another terminal agent (Codex, Claude, Copilot, Droid, Qoder, Cursor, or any similar TUI agent). The controller remains the source of truth; workers do the bounded task and report back.

### Controller identity

Before spawning, capture the live controller address from HERDR or by listing panes:

```bash
[ "$HERDR_ENV" = "1" ] || { echo "Not inside herdr"; exit 1; }
herdr pane list --workspace <workspace_id>
```

Record:

- `CONTROLLER_WORKSPACE`: the workspace id that should receive new tabs.
- `CONTROLLER_PANE`: the controller pane id that receives callbacks.
- `ACK_TOKEN`: a short unique token for this worker, e.g. `review-conversation-sync`.

Do not cache pane ids across tab/pane closures. If anything was closed, re-run `herdr pane list` and map by tab label before sending an ACK or callback.

### Same-workspace new tab

If the user wants a new tab, do not split panes. Create the tab in the same workspace and capture the returned `root_pane.pane_id`:

```bash
PANE=$(herdr tab create --workspace "$CONTROLLER_WORKSPACE" --label "$LABEL" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"]["root_pane"]["pane_id"])')
herdr pane run "$PANE" "$AGENT_CMD"
herdr wait output "$PANE" --source visible --match "Ready" --timeout 60000 || herdr pane read "$PANE" --source visible
herdr pane send-text "$PANE" "$PROMPT"
herdr pane send-keys "$PANE" Enter
```

Use `--no-focus` when a command supports it. If readiness markers differ by agent, wait for that agent's real ready text; do not trust `agent_status=idle` alone for TUI agents.

### Worker prompt footer

Every worker prompt must end with a callback footer like this, adapted only for ids/token/task text:

```text
Controller callback contract:
- Your ACK token is <ACK_TOKEN>.
- When finished, send a concise one-line callback to the controller pane and press Enter:
  herdr pane send-text <CONTROLLER_PANE> "DONE <task label>: <result>; checks <pass/fail summary>; blockers <none/list>; ACK_TOKEN=<ACK_TOKEN>"
  herdr pane send-keys <CONTROLLER_PANE> Enter
- After sending the callback, do not stand down until the controller acknowledges exact text: ACK <ACK_TOKEN>.
- Check your own pane for the ACK. If no ACK appears after roughly 30 seconds, resend the callback and press Enter again. Keep retrying until the ACK is received.
```

The `send-keys ... Enter` line is mandatory. A callback typed without Enter has not been delivered.

### Controller ACK

When a worker reports completion, re-resolve the current pane id for its tab, then send the exact ACK and press Enter:

```bash
herdr tab list --workspace "$CONTROLLER_WORKSPACE"
herdr pane list --workspace "$CONTROLLER_WORKSPACE"
herdr pane send-text "$WORKER_PANE" "ACK <ACK_TOKEN>"
herdr pane send-keys "$WORKER_PANE" Enter
```

After ACK, update the user with the checkpoint map and the next decision. Do not let a finished worker keep retrying callbacks because the ACK text was not delivered.

### Progress without polling

Prefer callbacks, `herdr wait`, or socket events over manual polling. If a worker can run independently, start it and continue useful controller work. Only wait when the next controller action truly depends on that worker's result.

### GitButler-safe worker instructions

When delegating repository work, include the repo's version-control rule in the prompt. If the repo uses GitButler:

- Use `but` for status, diffs, branches, commits, pushes, PRs, stack moves, and history edits.
- Do not use raw git writes (`git add`, `commit`, `push`, `checkout`, `merge`, `rebase`, `stash`, `cherry-pick`).
- Use a dedicated GitButler branch per worker unless the user explicitly asks otherwise.
- Use `but move` for stacked branches; use `but pr` for stacked PRs so PR bases and stack metadata stay correct.
- Run `but pull --check` before `but pull`; do not pull if it reports conflicts or would disturb another worker's branch.
- If work is complete, open or mark the PR ready unless the user explicitly requested a draft. Draft PRs are for unfinished or blocked work.

Worker completion reports should include branch name, commits, PR URL if created, exact checks run, pass/fail status, blockers, and whether the branch is stacked above/below related work.

### Checkpoint map

At the end of every checkpoint, print the stack/work map in plain text. Keep status language honest:

```text
main
└─ Foundation slice: REVIEWED / NO FINDINGS
   └─ Current slice: IN PROGRESS / REVIEWING / NEEDS FIX / REVIEWED
      └─ Next slice: NOT STARTED
```

Use topic names, not bare issue numbers, unless the user specifically asks for issue ids.

## 3. Core commands (cheat sheet)

```bash
# DISCOVER (all read-only, all print JSON unless noted)
herdr pane list                       # every pane in the session (agent, agent_status, ids, cwd)
herdr agent list                      # only detected agents
herdr workspace list                  # workspaces + rolled-up status
herdr session list --json             # every named session (running: true/false)

# NEW INDEPENDENT SESSION (non-interactively) — headless server, then drive with --session
nohup herdr --session fleet-a server >/tmp/fleet-a.log 2>&1 &   # poll: status --json | grep running:true
herdr --session fleet-a workspace create --cwd /repo --no-focus # then drive it exactly like the current one
herdr session stop fleet-a                                      # tears the whole fleet down
# (TUI `session attach` is interactive and blocked inside a pane; the headless server is the way.)

# SPAWN an agent in a fresh same-workspace tab, capture its pane id
PANE=$(herdr tab create --workspace <workspace> --label <label> \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"]["root_pane"]["pane_id"])')
herdr pane run "$PANE" "codex"         # or claude / copilot / any TUI agent command

# SPAWN an agent in a fresh split, capture its pane id
NEW=$(herdr pane split <target_pane> --direction right --no-focus \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"]["pane"]["pane_id"])')
herdr pane run "$NEW" "claude"        # or: herdr agent start <name> --split right -- claude
# (use scripts/spawn-agent.sh to do both steps and print the new id)

# GIVE WORK / INTERVENE
herdr pane run <pane> "<command>"     # sends text + Enter (atomic) — preferred
herdr pane send-text <pane> "<text>"  # no Enter
herdr pane send-keys <pane> Enter     # keys only
herdr agent send <target> "<text>"    # by agent name/label

# WATCH (block; exit code 1 on timeout)
herdr wait agent-status <pane> --status done --timeout 120000
herdr wait output <pane> --match "ready" --regex --timeout 30000

# READ results
herdr pane read <pane> --source recent --lines 100        # recent scrollback (rendered)
herdr pane read <pane> --source recent-unwrapped          # joined wraps — best for logs/matching

# ATTACH to one agent's terminal (drops the full UI); detach with ctrl+b q
herdr agent attach <target> [--takeover]
herdr terminal attach <terminal_id> [--takeover]

# TEAR DOWN
herdr pane close <pane>;  herdr workspace close <ws>;  herdr session stop <name>
```

Full flag reference: `references/cli.md`.

## 4. Helper scripts (`scripts/`)

Ready-to-run tools for the controller — all respect `HERDR_SOCKET_PATH`/`--session`:

| Script                                                                 | Does                                                                                                                                                                                    |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/fleet-status.sh [--all-sessions]`                             | One line per agent (id, status, cwd) across the session, or every session. Read-only.                                                                                                   |
| `scripts/spawn-agent.sh "<cmd>" [target] [right\|down] [ready_marker]` | Split, launch the agent, print the new `pane_id`. With `ready_marker`, blocks until that text is on the new pane's visible screen (e.g. `shortcuts` for Claude Code).                   |
| `scripts/await-agents.sh --status done --timeout <ms> <pane>...`       | Block until each pane reaches the status; non-zero exit lists timeouts.                                                                                                                 |
| `scripts/watch-status.py [--seconds N] [pane_id...]`                   | Stream socket events (push): global pane lifecycle + `agent_status_changed` for each given pane. The event-driven alternative to polling.                                               |
| `scripts/fleet.sh [--per-window K] [--cleanup] "task1" "task2" ...`    | Fan a task list out across Claude agents in **dedicated worker workspaces** (≤4 per window, 2×2 grid), wait for all to finish. Workers go in their own windows, never the controller's. |

All five are **verified working** against herdr 0.6.8 (spawn Claude → drive → catch `done`; live event stream; 5-agent fan-out across 2 windows).

## 5. CLI vs socket API — pick the right layer

- **CLI** (this binary, `herdr ...`) is the default for spawning, sending, reading, and one-shot `wait`s. Most commands print JSON for deterministic parsing.
- **Socket API** (newline-delimited JSON over `$HERDR_SOCKET_PATH`) is for what the CLI can't do: **`events.subscribe`** (push notifications instead of polling — react the instant any agent goes `blocked`), plus pane geometry (`pane.swap/move/zoom`), `layout.export/apply`, and `notification.show`. Prefer events over polling when supervising more than a handful of agents. See `references/socket-api.md`.

> Version note: this binary is herdr **0.6.8 (protocol 12)**. Some commands in the public docs (`pane swap/move/zoom`, `agent explain`, `notification show`) are **socket-API-only** here — they are not CLI subcommands yet. Confirm with `herdr <group> --help` / `herdr status --json` before relying on a command.

## 6. References (read on demand)

- `references/orchestration-patterns.md` — **the meat**: fan-out/fan-in, event-driven monitor loop, blocked-agent intervention, worktree-isolated fleets, multi-session control, continuity across restarts, remote/SSH orchestration. Read this when designing any multi-agent flow.
- `references/cli.md` — every CLI command + flags + ID semantics + injected env vars.
- `references/socket-api.md` — socket transport, methods, events, error codes, raw examples.
- `references/agents-and-state.md` — agent detection, `agent_status` semantics, integrations (lifecycle-authority vs session-identity agents), injecting custom state. Read before trusting state for non-Claude agents.

## 7. Hard rules (several verified live against herdr 0.6.8)

- **`HERDR_ENV=1` or stop.** Don't orchestrate from outside herdr.
- **Re-read IDs; never cache across a close.** Parse them from JSON responses. (Verified: a cached `…-3` became `…-2` after a sibling closed.)
- **`--no-focus`** on every `split` / `tab create` / `workspace create` — never steal focus from yourself while orchestrating.
- **Readiness ≠ `agent-status idle` for interactive TUI agents.** Verified: herdr false-detects the agent from the typed command word, so `idle` reports _before_ the agent can accept input. Wait for the real UI marker: `herdr wait output "$P" --source visible --match "shortcuts"` (Claude Code), then send the task.
- **Read TUI agents with `--source visible`** — alt-screen apps (Claude Code) have no scrollback, so `recent`/`recent-unwrapped` come back empty.
- **`wait` exits 1 on timeout** — always check the exit code; don't assume success.
- **`wait output` matches the echoed command too** — `pane run` puts the command in the buffer, so pick a match string that only appears in real _output_ (not in what you sent).
- **`pane read` prints TEXT**, not JSON. `send-text`/`send-keys`/`run` print **nothing** on success. Only the structural/query commands print JSON.
- **`done` is transient (~1s, verified)** then flips to `idle` — capture it on the `wait`/event edge, never re-poll for it.
- **`idle` ≠ finished** for screen-detected agents (Claude, Codex, Copilot, Droid, Qoder, Cursor) — unmatched states fall back to `idle`. Confirm by reading the pane.
- **New named session = headless server**, not TUI attach: `nohup herdr --session <name> server &` (attach is interactive and nested-launch-blocked inside a pane).
- **Don't run tmux/screen inside a pane** — herdr then sees the multiplexer, not the agent, and detection breaks.
