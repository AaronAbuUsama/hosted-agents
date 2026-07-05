# Orchestration patterns

Concrete recipes for a controller agent managing a fleet. All assume `HERDR_ENV=1`.
IDs in examples use the compact form (`1-1`); the CLI also accepts the long form returned in JSON. **Always parse the real ID from the response and reuse it.**

---

## Parsing IDs (the one thing you must get right)

IDs are ephemeral handles, not stable keys — they compact when things close. The only safe pattern is: create → parse the ID from the JSON → store in a variable → use that variable.

```bash
# pane split  -> result.pane.pane_id
NEW=$(herdr pane split 1-1 --direction right --no-focus \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"]["pane"]["pane_id"])')

# workspace create -> result.workspace.workspace_id, result.tab.tab_id, result.root_pane.pane_id
read WS TAB ROOT < <(herdr workspace create --cwd /repo --label api --no-focus \
  | python3 -c 'import sys,json;r=json.load(sys.stdin)["result"];print(r["workspace"]["workspace_id"],r["tab"]["tab_id"],r["root_pane"]["pane_id"])')

# tab create -> result.tab.tab_id, result.root_pane.pane_id
```

Re-derive an ID you didn't capture by querying and filtering:

```bash
# the controller's own pane (focused:true)
herdr pane list | python3 -c 'import sys,json
for p in json.load(sys.stdin)["result"]["panes"]:
    if p.get("focused"): print(p["pane_id"])'
```

---

## Pattern: spawn one sub-agent and hand it a task  (TESTED end-to-end)

The trap: an interactive TUI agent (Claude Code, etc.) takes ~1-3s to boot, and herdr
**false-detects the agent from the literal command word** — so `wait agent-status idle`
returns "ready" *before the TUI can accept input*. **Do not trust agent-status for readiness.**
Wait for the agent's real on-screen ready marker instead.

```bash
# 1) split, capture the new pane id
P=$(herdr pane split 1-1 --direction right --no-focus \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"]["pane"]["pane_id"])')

# 2) launch the agent. pane run sends text+Enter; this works. (send-text + send-keys Enter also works.)
herdr pane run "$P" "claude"

# 3) READINESS: wait for the agent's actual UI, read from the VISIBLE screen (TUIs have no scrollback).
#    Claude Code shows "? for shortcuts" once its input box is ready.
herdr wait output "$P" --source visible --match "shortcuts" --timeout 30000

# 4) send the task (explicit, reliable)
herdr pane send-text "$P" "review test coverage in src/api/ and report gaps"
herdr pane send-keys "$P" Enter

# 5) DONE CALLBACK: block until it finishes the turn (see done-is-transient note below)
herdr wait agent-status "$P" --status done --timeout 600000

# 6) collect — VISIBLE screen for a TUI agent (recent/recent-unwrapped are empty for alt-screen apps)
herdr pane read "$P" --source visible --lines 40

# alt: agent start places the agent directly; everything after -- is the launch command
herdr agent start reviewer --cwd /repo --split right --no-focus -- claude
```

`--cwd`, `--workspace <id>`, `--tab <id>`, `--split right|down`, `--env K=V`, `--focus|--no-focus` all control placement. Name the agent (`agent start <name>` or `agent rename <pane> <name>`) so you can target it by name later instead of by fragile ID.

> **`done` is transient.** Verified live: status goes `working → done → idle`, and `done` lasts only ~1s before flipping to `idle` (it clears once "seen"). Catch it on the `wait agent-status done` edge or via a socket event — never poll for it to persist. If you might miss the edge, wait for `idle` after a known `working`, or use an output sentinel that only your agent's *answer* contains.

---

## Pattern: fan-out / fan-in (the core multi-agent move)

Launch N agents, let them work in parallel, then join on each finishing.

