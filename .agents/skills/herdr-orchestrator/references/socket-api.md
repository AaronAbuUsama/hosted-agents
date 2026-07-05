# herdr socket API (for orchestration)

The CLI is the default control layer. Use the raw socket when you need **event subscriptions** (push instead of poll), or methods the 0.6.8 CLI doesn't expose (`pane.swap/move/zoom/resize`, `layout.export/apply`, `notification.show`, `agent.explain`).

## Transport

- Newline-delimited JSON over a **local socket**: unix domain socket (Unix), named pipe (Windows).
- One request per line. Request: `{"id":"<str>","method":"<dotted.name>","params":{...}}`.
- Success: `{"id":"<same>","result":{"type":"<kind>",...}}`. Error: `{"id":"<same>","error":{"code":"<code>","message":"..."}}`.
- Every `result` carries a `type` discriminator (`pong`, `pane_info`, `pane_swap`, `pane_move`, `pane_zoom`, `workspace_list`, `agent_list`, `notification_show`, …).
- Error codes: `not_found`/`pane_not_found`, `invalid_params`, `platform_unsupported`, `plugin_disabled`.

### Socket path

```
~/.config/herdr/herdr.sock                       # default session
~/.config/herdr/sessions/<name>/herdr.sock       # named session
```

Inside a pane, read it from `$HERDR_SOCKET_PATH`. Resolution order matches the CLI: `--session` > `HERDR_SOCKET_PATH` > `HERDR_SESSION` > default.

### Talking to it

```bash
# one-shot request/response
printf '%s\n' '{"id":"1","method":"ping","params":{}}' | nc -U "$HERDR_SOCKET_PATH"
# -> {"id":"1","result":{"type":"pong"}}
```

