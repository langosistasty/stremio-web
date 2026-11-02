#!/usr/bin/env bash
# Stremio Big Picture: open the unmodified Stremio Flatpak with this UI, served locally.
# Stremio quits when you close the window; the local server stops with it.
#
# Every session is recorded (tv/diagnose.py; the last 5 are kept), and a watchdog
# restarts Stremio when it freezes, so a TV never needs a keyboard and a terminal.
# SPDX-License-Identifier: GPL-2.0-only
set -u

SELF_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
APP_ID="com.stremio.Stremio"
# The port is part of the page's origin, which keeps your login and settings.
# Changing it starts from a blank profile.
PORT=18470
BIG_PICTURE=1
DIAGNOSE=0
SAFE_RENDER=auto
WATCHDOG=1
FREEZE_REPORT="$HOME/stremio-bigpicture-freeze-report.txt"
STATE_DIR="${XDG_STATE_HOME:-$HOME/.local/state}/stremio-bigpicture"
KEEP_RECORDINGS=5
# The watchdog gives up after this many restarts within RESTART_WINDOW seconds.
MAX_RESTARTS=3
RESTART_WINDOW=600

usage() {
    cat <<EOF
Usage: launch.sh [options]
  --normal          Use the saved setting instead of forcing Big Picture on
  --diagnose        Also write ~/stremio-bigpicture-freeze-report.txt on exit
  --safe-render     Turn off WebKit's DMA-BUF renderer (default on NVIDIA, where it can freeze)
  --no-safe-render  Keep WebKit's DMA-BUF renderer, even on NVIDIA
  --no-watchdog     Never restart Stremio when it freezes
  --analyze DIR     Print the report for an earlier recording
  --app ID          Flatpak app to run (default: $APP_ID)
  --port N          Local UI port (default: $PORT; changing it means a separate login)
Recordings and the last session's report are in $STATE_DIR.
EOF
}

# Reports get pasted into chats, so home paths, the user name and the host name never go in them.
sanitize() {
    local host user
    host="$(cat /proc/sys/kernel/hostname 2>/dev/null)"
    user="${USER:-$(id -un)}"
    local -a rules=(-e "s|$HOME|~|g")
    [ "${#user}" -ge 3 ] && rules+=(-e "s|\\b$user\\b|<user>|g")
    [ "${#host}" -ge 3 ] && rules+=(-e "s|\\b$host\\b|<host>|g")
    sed "${rules[@]}"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --normal) BIG_PICTURE=0 ;;
        --diagnose) DIAGNOSE=1 ;;
        --safe-render) SAFE_RENDER=1 ;;
        --no-safe-render) SAFE_RENDER=0 ;;
        --no-watchdog) WATCHDOG=0 ;;
        --analyze) python3 -I "$SELF_DIR/diagnose.py" analyze "$2" | sanitize; exit "${PIPESTATUS[0]}" ;;
        --app) APP_ID="$2"; shift ;;
        --port) PORT="$2"; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
    esac
    shift
done

UI_DIR=""
for candidate in "$SELF_DIR/ui" "$SELF_DIR/../ui" "$SELF_DIR/../build"; do
    [ -f "$candidate/index.html" ] && UI_DIR="$candidate" && break
done
[ -n "$UI_DIR" ] || { echo "No UI found next to $SELF_DIR. Run install.sh from a bundle first." >&2; exit 66; }

port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }
app_running() { flatpak ps --columns=application 2>/dev/null | grep -qx "$APP_ID"; }
now_ms() { date +%s%3N; }

# A second launch would only raise the existing window and ignore the UI address.
if app_running; then
    echo "Stremio is already running. Quit it (also from the tray), then launch again." >&2
    exit 75
fi
if port_open "$PORT"; then
    echo "Port $PORT is already in use. Close what uses it, or pass --port (that means a separate login)." >&2
    exit 75
fi

if [ "$SAFE_RENDER" = auto ]; then
    SAFE_RENDER=0
    [ -e /dev/nvidia0 ] && SAFE_RENDER=1
fi