```bash
set -euo pipefail
ROOT=1-1
declare -a PANES=()
TASKS=("refactor auth in src/auth" "add tests for src/api" "update docs in docs/")

# fan out — each agent in its own pane, none stealing focus
for t in "${TASKS[@]}"; do
  P=$(herdr pane split "$ROOT" --direction down --no-focus \
    | python3 -c 'import sys,json;print(json.load(sys.stdin)["result"]["pane"]["pane_id"])')
  herdr pane run "$P" "claude"
  herdr wait output "$P" --match ">" --timeout 20000
  herdr pane run "$P" "$t"
  PANES+=("$P")
done

# fan in — block on each; wait returns 1 on timeout, so record stragglers
done_ok=(); timed_out=()
for P in "${PANES[@]}"; do
  if herdr wait agent-status "$P" --status done --timeout 600000; then
    done_ok+=("$P"); herdr pane read "$P" --source recent --lines 120
  else
    timed_out+=("$P")
  fi
done
echo "done: ${done_ok[*]:-none} | timed out: ${timed_out[*]:-none}"
```

Notes:
- `wait agent-status ... --status done` catches the **edge** when each agent finishes; reading the pane clears `done` → `idle`, so read immediately after the wait returns.
- Waiting sequentially still parallelizes the *work* — every agent runs concurrently; you just collect in order. Total wall-clock ≈ the slowest agent.
- For true push-based joining (react the moment *any* agent finishes or blocks), use the event loop below.

---

## Pattern: fleet topology — workers in their own windows, ≤4 per window (TESTED)

Put workers in **dedicated workspaces** (their own "windows" in the sidebar), never the controller's, and cap each window at **4 agents** as a 2×2 grid. **Verified:** 4+ agents *stacked as splits in one pane* shrink to ~1/8 height, and a TUI agent in a too-small pane silently never receives the dispatched task (it never goes `working`). A 2×2 grid gives half-height panes, which works. So scale with **more windows, not more splits**.

```bash
jq_pane() { python3 -c 'import sys,json;print(json.load(sys.stdin)["result"]["pane"]["pane_id"])'; }
# one window (workspace) holding up to 4 agents in a 2x2 grid, off the controller's focus
read FWS R0 < <(herdr workspace create --cwd /repo --label fleet1 --no-focus \
  | python3 -c 'import sys,json;r=json.load(sys.stdin)["result"];print(r["workspace"]["workspace_id"], r["root_pane"]["pane_id"])')
A0="$R0"
A1=$(herdr pane split "$R0" --direction right --no-focus | jq_pane)   # top-right
A2=$(herdr pane split "$R0" --direction down  --no-focus | jq_pane)   # bottom-left
A3=$(herdr pane split "$A1" --direction down  --no-focus | jq_pane)   # bottom-right
for P in "$A0" "$A1" "$A2" "$A3"; do herdr pane run "$P" "claude"; done
for P in "$A0" "$A1" "$A2" "$A3"; do herdr wait output "$P" --source visible --match "shortcuts" --timeout 35000; done
# ...dispatch + fan-in per pane...
herdr workspace close "$FWS"     # tear down the whole window in one call (controller untouched)
```

For N agents, create ⌈N/4⌉ windows and fill each. The bundled **`scripts/fleet.sh "task1" "task2" ...`** does exactly this (dedicated workspaces, ≤4 per window, ready-gate, dispatch, concurrent fan-in; `--cleanup` to close them after) — verified live with a 5-agent run spanning two windows.

**Robust fleet fan-in:** start each agent's wait **concurrently** right after dispatch, and wait for `working` (proves the task landed) then `idle` (finished). `idle` is stable; `done` is ~1s-transient and easy to miss across many agents:

```bash
fanwait(){ herdr wait agent-status "$1" --status working --timeout 30000 \
        && herdr wait agent-status "$1" --status idle --timeout 600000; }
for P in "${PANES[@]}"; do fanwait "$P" & done; wait
```

## Pattern: event-driven monitor (push, not poll)

When supervising more than a handful of agents, subscribe to the socket instead of polling. The connection stays open and streams newline-delimited event objects.