`nc -U` (or `socat - UNIX-CONNECT:$HERDR_SOCKET_PATH`, or any language's unix-socket client) works. For event streams, keep the connection open and read line by line.

## Method map (dot notation)

| Area         | Methods                                                                                                                                                                                                                                                                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Server       | `ping`, `server.stop`, `server.reload_config`, `server.agent_manifests`, `server.reload_agent_manifests`                                                                                                                                                                                                                                                      |
| Notification | `notification.show`                                                                                                                                                                                                                                                                                                                                           |
| Client       | `client.window_title.set`, `client.window_title.clear`                                                                                                                                                                                                                                                                                                        |
| Workspace    | `workspace.create`, `.list`, `.get`, `.focus`, `.rename`, `.close`                                                                                                                                                                                                                                                                                            |
| Worktree     | `worktree.list`, `.create`, `.open`, `.remove`                                                                                                                                                                                                                                                                                                                |
| Tab          | `tab.create`, `.list`, `.get`, `.focus`, `.rename`, `.close`                                                                                                                                                                                                                                                                                                  |
| Pane         | `pane.split`, `.swap`, `.move`, `.zoom`, `.layout`, `.process_info`, `.neighbor`, `.edges`, `.focus_direction`, `.resize`, `.list`, `.current`, `.get`, `.rename`, `.send_text`, `.send_keys`, `.send_input`, `.read`, `.report_agent`, `.report_agent_session`, `.report_metadata`, `.clear_agent_authority`, `.release_agent`, `.close`, `.wait_for_output` |
| Layout       | `layout.export`, `layout.apply`                                                                                                                                                                                                                                                                                                                               |
| Agent        | `agent.list`, `.get`, `.read`, `.explain`, `.send`, `.rename`, `.focus`, `.start`                                                                                                                                                                                                                                                                             |
| Events       | `events.subscribe`, `events.wait`                                                                                                                                                                                                                                                                                                                             |
| Integrations | `integration.install`, `integration.uninstall`                                                                                                                                                                                                                                                                                                                |
| Plugins      | `plugin.link`, `.list`, `.unlink`, `.enable`, `.disable`, `.action.list`, `.action.invoke`, `.log.list`, `.pane.open`, `.pane.focus`, `.pane.close`                                                                                                                                                                                                           |

Pane methods take public ids (`w1:p1`). Where `pane_id` is optional, the server's focused pane is used; `pane.move` always requires the source `pane_id`. **Raw socket `cwd`/`path` values must be absolute** (the CLI expands relatives for you).

## Events (push-based monitoring)

```json
{
  "id": "sub_1",
  "method": "events.subscribe",
  "params": {
    "subscriptions": [
      { "type": "pane.created" },
      { "type": "pane.exited" },
      { "type": "pane.agent_status_changed", "pane_id": "w1:p1" }
    ]
  }
}
```

The first line is the ack: `{"id":"sub_1","result":{"type":"subscription_started"}}`. Subsequent lines are pushed events with the shape **`{"event":"<type>","data":{...}}`** (TESTED), e.g.
`{"event":"pane.agent_status_changed","data":{"pane_id":"w1:p1","agent":"claude","agent_status":"done","workspace_id":"w1"}}`.

- **Pane:** `pane.created`, `pane.closed`, `pane.focused`, `pane.moved`, `pane.exited`, `pane.agent_detected`, `pane.output_matched`, `pane.agent_status_changed`
- **Workspace:** `workspace.created`, `.updated`, `.renamed`, `.closed`, `.focused`
- **Worktree:** `worktree.created`, `.opened`, `.removed`

> **TESTED filtering rule:** `pane.agent_status_changed` (and `pane.output_matched`) **require a `pane_id`** in the subscription — omitting it errors with `invalid_request: missing field 'pane_id'`. The lifecycle events (`pane.created`/`closed`/`exited`/`agent_detected`) accept **no** `pane_id` and stream for _all_ panes. So fleet monitoring = one global lifecycle subscription (catch new/dead panes) + one `agent_status_changed` subscription **per pane** you track. Add `agent_status` to a subscription to narrow it to one state.

This is the right tool for supervising a large fleet: subscribe to `pane.agent_status_changed` per worker and act on `blocked`/`done` the instant they happen, instead of N polling loops. `done` is transient (~1s before it flips to `idle`), so an event subscription is more reliable than polling for catching it.

## Selected request examples

```json
{"id":"a","method":"pane.split","params":{"direction":"right","ratio":0.333,"env":{"HERDR_ROLE":"tests"}}}
{"id":"b","method":"pane.zoom","params":{"pane_id":"w1:p1","mode":"on"}}
{"id":"c","method":"pane.move","params":{"pane_id":"w1:p2","destination":{"type":"new_workspace","label":"logs","tab_label":"main"},"focus":false}}
{"id":"d","method":"worktree.create","params":{"workspace_id":"w1","branch":"worktree/api","focus":false}}
{"id":"e","method":"notification.show","params":{"title":"agent blocked","body":"api fleet","sound":"request"}}
{"id":"f","method":"agent.explain","params":{"target":"w1:p1"}}
```

`pane.move` keeps the terminal alive across workspaces but assigns a **new** public pane id (listen for `pane.moved`). `layout.apply` rebuilds a tab from a declarative BSP tree (`type:"split"`/`"pane"`, `direction`, `ratio`, `cwd`, `env`, argv `command`) but does **not** preserve live PTYs/scrollback/processes.

## Reporting agent state from a custom controller

If you build your own worker wrapper, report its lifecycle so herdr's waits/rollups see it:

```json
{
  "id": "r",
  "method": "pane.report_agent",
  "params": {
    "pane_id": "w1:p1",
    "source": "custom:worker",
    "agent": "worker",
    "state": "working",
    "custom_status": "step 2/5"
  }
}
```

- `state` is **semantic** (drives waits/notifications/rollups): `idle|working|blocked|done|unknown`.
- `custom_status` is **display-only**. Use `pane.report_metadata` for display overrides (title/label) that must **not** seize state authority. Use `seq` to drop out-of-order updates; `ttl_ms` (1..86400000) to expire metadata.

## Stability

Protocol is versioned. Check with `ping` / `herdr status` before depending on newer behavior; handle unknown fields gracefully. `agent.explain` requires a server build that supports it — restart or live-handoff after upgrading.
