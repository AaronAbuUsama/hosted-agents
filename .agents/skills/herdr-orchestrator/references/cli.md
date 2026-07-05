# herdr CLI reference (orchestration-relevant)

Source: `herdr --help` for the installed binary (**0.6.8, protocol 12**) cross-checked against herdr.dev/docs/cli-reference. Where the public docs list a command this binary does not expose, it is flagged **[socket-only here]**.

Most structural/query commands print JSON; mutation commands often print nothing. See "Output shapes" at the end.

## Selecting the target session

| Form                                   | Effect                                |
| -------------------------------------- | ------------------------------------- |
| `herdr --session <name> <cmd>`         | run a command against a named session |
| `HERDR_SESSION=<name> herdr <cmd>`     | same, via env                         |
| `HERDR_SOCKET_PATH=<path> herdr <cmd>` | low-level: target a specific socket   |
| (none)                                 | default session                       |

Resolution order: `--session` > `HERDR_SOCKET_PATH` > `HERDR_SESSION` > default.

## session — manage independent server namespaces

```
herdr session list [--json]
herdr session attach <name>
herdr session stop  <name> [--json]      # stops server + all its panes
herdr session delete <name> [--json]
```

Use `default` as `<name>` to target the default session for `stop`.

## workspace — project containers

```
herdr workspace list
herdr workspace create [--cwd PATH] [--label TEXT] [--env K=V] [--focus|--no-focus]
herdr workspace get    <workspace_id>
herdr workspace focus  <workspace_id>
herdr workspace rename <workspace_id> <label>
herdr workspace close  <workspace_id>    # drops herdr state only (not git checkouts)
```

`create` returns `result.workspace`, `result.tab`, `result.root_pane`.

## tab — layouts inside a workspace

```
herdr tab list   [--workspace <workspace_id>]
herdr tab create [--workspace <id>] [--cwd PATH] [--label TEXT] [--focus|--no-focus]
herdr tab get    <tab_id>
herdr tab focus  <tab_id>
herdr tab rename <tab_id> <label>
herdr tab close  <tab_id>
```

`create` returns `result.tab`, `result.root_pane`.

## pane — terminals (where agents run)

```
herdr pane list   [--workspace <workspace_id>]
herdr pane get    <pane_id>
herdr pane rename <pane_id> <label>|--clear
herdr pane read   <pane_id> [--source visible|recent|recent-unwrapped] [--lines N] [--format text|ansi] [--ansi]
herdr pane split  <pane_id> --direction right|down [--cwd PATH] [--focus|--no-focus]    # returns result.pane.pane_id
herdr pane close  <pane_id>
herdr pane send-text <pane_id> <text>     # literal text, NO Enter
herdr pane send-keys <pane_id> <key> [key ...]   # e.g. Enter, esc, ctrl+h, minus
herdr pane run    <pane_id> <command>     # text + Enter atomically — preferred for issuing work
herdr pane report-agent    <pane_id> --source ID --agent LABEL --state idle|working|blocked|unknown [--message TEXT] [--custom-status TEXT] [--seq N]
herdr pane report-metadata <pane_id> --source ID [--title TEXT] [--display-agent TEXT] [--custom-status TEXT] [--state-label STATUS=TEXT] [--ttl-ms N]
```

**read sources:** `visible` = viewport · `recent` = rendered scrollback · `recent-unwrapped` = soft-wraps joined (best for logs and for inspecting what `wait output` matched) · `detection` = the snapshot used for agent detection (docs; via socket).
**[socket-only here]:** `pane swap`, `pane move`, `pane zoom`, `pane resize`, `pane neighbor`, `pane layout`, `pane process_info` — use the socket API (`socket-api.md`).

## agent — agent-aware operations on panes

```
herdr agent list
herdr agent get    <target>
herdr agent read   <target> [--source ...] [--lines N] [--format text|ansi] [--ansi]
herdr agent send   <target> <text>
herdr agent rename <target> <name>|--clear
herdr agent focus  <target>
herdr agent wait   <target> --status idle|working|blocked|unknown [--timeout MS]   # NOTE: no 'done' here
herdr agent attach <target> [--takeover]
herdr agent start  <name> [--cwd PATH] [--workspace ID] [--tab ID] [--split right|down] [--env K=V] [--focus|--no-focus] -- <argv...>
```

