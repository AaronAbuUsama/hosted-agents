# Agents, state detection, and integrations

How herdr knows what an agent is doing — and the failure modes a controller must design around. Trusting `agent_status` blindly is the most common orchestration bug.

## The one public field: `agent_status`

| State     | Meaning                                                         | Controller action                                 |
| --------- | --------------------------------------------------------------- | ------------------------------------------------- |
| `working` | actively running                                                | wait                                              |
| `blocked` | needs input / approval / a decision                             | **intervene** (read pane, send answer)            |
| `done`    | finished **and not yet viewed**                                 | collect now — reading the pane flips it to `idle` |
| `idle`    | finished/waiting and already seen, **or** an unmatched fallback | verify by reading the pane                        |
| `unknown` | herdr can't classify confidently                                | read the pane                                     |

- `done` is **edge-triggered**: capture it on the `wait agent-status --status done` return, then read immediately. Don't poll for `done` to persist — it won't.
- State rolls **up**: a blocked pane makes its tab and workspace render blocked. `herdr workspace list` rollups let you scan a whole fleet at a glance.

## Two kinds of detection (this changes how much you can trust state)

herdr detects agents from foreground process, screen "manifests", and official integrations. The authority differs by agent:

**Lifecycle-authority agents** — report state through an installed hook/plugin, so `idle/working/blocked` is authoritative:
`pi`, `omp`, `kimi`, `opencode`, `kilo`, `hermes`.

**Screen-manifest agents** — state is inferred from terminal output; intentionally **not** lifecycle authorities:
`claude`, `codex`, `copilot`, `droid`, `qodercli`, `cursor`.

Consequences for screen-manifest agents:

- `blocked` only fires when the bottom-of-screen snapshot matches a **known** approval/question/permission UI. A novel or custom prompt may not register as `blocked`.
- Unmatched known agents fall back to `idle` (`default_known_agent_idle_fallback`). **`idle` does not prove "finished."**
- Mitigation: combine state with output — `wait output <pane> --match "<your prompt sentinel>"`, or periodically `pane read` panes that have sat `idle`, or have your tasks print an explicit completion marker you can match on.

## Integrations: two distinct payoffs

`herdr integration install <agent>` wires an agent up. Two separate benefits — know which you're getting:

- **Live lifecycle state** (the authority agents above): the controller's `wait`/rollups become reliable.
- **Native session resume** (session-identity agents — `claude`, `codex`, `copilot`, `droid`, `qodercli`, `cursor`): the pane reports a native session reference so the **conversation** can be resumed after a server restart.

Some agents give both; some give only one (e.g. `omp` reports state but **not** a resume reference). Check what's wired:

```bash
herdr integration status            # per-agent: not installed / current (vN) / outdated
herdr integration install claude    # install or update to the required version
```

Native resume needs a minimum integration version per agent (e.g. Claude Code → v6, Codex → v5, OpenCode → v5). Outdated integrations **silently** fail to resume. See continuity in `orchestration-patterns.md`.

## Spawning and naming agents

```bash
herdr agent start reviewer --cwd /repo --split right --no-focus -- claude
herdr agent rename <pane|target> reviewer       # name it so you can target by name, not fragile id
herdr agent rename reviewer --clear             # remove custom label
```

Target an agent by terminal id, **unique name**, detected label, or pane id. Naming agents up front is the cleanest way to address a fleet without chasing compacting IDs.

## Injecting state from your own controller/worker

If you wrap a custom process as a worker, report its lifecycle so herdr's waits/rollups include it:

```bash
herdr pane report-agent <pane> --source custom:worker --agent worker --state working --custom-status "step 2/5"
```

- `--state` is semantic (drives waits/notifications/rollups).
- `--custom-status` is display-only.
- `herdr pane report-metadata` overrides display (title/label/state-label) **without** taking state authority from an integration — use it to annotate, not to control. `--seq` drops stale out-of-order updates; `--ttl-ms` expires it.

## Diagnosing wrong state

When a pane shows the wrong status, explain the detection (socket `agent.explain`, or `herdr agent explain --json` on builds that expose it): it reports the final state, the manifest source/version, the matched rule and evidence, and any idle-fallback reason. Local detection overrides live at `~/.config/herdr/agent-detection/<agent>.toml` and win over bundled/remote manifests; apply edits with `herdr server reload-agent-manifests`.

## Footguns (several TESTED live)

- **Detection false-positives on the typed command word.** Verified: after `pane run "$P" "claude"`, herdr reports `agent=claude, status=idle` from the literal word "claude" on the shell prompt — _before Claude has launched_. So `wait agent-status idle` is **not** a readiness signal. For an interactive TUI agent, wait for its real on-screen ready marker instead: `herdr wait output "$P" --source visible --match "shortcuts"` (Claude Code shows `? for shortcuts` when its input box is ready).
- **`done` is transient (~1s).** Verified sequence: `working → done → idle`, with `done` flipping to `idle` about a second later (it clears once "seen"). Catch it on the `wait agent-status done` edge or a socket event; never poll for it to persist.
- **Read TUI agents with `--source visible`.** Claude Code is an alt-screen app with _no scrollback_ — `--source recent`/`recent-unwrapped` come back empty. `--source visible` returns the current screen (where the answer is).
- **Never run `tmux`/`screen` inside a herdr pane.** herdr then sees the multiplexer as the process and cannot detect the agent behind it.
- **`idle` ≠ done** for screen-manifest agents — confirm with a read or an output sentinel.
- Lifecycle state is only reported while the integration is _actively monitoring the pane_; if it isn't, state may be stale/absent.
