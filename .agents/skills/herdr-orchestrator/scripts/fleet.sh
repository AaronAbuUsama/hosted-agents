#!/usr/bin/env bash
# fleet.sh — fan a task list out across agents, grouped into dedicated workspaces
# ("windows"), max 4 per window laid out as a 2x2 grid. Workers go in their OWN
# workspaces, never the controller's. Waits for all to finish (working -> idle).
#
# Usage:
#   fleet.sh "task1" "task2" ... "taskN"
#   fleet.sh --per-window 4 --agent claude --ready shortcuts --cleanup "t1" "t2" ...
#
# Options:
#   --per-window K   agents per window (default 4; 2x2 grid keeps panes big enough)
#   --agent CMD      launch command per pane (default: claude)
#   --ready MARKER   on-screen ready marker to gate on (default: shortcuts; "" to skip)
#   --cwd PATH       working dir for the workspaces (default: $PWD)
#   --cleanup        close all fleet workspaces at the end (default: leave running)
#
# Why a 2x2 grid in a separate workspace: a too-small pane (e.g. 4+ stacked splits,
# ~1/8 height) starves a TUI agent and the dispatched task never lands. Half-height
# panes (2x2) work. Re-derive ids from JSON; never cache across closes.
set -uo pipefail

AGENT="claude"; READY="shortcuts"; PER=4; CWD="$PWD"; CLEANUP=0
TASKS=()
while [ $# -gt 0 ]; do
  case "$1" in
    --agent) AGENT="$2"; shift 2;;
    --ready) READY="$2"; shift 2;;
    --per-window) PER="$2"; shift 2;;
    --cwd) CWD="$2"; shift 2;;
    --cleanup) CLEANUP=1; shift;;
    --) shift; while [ $# -gt 0 ]; do TASKS+=("$1"); shift; done;;
    -*) echo "unknown flag: $1" >&2; exit 2;;
    *) TASKS+=("$1"); shift;;
  esac
done
[ "${#TASKS[@]}" -gt 0 ] || { echo "usage: fleet.sh [--per-window K] [--agent CMD] [--ready MARK] [--cleanup] \"task1\" ..." >&2; exit 2; }
[ "${HERDR_ENV:-}" = "1" ] || { echo "refusing: HERDR_ENV != 1 (not inside herdr)" >&2; exit 1; }

pane_id(){ python3 -c 'import sys,json;print(json.load(sys.stdin)["result"]["pane"]["pane_id"])'; }

ALL_PANES=(); ALL_TASKS=(); WORKSPACES=()
n=${#TASKS[@]}; idx=0; wnum=0
while [ $idx -lt $n ]; do
  k=$(( n - idx )); [ $k -gt $PER ] && k=$PER
  wnum=$(( wnum + 1 ))
  read FWS R0 < <(herdr workspace create --cwd "$CWD" --label "fleet$wnum" --no-focus \
    | python3 -c 'import sys,json;r=json.load(sys.stdin)["result"];print(r["workspace"]["workspace_id"], r["root_pane"]["pane_id"])')
  WORKSPACES+=("$FWS")
  win=("$R0")
  [ $k -ge 2 ] && win[1]=$(herdr pane split "$R0"       --direction right --no-focus | pane_id)
  [ $k -ge 3 ] && win[2]=$(herdr pane split "$R0"       --direction down  --no-focus | pane_id)
  [ $k -ge 4 ] && win[3]=$(herdr pane split "${win[1]}" --direction down  --no-focus | pane_id)
  for j in $(seq 0 $((k-1))); do
    herdr pane run "${win[$j]}" "$AGENT"
    ALL_PANES+=("${win[$j]}"); ALL_TASKS+=("${TASKS[$((idx+j))]}")
  done
  echo "window $wnum ($FWS): ${k} agent(s)"
  idx=$(( idx + k ))
done
echo "spawned ${#ALL_PANES[@]} agents across ${#WORKSPACES[@]} window(s)"

if [ -n "$READY" ]; then
  for p in "${ALL_PANES[@]}"; do
    herdr wait output "$p" --source visible --match "$READY" --timeout 40000 >/dev/null || echo "  warn: $p not ready"
  done
fi

for i in $(seq 0 $((${#ALL_PANES[@]}-1))); do
  herdr pane send-text "${ALL_PANES[$i]}" "${ALL_TASKS[$i]}"
  herdr pane send-keys "${ALL_PANES[$i]}" Enter
done

fw(){ herdr wait agent-status "$1" --status working --timeout 30000 >/dev/null \
        || { echo "  [$1] NEVER STARTED"; return; }
      herdr wait agent-status "$1" --status idle --timeout 600000 >/dev/null \
        && echo "  [$1] done" || echo "  [$1] stuck"; }
pids=()
for p in "${ALL_PANES[@]}"; do fw "$p" & pids+=($!); done
wait "${pids[@]}"

if [ "$CLEANUP" = "1" ]; then
  for w in "${WORKSPACES[@]}"; do herdr workspace close "$w" >/dev/null 2>&1 && echo "closed $w"; done
else
  echo "workers left running. cleanup: herdr workspace close ${WORKSPACES[*]}"
fi