- **target** = terminal id, unique agent name, detected/reported label, or pane id. `get`/`focus`/`wait`/`attach` need an agent identity — a bare shell pane has none (rename it first, or use `pane`/`terminal` commands).
- `agent start` requires the launch command after a literal `--`. Everything after `--` is run as the agent process.
- **[socket-only here]:** `agent explain` (detection diagnostics) — `agent.explain` over the socket, or `herdr agent explain --json` on newer builds.

## terminal — direct attach to one PTY

```
herdr terminal attach <terminal_id> [--takeover]
```

Streams a single server-owned terminal without the full UI. Detach: `ctrl+b q`. Send a literal `ctrl+b`: `ctrl+b ctrl+b`. Only one writable client owns input; `--takeover` seizes it.

## wait — blocking coordination (exit code 1 on timeout)

```
herdr wait output       <pane_id> --match <text> [--source visible|recent|recent-unwrapped] [--lines N] [--timeout MS] [--regex] [--raw]
herdr wait agent-status <pane_id> --status idle|working|blocked|done|unknown [--timeout MS]
```

`wait agent-status` accepts **`done`** (the `agent wait` subcommand does not). `--timeout 0` waits indefinitely. `wait output --source recent` matches **unwrapped** text, so wrapping never breaks a match.

## worktree — git worktrees as workspaces

```
herdr worktree list   [--workspace ID | --cwd PATH] [--json]
herdr worktree create [--workspace ID | --cwd PATH] [--branch NAME] [--base REF] [--path PATH] [--label TEXT] [--focus|--no-focus] [--json]
herdr worktree open   [--workspace ID | --cwd PATH] (--path PATH | --branch NAME) [--label TEXT] [--focus|--no-focus] [--json]
herdr worktree remove --workspace ID [--force] [--json]    # runs real `git worktree remove`; never deletes the branch
```

## integration — enrich agent state/resume

```
herdr integration install   <agent>     # pi omp claude codex copilot devin droid kimi opencode kilo hermes qodercli cursor
herdr integration uninstall <agent>
herdr integration status [--outdated-only]
```

See `agents-and-state.md` for which integrations give authoritative live state vs only session-resume.

## server / status / channel / config

```
herdr server stop | reload-config | live-handoff
herdr status [server|client] [--json]   # protocol version, capabilities, socket path, restart_needed
herdr channel show | set stable|preview
herdr config reset-keys
herdr --remote <host> [--session NAME] [--handoff] [--remote-keybindings local|server]
herdr --no-session                      # escape hatch: no server/client split (no persistence/remote)
```

**[socket-only here]:** `notification show`, `events subscribe` — no CLI subcommand on 0.6.8; use the socket API.

## Env vars herdr injects into every managed pane

`HERDR_ENV=1`, `HERDR_SOCKET_PATH`, `HERDR_WORKSPACE_ID`, `HERDR_TAB_ID`, `HERDR_PANE_ID` (plugins also get `HERDR_BIN_PATH`). A controller running inside a pane uses these to self-identify and to reach its own session's socket. herdr-managed vars win over caller-supplied env on conflict.

## ID forms (both accepted by the CLI)

| Level     | Compact | Long (returned in JSON) |
| --------- | ------- | ----------------------- |
| workspace | `1`     | `w654ac167ce9b11`       |
| tab       | `1:1`   | `w654ac167ce9b11:1`     |
| pane      | `1-1`   | `w654ac167ce9b11-1`     |
| terminal  | —       | `term_654ac167ce9ab2`   |

JSON always returns the long form plus a `number`. IDs compact on close — re-read them; never cache across a close.

## Output shapes

- **Print JSON:** `workspace list/create/get`, `tab list/create/get/focus/rename/close`, `pane list/get/split`, `agent list/get`, `session list`, `worktree *` (with `--json`), `wait output`, `wait agent-status`, `status --json`.
- **Print TEXT:** `pane read` / `agent read` (use `--ansi` for a rendered ANSI snapshot).
- **Print nothing on success:** `pane send-text`, `pane send-keys`, `pane run`, `agent send`.
- **Error envelope:** `{"id":"...","error":{"code":"pane_not_found","message":"..."}}`. Common codes: `pane_not_found`/`not_found`, `invalid_params`, `platform_unsupported`, `plugin_disabled`.
