#!/usr/bin/env bash
# Stremio Big Picture: check whether this PC can run the TV stack, and write a report.
# Detects hardware and distro at runtime, and changes nothing on the system.
# SPDX-License-Identifier: GPL-2.0-only
set -u

SELF_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
APP_ID="com.stremio.Stremio"
PORT=18470
STATIC_ONLY=0
PROBE_SECONDS=25
WINDOW_SECONDS=12
START_TIMEOUT=60
REPORT="$HOME/stremio-bigpicture-report.txt"

usage() {
    cat <<EOF
Usage: doctor.sh [options]
  --static          Only inspect the system; do not open Stremio
  --app ID          Flatpak app to test (default: $APP_ID)
  --port N          Local UI port (default: $PORT)
  --report FILE     Report path (default: ~/stremio-bigpicture-report.txt)
EOF
}

while [ $# -gt 0 ]; do
    case "$1" in
        --static) STATIC_ONLY=1 ;;
        --app) APP_ID="$2"; shift ;;
        --port) PORT="$2"; shift ;;
        --report) REPORT="$2"; shift ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $1" >&2; usage >&2; exit 64 ;;
    esac
    shift
done

# The bundle keeps ui/ and samples/ next to this script.
UI_DIR=""
SAMPLES_DIR=""
SERVE_PY=""
PROBE_DIR=""
for base in "$SELF_DIR" "$SELF_DIR/.."; do
    [ -z "$UI_DIR" ] && [ -f "$base/ui/index.html" ] && UI_DIR="$base/ui"
    [ -z "$SAMPLES_DIR" ] && [ -d "$base/samples" ] && SAMPLES_DIR="$base/samples"
done
[ -z "$UI_DIR" ] && [ -f "$SELF_DIR/../build/index.html" ] && UI_DIR="$SELF_DIR/../build"
[ -f "$SELF_DIR/serve.py" ] && SERVE_PY="$SELF_DIR/serve.py"
[ -d "$SELF_DIR/probe" ] && PROBE_DIR="$SELF_DIR/probe"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/stremio-doctor.XXXXXX")"
SERVER_PID=""
APP_PID=""
PASS_COUNT=0
WARN_COUNT=0
FAIL_COUNT=0
PLAYED_HW=0
PLAYED_ANY=0
UNCONFIRMED=0

: > "$REPORT" || { echo "Cannot write $REPORT" >&2; exit 73; }

# Reports get pasted into chats, so home paths and the host name never go in them.
sanitize() {
    local host user
    host="$(cat /proc/sys/kernel/hostname 2>/dev/null)"
    user="${USER:-$(id -un)}"
    local -a rules=(-e "s|$HOME|~|g")
    [ "${#user}" -ge 3 ] && rules+=(-e "s|\\b$user\\b|<user>|g")
    [ "${#host}" -ge 3 ] && rules+=(-e "s|\\b$host\\b|<host>|g")
    sed "${rules[@]}"
}
say() { printf '%s\n' "$*" | sanitize | tee -a "$REPORT"; }
heading() { say ""; say "== $* =="; }
pass() { PASS_COUNT=$((PASS_COUNT + 1)); say "[PASS] $*"; }
warn() { WARN_COUNT=$((WARN_COUNT + 1)); say "[WARN] $*"; }
fail() { FAIL_COUNT=$((FAIL_COUNT + 1)); say "[FAIL] $*"; }
info() { say "       $*"; }
have() { command -v "$1" >/dev/null 2>&1; }