# A new recording per session; older ones beyond the last few are removed.
mkdir -p "$STATE_DIR"
RECORDING="$STATE_DIR/session-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RECORDING"
find "$STATE_DIR" -maxdepth 1 -type d -name 'session-*' | sort | head -n -"$KEEP_RECORDINGS" | xargs -r rm -rf
echo "bigpicture=$BIG_PICTURE safe-render=$SAFE_RENDER watchdog=$WATCHDOG bundle=$(cut -d, -f1 "$SELF_DIR/VERSION" 2>/dev/null)" > "$RECORDING/options"

QUERY=("diagnostics=1")
[ "$BIG_PICTURE" = 1 ] && QUERY=("bigpicture=1" "${QUERY[@]}")
URL="http://127.0.0.1:$PORT/?$(IFS='&'; echo "${QUERY[*]}")"
APP_ARGS=(--env=RUST_LOG=info)
[ "$SAFE_RENDER" = 1 ] && APP_ARGS+=(--env=WEBKIT_DISABLE_DMABUF_RENDERER=1)

SERVER_PID=""
SAMPLER_PID=""
APP_PID=""
cleanup() {
    [ -n "$APP_PID" ] && kill "$APP_PID" 2>/dev/null
    [ -n "$SAMPLER_PID" ] && kill "$SAMPLER_PID" 2>/dev/null
    [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null
    python3 -I "$SELF_DIR/diagnose.py" analyze "$RECORDING" | sanitize > "$STATE_DIR/last-report.txt"
    if [ "$DIAGNOSE" = 1 ]; then
        cp "$STATE_DIR/last-report.txt" "$FREEZE_REPORT"
        echo "Freeze report: $FREEZE_REPORT"
    fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

python3 "$SELF_DIR/serve.py" "$UI_DIR" --port "$PORT" --report "$RECORDING/page.jsonl" &
SERVER_PID=$!
for _ in $(seq 1 20); do
    port_open "$PORT" && break
    sleep 0.25
done
port_open "$PORT" || { echo "The local UI server did not start." >&2; exit 70; }
python3 -I "$SELF_DIR/diagnose.py" sample "$RECORDING" &
SAMPLER_PID=$!

start_app() {
    STARTED_MS=$(now_ms)
    flatpak run "${APP_ARGS[@]}" "$APP_ID" "--url=$URL" >> "$RECORDING/shell.log" 2>&1 &
    APP_PID=$!
}

stop_app() {
    flatpak kill "$APP_ID" >/dev/null 2>&1
    for _ in $(seq 1 40); do
        app_running || break
        sleep 0.25
    done
    kill "$APP_PID" 2>/dev/null
    wait "$APP_PID" 2>/dev/null
    APP_PID=""
    # The streaming server inside the app must release its port before a new start.
    for _ in $(seq 1 40); do
        port_open 11470 || break
        sleep 0.25
    done
}

RESTARTS=()
start_app
LAST_TICK=$(date +%s)
while kill -0 "$APP_PID" 2>/dev/null; do
    sleep 5
    TICK=$(date +%s)
    # The system was asleep: heartbeats stopped for a good reason. Start the clocks over.
    if [ $((TICK - LAST_TICK)) -gt 20 ]; then
        STARTED_MS=$(now_ms)
        LAST_TICK=$TICK
        continue
    fi
    LAST_TICK=$TICK
    [ "$WATCHDOG" = 1 ] || continue

    REASON="$(python3 -I "$SELF_DIR/diagnose.py" check "$RECORDING" "$STARTED_MS")"
    [ -n "$REASON" ] || continue
    RECENT=()
    for RESTART in "${RESTARTS[@]}"; do
        [ $((TICK - RESTART)) -lt "$RESTART_WINDOW" ] && RECENT+=("$RESTART")
    done
    RESTARTS=("${RECENT[@]}")
    if [ "${#RESTARTS[@]}" -ge "$MAX_RESTARTS" ]; then
        echo "WATCHDOG GAVE UP at $(date +%H:%M:%S): $REASON, but it already restarted Stremio $MAX_RESTARTS times in $((RESTART_WINDOW / 60)) minutes." >> "$RECORDING/events.log"
        WATCHDOG=0
        continue
    fi
    echo "WATCHDOG RESTARTED STREMIO at $(date +%H:%M:%S): $REASON." >> "$RECORDING/events.log"
    RESTARTS+=("$TICK")
    stop_app
    start_app
done
wait "$APP_PID" 2>/dev/null
APP_PID=""
