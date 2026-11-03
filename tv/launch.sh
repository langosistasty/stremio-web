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
RENDER=auto
SOAK=0
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
  --render MODE     How Stremio draws the interface (default: auto). Modes:
                      wayland        WebKit's DMA-BUF renderer on Wayland (auto, except on NVIDIA)
                      wayland-safe   DMA-BUF renderer off (--safe-render)
                      wayland-vulkan DMA-BUF renderer off, GTK's Vulkan renderer
                      wayland-cpu    WebKit's GPU compositing off; pages are painted by the CPU
                      x11            Through XWayland, DMA-BUF renderer on
                      x11-safe       Through XWayland, DMA-BUF renderer off
  --safe-render     Same as --render wayland-safe
  --no-safe-render  Same as --render wayland
  --soak            Let the page browse by itself, to test a renderer for freezes unattended
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
        --render) RENDER="${2:-}"; shift ;;
        --safe-render) RENDER=wayland-safe ;;
        --no-safe-render) RENDER=wayland ;;
        --soak) SOAK=1 ;;
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

# Started from a desktop entry there's no terminal: say it on screen as well.
tell() {
    echo "$1" >&2
    if command -v notify-send >/dev/null 2>&1; then
        notify-send --app-name="Stremio Big Picture" --icon=com.stremio.Stremio "Stremio Big Picture" "$1" 2>/dev/null
    elif command -v kdialog >/dev/null 2>&1; then
        kdialog --title "Stremio Big Picture" --passivepopup "$1" 10 2>/dev/null
    fi
}

# The process listening on a local port, if it is ours to see.
port_owner() {
    ss -ltnpH "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2
}

if app_running; then
    if port_open "$PORT"; then
        # Big Picture is already open: bring its window up rather than start another.
        flatpak run "$APP_ID" >/dev/null 2>&1 &
        exit 0
    fi
    # A second start would only raise the normal Stremio window and ignore this UI.
    tell "Stremio is already open. Quit it from its tray icon, then open Stremio Big Picture again."
    exit 75
fi
if port_open "$PORT"; then
    # Left over from a session that crashed: our own UI server can go.
    OWNER="$(port_owner "$PORT")"
    if [ -n "$OWNER" ] && tr '\0' ' ' < "/proc/$OWNER/cmdline" 2>/dev/null | grep -q 'serve.py'; then
        kill "$OWNER" 2>/dev/null
        for _ in $(seq 1 20); do
            port_open "$PORT" || break
            sleep 0.25
        done
    fi
    if port_open "$PORT"; then
        tell "Port $PORT is in use by another program, so Stremio Big Picture can't start. Close it, or use --port (that means a separate login)."
        exit 75
    fi
fi

if [ "$RENDER" = auto ]; then
    RENDER=wayland
    [ -e /dev/nvidia0 ] && RENDER=wayland-safe
fi
# Flatpak options per mode. Stremio's own start script forces GTK's OpenGL renderer on
# NVIDIA, so the Vulkan mode starts the shell binary directly.
NO_DMABUF=--env=WEBKIT_DISABLE_DMABUF_RENDERER=1
X11=(--socket=x11 --env=GDK_BACKEND=x11)
case "$RENDER" in
    wayland) RENDER_ARGS=() ;;
    wayland-safe) RENDER_ARGS=("$NO_DMABUF") ;;
    wayland-vulkan) RENDER_ARGS=("$NO_DMABUF" --env=GSK_RENDERER=vulkan --command=/app/libexec/stremio/stremio) ;;
    wayland-cpu) RENDER_ARGS=(--env=WEBKIT_DISABLE_COMPOSITING_MODE=1) ;;
    x11) RENDER_ARGS=("${X11[@]}") ;;
    x11-safe) RENDER_ARGS=("${X11[@]}" "$NO_DMABUF") ;;
    *) echo "Unknown render mode: $RENDER" >&2; usage >&2; exit 64 ;;
esac

# A new recording per session; older ones beyond the last few are removed.
mkdir -p "$STATE_DIR"
RECORDING="$STATE_DIR/session-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$RECORDING"
find "$STATE_DIR" -maxdepth 1 -type d -name 'session-*' | sort | head -n -"$KEEP_RECORDINGS" | xargs -r rm -rf
echo "bigpicture=$BIG_PICTURE render=$RENDER soak=$SOAK watchdog=$WATCHDOG bundle=$(cut -d, -f1 "$SELF_DIR/VERSION" 2>/dev/null)" > "$RECORDING/options"

QUERY=("diagnostics=1")
[ "$SOAK" = 1 ] && QUERY+=("soak=1")
[ "$BIG_PICTURE" = 1 ] && QUERY=("bigpicture=1" "${QUERY[@]}")
URL="http://127.0.0.1:$PORT/?$(IFS='&'; echo "${QUERY[*]}")"
APP_ARGS=(--env=RUST_LOG=info "${RENDER_ARGS[@]}")

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

# The streaming server accepts this UI's address only because of how the shell sets
# NO_CORS (see BIGPICTURE.md). Check once per session, so an upstream change is caught.
check_cors() {
    for _ in $(seq 1 120); do
        port_open 11470 && break
        sleep 0.5
    done
    local allowed
    allowed="$(python3 -I - "http://127.0.0.1:$PORT" <<'PY'
import sys, urllib.request
request = urllib.request.Request("http://127.0.0.1:11470/settings", headers={"Origin": sys.argv[1]})
try:
    with urllib.request.urlopen(request, timeout=5) as response:
        print(response.headers.get("Access-Control-Allow-Origin") or "none")
except Exception as error:
    print(f"error: {error}")
PY
)"
    case "$allowed" in
        "*"|"http://127.0.0.1:$PORT") echo "CORS OK: the streaming server accepts this UI ($allowed)." >> "$RECORDING/events.log.info" ;;
        error:*) echo "CORS CHECK could not reach the streaming server: ${allowed#error: }." >> "$RECORDING/events.log" ;;
        *)
            echo "CORS CHECK FAILED: the streaming server no longer accepts this UI's address (it answered: $allowed). Playback and server settings won't work; see BIGPICTURE.md." >> "$RECORDING/events.log"
            tell "The Stremio streaming server rejects this UI's address after an update, so playing won't work. See BIGPICTURE.md, \"Known fragile point\"."
            ;;
    esac
}

RESTARTS=()
start_app
check_cors &
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
