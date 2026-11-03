#!/usr/bin/env bash
# Stremio Big Picture: build the UI and run the keyboard-only tests.
# Usage: e2e/run.sh [--no-build] [playwright test arguments...]
#
# Runs in the official Playwright container when Docker or Podman is available,
# because Playwright's WebKit (the engine of the Linux shell) only supports the
# libraries of Ubuntu and Debian. Set E2E_CONTAINER=0 to run on the host instead.
# SPDX-License-Identifier: GPL-2.0-only
set -eu

E2E="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
REPO="$(dirname "$E2E")"
PNPM="${PNPM:-npx -y pnpm@11.8.0}"
PLAYWRIGHT_VERSION="1.64.1"
IMAGE="mcr.microsoft.com/playwright:v$PLAYWRIGHT_VERSION-noble"

BUILD=1
if [ "${1:-}" = "--no-build" ]; then
    BUILD=0
    shift
fi

if [ "$BUILD" = 1 ]; then
    # Same build as the TV bundle: no service worker, so tests never see a stale UI.
    (cd "$REPO" && SERVICE_WORKER_DISABLED=true $PNPM build)
fi
[ -f "$REPO/build/index.html" ] || { echo "No build in $REPO/build. Run without --no-build." >&2; exit 1; }

cd "$E2E"
# The player tests play a short WebM clip; it is generated, not kept in git.
if [ ! -s fixtures/clip.webm ] && command -v ffmpeg >/dev/null 2>&1; then
    mkdir -p fixtures
    ffmpeg -hide_banner -loglevel error -y \
        -f lavfi -i "testsrc2=size=640x360:rate=25:duration=120" \
        -f lavfi -i "sine=frequency=440:duration=120" \
        -c:v libvpx -b:v 300k -c:a libvorbis fixtures/clip.webm
fi
# --ignore-workspace: this package is separate from the upstream one on purpose.
[ -d node_modules/@playwright/test ] || $PNPM install --ignore-workspace

ENGINE=""
if [ "${E2E_CONTAINER:-1}" != 0 ]; then
    for candidate in docker podman; do
        if command -v "$candidate" >/dev/null 2>&1 && "$candidate" info >/dev/null 2>&1; then
            ENGINE="$candidate"
            break
        fi
    done
fi

if [ -n "$ENGINE" ]; then
    # Files the tests write stay owned by you.
    USER_ARGS=(--user "$(id -u):$(id -g)")
    [ "$ENGINE" = podman ] && USER_ARGS=(--userns=keep-id)
    # No core dumps: WebKit's test build aborts on purpose when a test closes its page,
    # and on a desktop each dump would raise the system's crash dialog (KDE's DrKonqi).
    exec "$ENGINE" run --rm --network host --ipc host --ulimit core=0 "${USER_ARGS[@]}" -e HOME=/tmp -e CI -e E2E_WORKERS -e E2E_SHOTS \
        -v "$REPO:$REPO" -w "$E2E" "$IMAGE" node_modules/.bin/playwright test "$@"
fi

echo "No usable Docker or Podman: running on the host." >&2
ulimit -c 0  # no crash dialogs for test browsers' deliberate aborts (see above)
$PNPM exec playwright install chromium
if $PNPM exec playwright install webkit >/dev/null 2>&1; then
    exec $PNPM exec playwright test "$@"
fi
echo "WARNING: this system lacks Playwright WebKit's libraries; only Chromium runs. The TV shell uses WebKit." >&2
exec $PNPM exec playwright test --project=chromium "$@"
