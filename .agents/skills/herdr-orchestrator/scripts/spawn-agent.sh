#!/usr/bin/env bash
# spawn-agent.sh — split a pane, launch an agent/command in it, print the new pane_id.
#
# Usage:
#   spawn-agent.sh "<command>" [target_pane] [right|down] [ready_marker]
#     <command>     required, e.g. "claude"  or  "npm run dev"
#     target_pane   optional; default = the focused pane in this session
#     direction     optional; default = right
#     ready_marker  optional; if set, block until this text appears on the new pane's
#                   VISIBLE screen before returning (use for interactive TUI agents,
#                   e.g. "shortcuts" for Claude Code). Do NOT rely on agent-status for
#                   readiness — herdr false-detects the agent from the typed command word.
#
# Prints the new pane_id on stdout (nothing else), so it composes:
#   P=$(spawn-agent.sh "claude" "" right shortcuts); herdr pane run "$P" "do the thing"
set -euo pipefail

[ "${HERDR_ENV:-}" = "1" ] || { echo "refusing: HERDR_ENV != 1 (not inside herdr)" >&2; exit 1; }

CMD="${1:-}"
[ -n "$CMD" ] || { echo "usage: spawn-agent.sh \"<command>\" [target_pane] [right|down] [ready_marker]" >&2; exit 2; }
TARGET="${2:-}"
DIR="${3:-right}"
READY="${4:-}"

# default target = the focused pane
if [ -z "$TARGET" ]; then
  TARGET="$(herdr pane list | python3 -c '
import sys, json
for p in json.load(sys.stdin)["result"]["panes"]:
    if p.get("focused"):
        print(p["pane_id"]); break
')"
fi
[ -n "$TARGET" ] || { echo "could not resolve a target pane" >&2; exit 3; }

NEW="$(herdr pane split "$TARGET" --direction "$DIR" --no-focus | python3 -c '
import sys, json
print(json.load(sys.stdin)["result"]["pane"]["pane_id"])
')"
[ -n "$NEW" ] || { echo "split failed" >&2; exit 4; }

herdr pane run "$NEW" "$CMD"

# optional readiness gate: wait for the agent's real UI marker on the visible screen
if [ -n "$READY" ]; then
  herdr wait output "$NEW" --source visible --match "$READY" --timeout 30000 >/dev/null \
    || { echo "ready marker '$READY' not seen in 30s on $NEW" >&2; exit 5; }
fi

echo "$NEW"
