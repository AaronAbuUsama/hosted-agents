#!/usr/bin/env python3
"""watch-status.py — stream herdr agent/pane events for orchestration monitoring.

Usage:
  watch-status.py [--seconds N] [pane_id ...]

Subscribes over the herdr socket ($HERDR_SOCKET_PATH) to global pane lifecycle
events (created/closed/exited/agent_detected) and, for each pane_id given, that
pane's agent_status_changed events. Prints one compact line per event. Runs until
killed, or for --seconds N if given.

Notes (verified against herdr 0.6.8):
- agent_status_changed REQUIRES a pane_id; an unfiltered subscription is rejected
  with "invalid_request: missing field 'pane_id'". Lifecycle events need no pane_id.
- 'done' is transient (~1s before it flips to 'idle'); an event stream catches it
  reliably where polling can miss the edge.
- Event shape is {"event": "<type>", "data": {...}}; the first line is the ack
  {"result": {"type": "subscription_started"}}.
"""
import socket, sys, json, time, os

args = sys.argv[1:]
seconds = None
panes = []
i = 0
while i < len(args):
    if args[i] == "--seconds":
        seconds = float(args[i + 1]); i += 2
    else:
        panes.append(args[i]); i += 1

sock_path = os.environ.get("HERDR_SOCKET_PATH", os.path.expanduser("~/.config/herdr/herdr.sock"))
subs = [{"type": t} for t in ("pane.created", "pane.closed", "pane.exited", "pane.agent_detected")]
subs += [{"type": "pane.agent_status_changed", "pane_id": p} for p in panes]

s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
s.connect(sock_path)
s.sendall((json.dumps({"id": "watch", "method": "events.subscribe", "params": {"subscriptions": subs}}) + "\n").encode())
s.settimeout(1.0)
deadline = (time.time() + seconds) if seconds else None
buf = b""
sys.stderr.write(f"watching {sock_path} (panes={panes or 'lifecycle-only'})\n"); sys.stderr.flush()

while deadline is None or time.time() < deadline:
    try:
        chunk = s.recv(65536)
        if not chunk:
            break
        buf += chunk
        while b"\n" in buf:
            line, buf = buf.split(b"\n", 1)
            if not line.strip():
                continue
            try:
                e = json.loads(line)
            except Exception:
                continue
            if e.get("result", {}).get("type") == "subscription_started":
                continue
            if "error" in e:
                print(f"ERROR {e['error']}", flush=True); continue
            d = e.get("data", {})
            pane = d.get("pane", {}) if isinstance(d.get("pane"), dict) else {}
            pid = d.get("pane_id") or pane.get("pane_id") or "-"
            agent = d.get("agent") or pane.get("agent") or "-"
            status = d.get("agent_status") or pane.get("agent_status") or "-"
            ts = time.strftime("%H:%M:%S")
            print(f"{ts}  {e.get('event','?'):30} pane={pid} agent={agent} status={status}", flush=True)
    except socket.timeout:
        continue
    except KeyboardInterrupt:
        break