```bash
# react the instant ANY pane goes blocked or done
printf '%s\n' '{"id":"sub","method":"events.subscribe","params":{"subscriptions":[
  {"type":"pane.agent_status_changed"}]}}' \
  | nc -U "$HERDR_SOCKET_PATH" \
  | while IFS= read -r line; do
      echo "$line" | python3 -c '
import sys,json
e=json.loads(sys.stdin.read())
ev=e.get("event") or e.get("result",{})
pid=ev.get("pane_id"); st=ev.get("agent_status")
if st in ("blocked","done"): print(f"ACT pid={pid} status={st}")
'
    done
```

Or use the bundled tool (cleaner than `nc`): **`scripts/watch-status.py [--seconds N] <pane_id>...`** streams global lifecycle events + `agent_status_changed` for each pane you pass.

Useful event types (see `socket-api.md`): `pane.agent_status_changed`, `pane.output_matched`, `pane.created/closed/exited/agent_detected`, `workspace.*`, `worktree.*`. The first response acks; subsequent lines are events shaped `{"event":...,"data":{...}}`. **Verified:** `agent_status_changed`/`output_matched` require a `pane_id` in the subscription; the lifecycle events take none and stream for all panes. (`nc -U` is one transport; any unix-socket client works.)

---

## Pattern: intervene on a blocked agent

`blocked` means the agent is waiting on input/approval/a decision.

```bash
herdr wait agent-status "$P" --status blocked --timeout 0   # 0 = wait indefinitely
herdr pane read "$P" --source recent-unwrapped --lines 40   # see exactly what it's asking
herdr pane run  "$P" "yes"                                   # approve / answer (text + Enter)
# or hand control to a human for one terminal:
herdr agent attach "$P"        # ctrl+b q to detach back
```

For non-lifecycle agents (Claude/Codex/Copilot/Droid/Qoder/Cursor) `blocked` is detected from the screen and only fires on **known** approval prompts — a novel prompt may show as `idle`. Don't rely solely on `blocked`; periodically read panes that have been `idle` "too long". See `agents-and-state.md`.

---

## Pattern: worktree-isolated fleet (parallel branches, no collisions)

Give each agent its own git worktree so they never fight over the working tree. herdr manages the checkout as a workspace.

```bash
# create a branch worktree as a new workspace (returns workspace/tab/root_pane/worktree)
read WS ROOT < <(herdr worktree create --branch feature/api --base main --no-focus --json \
  | python3 -c 'import sys,json;r=json.load(sys.stdin)["result"];print(r["workspace"]["workspace_id"],r["root_pane"]["pane_id"])')
herdr pane run "$ROOT" "claude"
herdr pane run "$ROOT" "implement the API per docs/spec.md"
# ... when merged/abandoned:
herdr worktree remove --workspace "$WS"      # runs real `git worktree remove`; needs --force if dirty
```

- `worktree create` makes the checkout under `[worktrees].directory` (default `~/.herdr/worktrees/<repo>/<branch-slug>`) and emits `workspace.created`/`tab.created`/`pane.created`/`worktree.created`.
- `worktree remove` **never deletes the branch** — only the checkout. `workspace close` drops only herdr state, not the checkout. Choose deliberately.
- `worktree open --branch <name>` / `--path <p>` re-opens an existing checkout.

---

## Pattern: multiple named sessions

A named session is an independent server (own panes, own socket; shared global config). Use one session for the controller and another (or several) for workers, or one fleet per project.

**Creating a new session non-interactively (TESTED).** There is no `herdr session create`. `herdr session attach <name>` is the *interactive* TUI path, and you cannot launch the TUI from inside a pane (`HERDR_ENV=1` blocks nested launches). The orchestrator's move is the **headless server**, which is allowed from inside a pane:

```bash
# start an independent named-session server in the background (no TUI, no nested-launch block)
nohup herdr --session fleet-a server > /tmp/fleet-a.log 2>&1 &

# wait for it to come up (poll status; do not sleep)
for i in $(seq 1 15); do
  herdr --session fleet-a status --json | grep -q '"running":true' && break
done

# now drive it like any session
herdr --session fleet-a workspace create --cwd /repo --label worker --no-focus
herdr --session fleet-a pane list
# ...spawn agents, wait, collect exactly as in the current session, all prefixed with --session fleet-a...
herdr session stop fleet-a            # tears down the whole fleet (kills its panes)
```

Note: touching a *stopped* named session with socket commands fails (`status` shows `server: not_running`; `workspace list` errors `NotFound`) — the server must be running first. Manage existing sessions:

```bash
herdr session list --json                              # enumerate (shows running: true/false)
herdr --session fleet-a pane list                      # target a session per-command
HERDR_SESSION=fleet-a herdr agent list                 # or via env for a block of commands
herdr session stop fleet-a                             # stop a whole fleet (kills its panes)
herdr session delete old-fleet                         # remove a stopped session
```

Socket selection order: `--session <name>` > `HERDR_SOCKET_PATH` > `HERDR_SESSION` > default. Sockets live at `~/.config/herdr/herdr.sock` (default) and `~/.config/herdr/sessions/<name>/herdr.sock` (named). A raw socket client picks the session by connecting to the matching socket path.

---

## Pattern: continuity across detaches and restarts

What survives depends on how the session ends — know this before relying on a long-running fleet:

| Event | Processes | Layout | Screen | Agent conversation |
|---|---|---|---|---|
| Detach (`ctrl+b q`) + reattach (`herdr`) | **kept running** | yes | live | never stopped |
| `herdr server stop` then restart | **killed** (panes restart as shells) | yes | only if pane-history on | only with native resume |
| `herdr update --handoff` | best-effort kept | yes | kept if handoff ok | kept if handoff ok |
| `herdr update` (no handoff) | killed | yes | as restart | as restart |

- **Native agent session resume** is ON by default (`[session] resume_agents_on_restore = true`) — supported agents resume their conversation after a restart **if** the official integration is installed at a high-enough version (e.g. Claude Code needs integration v6). Verify with `herdr integration status`.
- **Pane history replay** (recent screen contents after restart) is OFF by default (can leak secrets); enable with `[experimental] pane_history = true`.
- Detach/reattach is the only zero-risk continuity. `--handoff` is experimental and best-effort. Plan teardown points accordingly.

---

## Pattern: remote / SSH orchestration (not cloud-specific)

Drive a herdr server on another host — a build box, a workstation, anything SSH-reachable.

```bash
herdr --remote workbox                          # thin client: SSH in, attach the remote server, stream UI back
herdr --remote ssh://you@server:2222            # ssh:// URL or an SSH config Host alias both work
herdr --remote workbox --session agents         # a named session on the remote host
herdr --remote workbox --handoff                # opt into live handoff on the remote server
ssh you@server herdr                            # alternative: run entirely on the server
```

Headless caveats for unattended controllers:
- A **non-interactive** remote run **fails** if `herdr` isn't already on the remote host — pre-install it (e.g. to `~/.local/bin/herdr`, ensure it's on `PATH`). Override the pushed binary with `HERDR_REMOTE_BINARY`.
- Remote keybindings default to a **snapshot of local** bindings at attach time; local *command* keybindings are not forwarded (they'd run on the remote host). Use `--remote-keybindings server` for server config.
- Remote attach is Linux/macOS (x86_64/aarch64). On the server, the same CLI/socket orchestration applies — nothing here is tied to any cloud provider.

---

## Teardown checklist

- Read/collect every finished pane **before** closing it (`done` clears on read; closing loses scrollback unless pane-history is on).
- `herdr pane close <pane>` → `herdr workspace close <ws>` → `herdr worktree remove` (if a checkout) → `herdr session stop <name>` (whole fleet).
- Closing a parent worktree workspace closes the group but never deletes branches/checkouts — remove those explicitly.
