#!/usr/bin/env bash
# Stremio Big Picture: open the unmodified Stremio Flatpak with this UI, served locally.
# Stremio quits when you close the window; the local server stops with it.
# SPDX-License-Identifier: GPL-2.0-only
set -u

SELF_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
APP_ID="com.stremio.Stremio"
# The port is part of the page's origin, which keeps your login and settings.
# Changing it starts from a blank profile.
PORT=18470
QUERY="bigpicture=1"

usage() {
    cat <<EOF
Usage: launch.sh [options]
  --normal       Use the saved setting instead of forcing Big Picture on
  --app ID       Flatpak app to run (default: $APP_ID)
  --port N       Local UI port (default: $PORT; changing it means a separate login)
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --normal) QUERY="" ;;
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

# A second launch would only raise the existing window and ignore the UI address.
if flatpak ps --columns=application 2>/dev/null | grep -qx "$APP_ID"; then
    echo "Stremio is already running. Quit it (also from the tray), then launch again." >&2
    exit 75
fi
if port_open "$PORT"; then
    echo "Port $PORT is already in use. Close what uses it, or pass --port (that means a separate login)." >&2
    exit 75
fi

python3 "$SELF_DIR/serve.py" "$UI_DIR" --port "$PORT" &
SERVER_PID=$!
trap 'kill "$SERVER_PID" 2>/dev/null' EXIT
trap 'exit 130' INT TERM
for _ in $(seq 1 20); do
    port_open "$PORT" && break
    sleep 0.25
done
port_open "$PORT" || { echo "The local UI server did not start." >&2; exit 70; }

flatpak run "$APP_ID" "--url=http://127.0.0.1:$PORT/${QUERY:+?$QUERY}"
