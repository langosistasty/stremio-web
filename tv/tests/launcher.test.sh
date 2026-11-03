#!/usr/bin/env bash
# Stremio Big Picture: tests for install.sh and launch.sh, with a fake flatpak command and a
# throwaway home folder, so nothing on this machine changes. Needs the UI built (build/).
# Usage: tv/tests/launcher.test.sh
# SPDX-License-Identifier: GPL-2.0-only
set -u

TESTS="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
TV="$(dirname "$TESTS")"
REPO="$(dirname "$TV")"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/bigpicture-launcher-test.XXXXXX")"
PORT=18479
FAILED=0
BACKGROUND=()

cleanup() {
    for pid in "${BACKGROUND[@]}"; do kill "$pid" 2>/dev/null; done
    pkill -f "$WORK/" 2>/dev/null
    rm -rf "$WORK"
}
trap cleanup EXIT

pass() { echo "PASS  $*"; }
fail() { echo "FAIL  $*"; FAILED=$((FAILED + 1)); }
check() { # description command...
    local description="$1"
    shift
    if "$@"; then pass "$description"; else fail "$description"; fi
}
port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
wait_for() { # seconds command...
    local seconds="$1"
    shift
    for _ in $(seq 1 $((seconds * 4))); do
        "$@" && return 0
        sleep 0.25
    done
    return 1
}

[ -f "$REPO/build/index.html" ] || { echo "Build the UI first (pnpm build)." >&2; exit 1; }

# A bundle, as tv/package.sh makes it (without the samples).
BUNDLE="$WORK/bundle"
mkdir -p "$BUNDLE"
cp -a "$REPO/build" "$BUNDLE/ui"
cp -a "$TV/launch.sh" "$TV/install.sh" "$TV/doctor.sh" "$TV/serve.py" "$TV/diagnose.py" "$TV/probe" "$BUNDLE/"
echo "test, source: launcher test" > "$BUNDLE/VERSION"

# The fake flatpak. "run" behaves like a healthy Stremio: it posts a heartbeat every
# second (or stops after STUB_BEATS of them, like a frozen page) until `flatpak kill` or until
# STUB_LIFETIME seconds pass, when it "quits".
STUB="$WORK/bin"
mkdir -p "$STUB" "$WORK/stub"
cat > "$STUB/flatpak" <<'STUBEOF'
#!/usr/bin/env bash
STATE="$STUB_STATE"
case "$1" in
    info) exit 0 ;;
    ps) [ -f "$STATE/running" ] && echo com.stremio.Stremio; exit 0 ;;
    kill) [ -f "$STATE/running" ] && kill -KILL "$(cat "$STATE/running")" 2>/dev/null; rm -f "$STATE/running"; exit 0 ;;
    run)
        url=""
        for argument in "$@"; do case "$argument" in --url=*) url="${argument#--url=}" ;; esac; done
        echo "run ${url:-<raise>}" >> "$STATE/calls"
        [ -n "$url" ] || exit 0
        port="$(echo "$url" | sed -E 's|.*127.0.0.1:([0-9]+)/.*|\1|')"
        echo "$$" > "$STATE/running"
        # Like the real one: stopping `flatpak run` leaves Stremio open; only `flatpak kill` ends it.
        trap '' TERM INT
        beats=0
        for _ in $(seq 1 "${STUB_LIFETIME:-30}"); do
            if [ "$beats" -lt "${STUB_BEATS:-1000}" ]; then
                python3 -c "import json, sys, time, urllib.request; urllib.request.urlopen(urllib.request.Request(sys.argv[1], data=json.dumps({'seq': 0, 't': int(time.time() * 1000), 'route': 'board', 'frames': 60, 'maxLagMs': 0, 'keys': 0, 'lastKeys': [], 'focus': 'a', 'engine': {}, 'visible': 'visible', 'windowFocused': True, 'domNodes': 1}).encode(), method='POST'))" "http://127.0.0.1:$port/report" 2>/dev/null
                beats=$((beats + 1))
            fi
            sleep 1
        done
        rm -f "$STATE/running"
        exit 0 ;;
esac
exit 0
STUBEOF
chmod +x "$STUB/flatpak"

export HOME="$WORK/home" XDG_DATA_HOME="$WORK/home/.local/share" XDG_CONFIG_HOME="$WORK/home/.config" XDG_STATE_HOME="$WORK/home/.local/state"
export PATH="$STUB:$PATH" STUB_STATE="$WORK/stub"
mkdir -p "$HOME"
# No desktop notifications from the tests.
notify-send() { :; }
export -f notify-send
LAUNCH="$XDG_DATA_HOME/stremio-bigpicture/launch.sh"
STATE_DIR="$XDG_STATE_HOME/stremio-bigpicture"

echo "== install.sh"
"$BUNDLE/install.sh" >/dev/null
ENTRY="$XDG_DATA_HOME/applications/stremio-bigpicture.desktop"
check "installs the bundle" test -x "$LAUNCH"
check "adds the Stremio Big Picture launcher entry" grep -q '^Exec=".*/stremio-bigpicture/launch.sh"$' "$ENTRY"
if command -v desktop-file-validate >/dev/null 2>&1; then
    check "the launcher entries are valid" desktop-file-validate "$ENTRY" "$XDG_DATA_HOME/applications/stremio-bigpicture-doctor.desktop"
fi
"$BUNDLE/install.sh" --autostart >/dev/null
check "--autostart adds a login entry" test -f "$XDG_CONFIG_HOME/autostart/stremio-bigpicture.desktop"
"$BUNDLE/install.sh" --no-autostart >/dev/null
check "--no-autostart removes it" test ! -f "$XDG_CONFIG_HOME/autostart/stremio-bigpicture.desktop"