port_open() { (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null; }

stop_app() {
    [ -n "$APP_PID" ] || return 0
    flatpak kill "$APP_ID" >/dev/null 2>&1
    kill -- "-$APP_PID" >/dev/null 2>&1
    wait "$APP_PID" 2>/dev/null
    APP_PID=""
    local i
    for i in $(seq 1 20); do
        port_open 11470 || break
        sleep 0.25
    done
}

cleanup() {
    stop_app
    [ -n "$SERVER_PID" ] && kill "$SERVER_PID" >/dev/null 2>&1
    rm -rf "$WORK"
}
trap cleanup EXIT
trap 'exit 130' INT TERM

# Terminals started outside the graphical session (a TTY, a launcher) may lack these.
prepare_session_env() {
    export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"
    if [ -z "${WAYLAND_DISPLAY:-}" ] && [ -z "${DISPLAY:-}" ]; then
        local socket
        socket="$(find "$XDG_RUNTIME_DIR" -maxdepth 1 -type s -name 'wayland-*' 2>/dev/null | head -1)"
        if [ -n "$socket" ]; then
            export WAYLAND_DISPLAY="${socket##*/}"
        elif [ -S /tmp/.X11-unix/X0 ]; then
            export DISPLAY=":0"
        fi
    fi
    [ -z "${DBUS_SESSION_BUS_ADDRESS:-}" ] && [ -S "$XDG_RUNTIME_DIR/bus" ] \
        && export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
}

gpu_rows() {
    local card vendor device driver
    for card in /sys/class/drm/card[0-9]*; do
        case "$card" in *-*) continue ;; esac
        [ -r "$card/device/vendor" ] || continue
        vendor="$(cat "$card/device/vendor")"
        device="$(cat "$card/device/device" 2>/dev/null)"
        driver="$(basename "$(readlink -f "$card/device/driver" 2>/dev/null)")"
        printf '%s %s %s\n' "$vendor" "$device" "$driver"
    done
}

check_system() {
    heading "System"
    local name="unknown" like=""
    if [ -r /etc/os-release ]; then
        name="$(. /etc/os-release; echo "${PRETTY_NAME:-$NAME}")"
        like="$(. /etc/os-release; echo "${ID:-} ${ID_LIKE:-}")"
    fi
    DISTRO_LIKE="$like"
    info "Distro:  $name"
    info "Kernel:  $(uname -r)"
    info "CPU:     $(grep -m1 'model name' /proc/cpuinfo | cut -d: -f2- | sed 's/^ *//') ($(nproc) threads)"
    info "RAM:     $(awk '/MemTotal/ {printf "%.1f GiB", $2/1048576}' /proc/meminfo)"
    info "Session: type=${XDG_SESSION_TYPE:-unknown} desktop=${XDG_CURRENT_DESKTOP:-unknown} wayland=${WAYLAND_DISPLAY:-none} x11=${DISPLAY:-none}"
    if [ -z "${WAYLAND_DISPLAY:-}" ] && [ -z "${DISPLAY:-}" ]; then
        fail "No graphical session found. Run this from a terminal on the TV's desktop."
    fi

    local bigscreen="not detected"
    if pgrep -f 'plasma-bigscreen|org\.kde\.plasma\.bigscreen' >/dev/null 2>&1; then
        bigscreen="running"
    elif have plasma-bigscreen-inputhandler || [ -e /usr/share/wayland-sessions/plasma-bigscreen-wayland.desktop ]; then
        bigscreen="installed, not running in this session"
    fi
    info "Plasma Bigscreen: $bigscreen"
    if pgrep -f plasma-bigscreen-inputhandler >/dev/null 2>&1; then
        info "Bigscreen input handler is running; watch the double-input result below."
    fi
}

