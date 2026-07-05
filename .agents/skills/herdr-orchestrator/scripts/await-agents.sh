#!/usr/bin/env bash
# await-agents.sh — block until each given pane reaches a status; report any timeouts.
#
# Usage:
#   await-agents.sh --status <idle|working|blocked|done|unknown> [--timeout <ms>] <pane> [<pane> ...]
#     --status   default: done
#     --timeout  default: 600000 (ms); use 0 to wait indefinitely
#
# Exit 0 if all panes reached the status; exit 1 if any timed out (ids on stderr).
# Waits are sequential but the agents run concurrently, so wall-clock ~= the slowest pane.
set -euo pipefail

[ "${HERDR_ENV:-}" = "1" ] || { echo "refusing: HERDR_ENV != 1 (not inside herdr)" >&2; exit 1; }

STATUS="done"
TIMEOUT="600000"
PANES=()
while [ $# -gt 0 ]; do
  case "$1" in
    --status)  STATUS="${2:-}"; shift 2 ;;
    --timeout) TIMEOUT="${2:-}"; shift 2 ;;
    --)        shift; while [ $# -gt 0 ]; do PANES+=("$1"); shift; done ;;
    -*)        echo "unknown flag: $1" >&2; exit 2 ;;
    *)         PANES+=("$1"); shift ;;
  esac
done

[ "${#PANES[@]}" -gt 0 ] || { echo "usage: await-agents.sh --status <s> [--timeout ms] <pane>..." >&2; exit 2; }

timed_out=()
for P in "${PANES[@]}"; do
  if ! herdr wait agent-status "$P" --status "$STATUS" --timeout "$TIMEOUT"; then
    timed_out+=("$P")
  fi
done

if [ "${#timed_out[@]}" -gt 0 ]; then
  echo "timed out (${#timed_out[@]}): ${timed_out[*]}" >&2
  exit 1
fi
echo "all ${#PANES[@]} pane(s) reached status: $STATUS"
