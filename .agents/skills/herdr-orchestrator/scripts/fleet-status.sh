#!/usr/bin/env bash
# fleet-status.sh — one line per pane/agent across the herdr session(s).
#
# Usage:
#   fleet-status.sh                 # panes in the current/default session
#   fleet-status.sh --all-sessions  # iterate every named session
#
# Read-only. Honors --session via HERDR_SESSION if exported.
# Output columns: PANE_ID  STATUS  AGENT  CWD
set -euo pipefail

[ "${HERDR_ENV:-}" = "1" ] || echo "warning: HERDR_ENV != 1 (not inside a herdr pane)" >&2

emit() { # $1 = optional session name
  local out
  if [ -n "${1:-}" ]; then
    out="$(herdr --session "$1" pane list 2>/dev/null || true)"
  else
    out="$(herdr pane list 2>/dev/null || true)"
  fi
  printf '%s' "$out" | python3 -c '
import sys, json
try:
    panes = json.load(sys.stdin).get("result", {}).get("panes", [])
except Exception:
    sys.exit(0)
for p in panes:
    print("{:<24} {:<9} {:<10} {}".format(
        p.get("pane_id", ""),
        p.get("agent_status", "?"),
        (p.get("agent") or "-"),
        p.get("cwd", "")))
'
}

printf '%-24s %-9s %-10s %s\n' "PANE_ID" "STATUS" "AGENT" "CWD"
if [ "${1:-}" = "--all-sessions" ]; then
  herdr session list --json 2>/dev/null \
    | python3 -c 'import sys,json
for s in json.load(sys.stdin).get("sessions", []):
    print(s.get("name",""))' \
    | while IFS= read -r name; do
        [ -n "$name" ] || continue
        echo "-- session: $name --"
        emit "$name"
      done
else
  emit
fi