check_gpu() {
    heading "GPU"
    local rows has_nvidia=0 vendor device driver label
    rows="$(gpu_rows)"
    if have lspci; then
        lspci 2>/dev/null | grep -Ei 'vga|3d controller|display controller' | sed 's/^[0-9a-f:.]* //' | while IFS= read -r line; do info "$line"; done
    fi
    [ -n "$rows" ] || warn "No GPU found under /sys/class/drm; hardware decoding is unlikely to work."
    while read -r vendor device driver; do
        [ -n "${vendor:-}" ] || continue
        case "$vendor" in
            0x10de) label="NVIDIA"; has_nvidia=1 ;;
            0x1002) label="AMD" ;;
            0x8086) label="Intel" ;;
            *) label="$vendor" ;;
        esac
        info "Device:  $label $device, kernel driver: ${driver:-none}"
        [ "$vendor" = "0x10de" ] && [ "$driver" = "nouveau" ] \
            && warn "NVIDIA card on nouveau: NVDEC needs the proprietary driver, so expect software decoding."
    done <<< "$rows"

    [ "$has_nvidia" = 1 ] && check_nvidia
    if have vainfo; then
        info "VA-API:  $(vainfo 2>/dev/null | grep -m1 -i 'driver version' | cut -d: -f2- | sed 's/^ *//')"
    fi
}

check_nvidia() {
    NVIDIA_PRESENT=1
    if ! have nvidia-smi; then
        warn "nvidia-smi not found: the proprietary driver looks missing."
        nvidia_driver_hint
        return
    fi
    local gpu_name version major
    gpu_name="$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -1)"
    version="$(nvidia-smi --query-gpu=driver_version --format=csv,noheader 2>/dev/null | head -1)"
    major="${version%%.*}"
    info "NVIDIA:  ${gpu_name:-unknown}, driver ${version:-unknown}"
    NVIDIA_VERSION="$version"

    if [ -z "$version" ]; then
        fail "nvidia-smi cannot talk to the driver. Reboot after driver updates, or reinstall the driver."
        return
    fi
    # NVIDIA's 590 branch dropped Maxwell, Pascal and Volta; 580 is their final branch.
    if printf '%s' "$gpu_name" | grep -Eqi 'GTX (9[0-9]{2}|10[0-9]{2})|GT 10[0-9]{2}|TITAN (X|V|Xp)' && [ "${major:-0}" -ge 590 ]; then
        fail "$gpu_name is not supported by driver branch $major. It needs the 580 legacy branch."
        nvidia_driver_hint
    else
        pass "NVIDIA driver is loaded"
    fi

    # Some driver packages make this file root-only. A Wayland session that is already
    # running on the NVIDIA driver proves modesetting is on, so only a readable N warns.
    local modeset
    modeset="$(cat /sys/module/nvidia_drm/parameters/modeset 2>/dev/null)"
    if [ "${WAYLAND_DISPLAY:-}" != "" ] && [ "$modeset" = "N" ]; then
        warn "nvidia-drm.modeset is N; Wayland normally needs Y."
    fi
}

nvidia_driver_hint() {
    case " ${DISTRO_LIKE:-} " in
        *" fedora "*) info "Fedora: enable RPM Fusion nonfree, then install akmod-nvidia-580xx and xorg-x11-drv-nvidia-580xx-cuda (GTX 900/10xx), or akmod-nvidia and xorg-x11-drv-nvidia-cuda on newer cards." ;;
        *" arch "*) info "Arch: install nvidia-580xx-dkms from the AUR (GTX 900/10xx), or nvidia-open on newer cards." ;;
        *" debian "*|*" ubuntu "*) info "Debian/Ubuntu: use your distro's driver tool to install a branch that supports this card." ;;
        *) info "Install the newest NVIDIA driver branch that still supports this card, from your distro's repositories." ;;
    esac
}