echo "== a normal session"
STUB_LIFETIME=6 "$LAUNCH" --port "$PORT" > "$WORK/normal.log" 2>&1
check "the launcher exits when Stremio quits" test $? -eq 0
check "it asked for Big Picture and diagnostics" grep -q "run http://127.0.0.1:$PORT/?bigpicture=1&diagnostics=1" "$STUB_STATE/calls"
check "the local server stopped with it" bash -c "! (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null"
check "the session report was written" grep -q "No freeze recorded" "$STATE_DIR/last-report.txt"

echo "== a second launch while running"
: > "$STUB_STATE/calls"
STUB_LIFETIME=20 "$LAUNCH" --port "$PORT" > "$WORK/first.log" 2>&1 &
BACKGROUND+=($!)
wait_for 10 port_open "$PORT"
wait_for 10 test -f "$STUB_STATE/running"
"$LAUNCH" --port "$PORT" > "$WORK/second.log" 2>&1
check "it exits cleanly" test $? -eq 0
check "it raised the running window instead of starting another" wait_for 5 grep -q "run <raise>" "$STUB_STATE/calls"
flatpak kill com.stremio.Stremio
wait_for 10 bash -c "! (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null"

echo "== a normal Stremio already open"
echo "$$" > "$STUB_STATE/running"
"$LAUNCH" --port "$PORT" > "$WORK/foreign-app.log" 2>&1
check "it refuses, and says to quit Stremio" grep -q "already open" "$WORK/foreign-app.log"
rm -f "$STUB_STATE/running"

echo "== a UI server left over from a crash"
python3 "$XDG_DATA_HOME/stremio-bigpicture/serve.py" "$XDG_DATA_HOME/stremio-bigpicture/ui" --port "$PORT" &
BACKGROUND+=($!)
wait_for 10 port_open "$PORT"
STUB_LIFETIME=3 "$LAUNCH" --port "$PORT" > "$WORK/stale.log" 2>&1
check "it takes the port back and runs" test $? -eq 0

echo "== another program on the port"
python3 -m http.server "$PORT" --bind 127.0.0.1 >/dev/null 2>&1 &
BACKGROUND+=($!)
wait_for 10 port_open "$PORT"
"$LAUNCH" --port "$PORT" > "$WORK/foreign-port.log" 2>&1
check "it refuses with exit 75" test $? -eq 75
kill "${BACKGROUND[-1]}" 2>/dev/null
wait_for 10 bash -c "! (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null"

echo "== a frozen page"
BIGPICTURE_PAGE_SILENT_SECONDS=6 STUB_BEATS=3 STUB_LIFETIME=600 timeout 150 "$LAUNCH" --port "$PORT" > "$WORK/freeze.log" 2>&1
FREEZE_EXIT=$?
check "the watchdog restarted Stremio" grep -q "WATCHDOG RESTARTED" "$STATE_DIR/last-report.txt"
check "it gave up after 3 restarts" grep -q "WATCHDOG GAVE UP" "$STATE_DIR/last-report.txt"
check "giving up closed the frozen Stremio" test ! -f "$STUB_STATE/running"
check "giving up ended the launcher, rather than leaving it waiting on a frozen app" test "$FREEZE_EXIT" -ne 124

echo "== the launcher stopped while Stremio runs"
STUB_LIFETIME=60 "$LAUNCH" --port "$PORT" > "$WORK/stopped.log" 2>&1 &
LAUNCHER=$!
wait_for 10 test -f "$STUB_STATE/running"
kill -TERM "$LAUNCHER"
wait "$LAUNCHER" 2>/dev/null
check "stopping the launcher closed Stremio too" wait_for 5 test ! -f "$STUB_STATE/running"
check "and its UI server" wait_for 5 bash -c "! (exec 3<>/dev/tcp/127.0.0.1/$PORT) 2>/dev/null"

echo "== the streaming server's CORS check"
if port_open 11470; then
    echo "SKIP  port 11470 is in use here (a Stremio is running)"
else
    cat > "$WORK/server.py" <<'PYEOF'
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer
class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass
    def do_GET(self):
        self.send_response(200)
        if sys.argv[1] == "allow":
            self.send_header("Access-Control-Allow-Origin", self.headers.get("Origin"))
        self.end_headers()
        self.wfile.write(b"{}")
HTTPServer(("127.0.0.1", 11470), Handler).serve_forever()
PYEOF
    for mode in allow deny; do
        python3 "$WORK/server.py" "$mode" &
        SERVER=$!
        wait_for 10 port_open 11470
        STUB_LIFETIME=5 "$LAUNCH" --port "$PORT" > "$WORK/cors-$mode.log" 2>&1
        kill "$SERVER" 2>/dev/null
        wait "$SERVER" 2>/dev/null
        RECORDING="$(find "$STATE_DIR" -maxdepth 1 -name 'session-*' | sort | tail -1)"
        if [ "$mode" = allow ]; then
            check "an accepting server passes the check" grep -q "CORS OK" "$RECORDING/events.log.info"
        else
            check "a rejecting server is reported" grep -q "CORS CHECK FAILED" "$STATE_DIR/last-report.txt"
        fi
        wait_for 10 bash -c "! (exec 3<>/dev/tcp/127.0.0.1/11470) 2>/dev/null"
    done
fi

check "only the last 5 sessions are kept" test "$(find "$STATE_DIR" -maxdepth 1 -name 'session-*' | wc -l)" -le 5

echo
if [ "$FAILED" -gt 0 ]; then
    echo "$FAILED failed"
    exit 1
fi
echo "All passed"