check_flatpak() {
    heading "Stremio shell"
    if ! have flatpak; then
        fail "Flatpak is not installed. Install it with your distro's package manager, then add Flathub."
        return 1
    fi
    if ! flatpak info "$APP_ID" >/dev/null 2>&1; then
        fail "$APP_ID is not installed. Run: flatpak install flathub $APP_ID"
        return 1
    fi
    pass "$APP_ID $(flatpak info "$APP_ID" 2>/dev/null | awk -F': *' '/Version:/ {print $2; exit}') is installed"
    local runtime
    runtime="$(flatpak info --show-runtime "$APP_ID" 2>/dev/null)"
    info "Runtime: $runtime"
    if flatpak info --show-permissions "$APP_ID" 2>/dev/null | grep -q '^devices=.*all'; then
        info "Device access: all (gamepads and GPU are visible to the app)"
    else
        warn "The app has no 'devices=all' permission; gamepads or the GPU may be hidden. Fix: flatpak override --user --device=all $APP_ID"
    fi

    # Flatpak apps use NVIDIA's libraries through an extension matching the host driver exactly.
    if [ -n "${NVIDIA_VERSION:-}" ]; then
        local extension="org.freedesktop.Platform.GL.nvidia-${NVIDIA_VERSION//./-}"
        if flatpak list --runtime --columns=application 2>/dev/null | grep -qx "$extension"; then
            pass "Flatpak has the NVIDIA libraries matching this driver ($extension)"
        else
            warn "$extension is missing, so the app has no NVDEC. Run: flatpak update"
        fi
    fi
    return 0
}

check_input_devices() {
    heading "Input devices"
    local names
    names="$(grep -E '^N: Name=' /proc/bus/input/devices 2>/dev/null | sed -e 's/^N: Name="//' -e 's/"$//' \
        | grep -Eiv 'power button|sleep button|video bus|hda |hdmi|pc speaker|lid switch|wmi|hotkeys' | sort -u)"
    if [ -n "$names" ]; then
        while IFS= read -r line; do info "$line"; done <<< "$names"
    else
        info "None readable"
    fi
    if ! grep -Eq 'H: Handlers=.*js[0-9]' /proc/bus/input/devices 2>/dev/null; then
        info "No gamepad connected right now. Connect it before the input test if you plan to use one."
    fi
}

start_server() {
    local root="$WORK/root"
    local -a mounts=(--mount "probe=$PROBE_DIR")
    mkdir -p "$root"
    [ -n "$UI_DIR" ] && mounts+=(--mount "ui=$UI_DIR")
    [ -n "$SAMPLES_DIR" ] && mounts+=(--mount "samples=$SAMPLES_DIR")
    python3 "$SERVE_PY" "$root" --port "$PORT" "${mounts[@]}" --report "$WORK/probe-report.jsonl" 2>"$WORK/serve.err" &
    SERVER_PID=$!
    local i
    for i in $(seq 1 20); do
        port_open "$PORT" && break
        sleep 0.25
    done
    if ! port_open "$PORT"; then
        fail "The local server did not start: $(cat "$WORK/serve.err")"
        return 1
    fi
    if ! python3 -I -c "import sys, urllib.request; urllib.request.urlopen(sys.argv[1], timeout=5)" \
        "http://127.0.0.1:$PORT/probe/index.html" 2>/dev/null; then
        fail "The local server is running but cannot serve the test page."
        return 1
    fi
}

# The same rendering as launch.sh picks, so the doctor tests what you'll use: on NVIDIA,
# Skia paints on the CPU (see launch.sh and BIGPICTURE.md, "Freezes").
RENDER_ARGS=()
[ -e /dev/nvidia0 ] && RENDER_ARGS=(--env=WEBKIT_SKIA_ENABLE_CPU_RENDERING=1)

start_app() { # url log_level log_file
    setsid flatpak run "--env=RUST_LOG=$2" "${RENDER_ARGS[@]}" "$APP_ID" "--url=$1" >"$3" 2>&1 </dev/null &
    APP_PID=$!
}

probe_webkit() {
    heading "Input and WebKit test"
    say "A Stremio window opens for ${PROBE_SECONDS}s. Press your keyboard, remote and gamepad controls now."
    rm -f "$WORK/probe-report.jsonl"
    start_app "http://127.0.0.1:$PORT/probe/index.html?seconds=$PROBE_SECONDS" warn "$WORK/probe.log"
    local i
    for i in $(seq 1 $(( (PROBE_SECONDS + 25) * 2 ))); do
        [ -s "$WORK/probe-report.jsonl" ] && break
        sleep 0.5
    done
    stop_app
    if [ ! -s "$WORK/probe-report.jsonl" ]; then
        fail "The page inside the shell never reported back. The window may have been blank or failed to load."
        info "Shell log (last lines):"
        tail -n 8 "$WORK/probe.log" | sed 's/\x1b\[[0-9;]*m//g' | cut -c1-160 | while IFS= read -r line; do info "$line"; done
        return 1
    fi
    python3 -I - "$WORK/probe-report.jsonl" > "$WORK/probe-summary.txt" <<'EOF'
import json, sys
report = json.loads(open(sys.argv[1], encoding="utf-8").readline())
server = report["streamingServer"]
state = lambda ok: "PASS" if ok else "FAIL"
print(f"[{state(bool(report['shell']['ipcKey']))}] Shell IPC is available to the page")
print(f"[{state(server['reachable'])}] Page can reach the streaming server (cross-origin): {server.get('status', server.get('error'))}")
print(f"[{state(report['apis']['getGamepads'] == 'function')}] Gamepad API is available")
print(f"[{state(report['apis']['webAssembly'] == 'object')}] WebAssembly is available")
display = report["display"]
print(f"       Display: viewport {display['viewport']}, screen {display['screen']}, scale {display['devicePixelRatio']}")
print(f"       Keys pressed: {len(report['keys'])}")
seen = {}
for key in report["keys"]:
    seen[key["key"]] = (key["code"], key["keyCode"])
for name, (code, key_code) in seen.items():
    print(f"         {name}  code={code} keyCode={key_code}")
pads = report["gamepads"]
if pads:
    for pad in pads.values():
        print(f"       Gamepad: {pad['id']}, mapping={pad['mapping'] or 'none'}, {pad['buttons']} buttons, {pad['axes']} axes")
    buttons = sorted({e["button"] for e in report["gamepadEvents"] if "button" in e})
    axes = sorted({e["axis"] for e in report["gamepadEvents"] if "axis" in e})
    print(f"         Buttons seen: {buttons}; axes seen: {axes}")
    if report["doubleInputSuspected"]:
        print("[WARN] Gamepad presses also arrived as keys, so another program translates the pad. Big Picture must handle this to avoid double input.")
    elif report["gamepadEvents"]:
        print("[PASS] No double input: gamepad presses did not also arrive as keys")
else:
    print("[INFO] No gamepad seen. WebKit only reveals a pad after a button press during the test.")
EOF
    while IFS= read -r line; do
        case "$line" in
            "[PASS]"*) pass "${line#\[PASS\] }" ;;
            "[FAIL]"*) fail "${line#\[FAIL\] }" ;;
            "[WARN]"*) warn "${line#\[WARN\] }" ;;
            "[INFO]"*) info "${line#\[INFO\] }" ;;
            *) say "$line" ;;
        esac
    done < "$WORK/probe-summary.txt"
}

cpu_ticks() { awk '/^cpu / {idle=$5+$6; total=0; for (i=2;i<=NF;i++) total+=$i; print total, idle}' /proc/stat; }

clean_log() { tr '\r' '\n' < "$1" | sed 's/\x1b\[[0-9;]*m//g'; }

# mpv's frame counters only appear at debug log level, whose overhead distorts them, and
# the stock Flatpak has no way to load an mpv config. So the doctor reports the decoder,
# errors and load it can measure reliably, and asks the person watching about smoothness.
play_sample() { # file
    local file="$1" name encoded log="$WORK/play-$RANDOM.log"
    name="${file%.mkv}"
    encoded="$(python3 -I -c "
import base64, json, sys, urllib.parse, zlib
stream = json.dumps({'url': sys.argv[1], 'title': sys.argv[2]}, separators=(',', ':')).encode()
print(urllib.parse.quote(base64.b64encode(zlib.compress(stream, 0)).decode(), safe=''))
" "http://127.0.0.1:$PORT/samples/$file" "$name")"

    say ""
    say "--- $name ---"
    start_app "http://127.0.0.1:$PORT/ui/#/player/$encoded" info "$log"

    local waited=0 started=0
    while [ "$waited" -lt $((START_TIMEOUT * 2)) ]; do
        if clean_log "$log" | grep -q '^VO: \['; then
            started=1
            break
        fi
        kill -0 "$APP_PID" 2>/dev/null || break
        sleep 0.5
        waited=$((waited + 1))
    done
    if [ "$started" = 0 ]; then
        stop_app
        fail "$name did not start within ${START_TIMEOUT}s"
        clean_log "$log" | grep -Ei 'error|fail' | tail -n 5 | cut -c1-160 | while IFS= read -r line; do info "$line"; done
        return
    fi
    PLAYED_ANY=1
    sleep 3

    local cpu_total_start cpu_idle_start
    read -r cpu_total_start cpu_idle_start <<< "$(cpu_ticks)"
    local decoder_samples="" i value
    for i in $(seq 1 "$WINDOW_SECONDS"); do
        if have nvidia-smi; then
            value="$(nvidia-smi --query-gpu=utilization.decoder --format=csv,noheader,nounits 2>/dev/null | head -1)"
            decoder_samples="$decoder_samples $value"
        fi
        sleep 1
    done
    local cpu_total_end cpu_idle_end alive=0
    read -r cpu_total_end cpu_idle_end <<< "$(cpu_ticks)"
    kill -0 "$APP_PID" 2>/dev/null && alive=1
    stop_app

    local cpu=$(( 100 * ((cpu_total_end - cpu_total_start) - (cpu_idle_end - cpu_idle_start)) / (cpu_total_end - cpu_total_start + 1) ))
    local hwdec audio video decode_errors
    hwdec="$(clean_log "$log" | grep -oE 'Using hardware decoding \([^)]*\)' | tail -n 1 | sed -E 's/.*\((.*)\)/\1/')"
    audio="$(clean_log "$log" | grep -E '^AO: \[' | tail -n 1)"
    video="$(clean_log "$log" | grep -E '^VO: \[' | tail -n 1)"
    decode_errors="$(clean_log "$log" | grep -c 'Error while decoding frame')"

    info "Decoder: ${hwdec:-software}"
    info "Video:   ${video:-none}"
    info "Audio:   ${audio:-none}"
    info "Load:    whole-system CPU ${cpu}% over ${WINDOW_SECONDS}s"
    [ -n "$decoder_samples" ] && info "NVDEC use (%):$decoder_samples"
    case "$hwdec" in
        *-copy) info "Copy-back path: frames return to system memory, which costs CPU on 4K." ;;
    esac

    local smooth=""
    if [ -t 0 ]; then
        read -r -t 60 -p "$name: was the picture [s]mooth, [c]hoppy, or [n]ot visible? " smooth
    fi
    case "$smooth" in
        s|S) smooth="smooth" ;;
        c|C) smooth="choppy" ;;
        n|N) smooth="not visible" ;;
        *) smooth="not confirmed" ;;
    esac
    info "Seen on screen: $smooth"
    [ "$smooth" = "not confirmed" ] && UNCONFIRMED=1

    # Hardware decoding only counts if the GPU decoder kept working.
    local verdict_decoder="${hwdec:-software}"
    if [ "$decode_errors" -gt 0 ]; then
        verdict_decoder="software (after ${hwdec:-hardware} errors)"
    elif [ -n "$hwdec" ] && [ "$smooth" != "not visible" ]; then
        PLAYED_HW=1
    fi

    if [ "$alive" = 0 ]; then
        fail "$name: the app exited during playback"
    elif [ "$smooth" = "not visible" ]; then
        fail "$name decoded but no picture appeared; the video layer does not work in this GPU and session"
    elif [ "$smooth" = "choppy" ]; then
        warn "$name is choppy here (decoder: $verdict_decoder, CPU ${cpu}%)"
    elif [ "$decode_errors" -gt 0 ] || [ -z "$hwdec" ]; then
        warn "$name uses $verdict_decoder (CPU ${cpu}%). This GPU or driver has no working hardware path for it."
    elif [ "$cpu" -ge 85 ]; then
        warn "$name uses $verdict_decoder, but the CPU is near its limit (${cpu}%)"
    else
        pass "$name uses $verdict_decoder (CPU ${cpu}%)"
    fi
}

check_playback() {
    heading "Playback test"
    if [ -z "$UI_DIR" ] || [ -z "$SAMPLES_DIR" ]; then
        warn "Skipped: this needs ui/ and samples/ from the bundle made by tv/package.sh."
        return
    fi
    say "Each clip plays silently for about ${WINDOW_SECONDS}s. Watch the TV, then answer in this terminal."
    local path
    for path in "$SAMPLES_DIR"/*.mkv; do
        [ -e "$path" ] || { warn "No samples found in $SAMPLES_DIR"; return; }
        play_sample "$(basename "$path")"
    done
    [ "$UNCONFIRMED" = 1 ] && warn "Picture and smoothness were not confirmed by eye for every clip."
}

summary() {
    heading "Result"
    local verdict
    if [ "$STATIC_ONLY" = 1 ]; then
        verdict="STATIC ONLY: rerun without --static to test playback"
    elif [ "$FAIL_COUNT" -gt 0 ]; then
        verdict="NO-GO: fix the FAIL lines above, then rerun"
    elif [ "$PLAYED_HW" = 1 ] && [ "$UNCONFIRMED" = 1 ]; then
        verdict="PROBABLY GO: hardware decoding runs, but nobody confirmed the picture. Rerun in a terminal and answer the prompts"
    elif [ "$PLAYED_HW" = 1 ]; then
        verdict="GO: the stack works with hardware decoding"
    elif [ "$PLAYED_ANY" = 1 ]; then
        verdict="GO WITH LIMITS: it plays, but only with software decoding"
    else
        verdict="NOT TESTED: no sample played"
    fi
    say "$verdict"
    say "Passed $PASS_COUNT, warnings $WARN_COUNT, failed $FAIL_COUNT"
    say "Report: $REPORT"
    if [ "$FAIL_COUNT" -gt 0 ]; then return 2; fi
    return 0
}

main() {
    prepare_session_env
    {
        printf 'Stremio Big Picture doctor report, %s\n' "$(date -u '+%Y-%m-%d %H:%M UTC')"
        [ -f "$SELF_DIR/VERSION" ] && printf 'Bundle: %s\n' "$(cat "$SELF_DIR/VERSION")"
    } | tee -a "$REPORT"

    check_system
    check_gpu
    check_input_devices
    local flatpak_ok=1
    check_flatpak || flatpak_ok=0

    if [ "$STATIC_ONLY" = 0 ] && [ "$flatpak_ok" = 1 ]; then
        if ! have python3; then
            fail "python3 is required for the live tests. Install it with your distro's package manager."
        elif [ -z "$SERVE_PY" ] || [ -z "$PROBE_DIR" ]; then
            fail "serve.py or probe/ is missing next to this script."
        elif flatpak ps --columns=application 2>/dev/null | grep -qx "$APP_ID"; then
            fail "Stremio is already running. Close it (also from the tray), then rerun."
        elif port_open 11470; then
            fail "Port 11470 is in use, so another Stremio server is running. Stop it, then rerun."
        elif port_open "$PORT"; then
            fail "Port $PORT is in use. Rerun with --port N."
        elif start_server; then
            probe_webkit
            check_playback
        fi
    fi
    summary
}

main
