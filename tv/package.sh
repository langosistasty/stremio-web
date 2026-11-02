#!/usr/bin/env bash
# Stremio Big Picture: build a bundle on the dev machine to copy to the TV PC by any means.
# SPDX-License-Identifier: GPL-2.0-only
set -eu

REPO="$(cd "$(dirname "$(readlink -f "$0")")/.." && pwd)"
OUT="${OUT:-$REPO/../tv-dist}"
PNPM="${PNPM:-npx -y pnpm@11.8.0}"

mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
SAMPLES="$OUT/samples"

# Synthetic test clips with silent 5.1 audio. They exercise each decoder path; they
# are not a substitute for a real high-bitrate film. Made once and reused.
make_sample() { # name size encoder_args...
    local name="$1" size="$2"
    shift 2
    [ -s "$SAMPLES/$name.mkv" ] && return 0
    echo "Encoding sample $name"
    ffmpeg -hide_banner -loglevel error -y \
        -f lavfi -i "testsrc2=size=$size:rate=24:duration=30" \
        -f lavfi -i "anullsrc=channel_layout=5.1:sample_rate=48000" -t 30 \
        "$@" -c:a ac3 -b:a 384k "$SAMPLES/.$name.tmp.mkv"
    mv "$SAMPLES/.$name.tmp.mkv" "$SAMPLES/$name.mkv"
}

command -v ffmpeg >/dev/null 2>&1 || { echo "ffmpeg is required to make the test samples." >&2; exit 69; }
mkdir -p "$SAMPLES"
make_sample 1-h264-1080p 1920x1080 -c:v libx264 -preset veryfast -pix_fmt yuv420p
make_sample 2-hevc-10bit-1080p 1920x1080 -c:v libx265 -preset ultrafast -x265-params log-level=error -pix_fmt yuv420p10le
make_sample 3-hevc-10bit-4k 3840x2160 -c:v libx265 -preset ultrafast -x265-params log-level=error -pix_fmt yuv420p10le
make_sample 4-av1-1080p 1920x1080 -c:v libsvtav1 -preset 10 -svtav1-params svtav1-loglevel=1 -pix_fmt yuv420p10le

# A stale service worker would keep serving the previous build on the TV.
cd "$REPO"
SERVICE_WORKER_DISABLED=true $PNPM build

COMMIT="$(git -C "$REPO" rev-parse --short HEAD)"
DIRTY=""
[ -n "$(git -C "$REPO" status --porcelain)" ] && DIRTY="-dirty"
NAME="stremio-bigpicture-$COMMIT$DIRTY"
STAGE="$(mktemp -d "$OUT/.stage.XXXXXX")"
trap 'rm -rf "$STAGE"' EXIT
ROOT="$STAGE/stremio-bigpicture"

mkdir -p "$ROOT"
cp -a "$REPO/build" "$ROOT/ui"
cp -a "$SAMPLES" "$ROOT/samples"
cp -a "$REPO/tv/doctor.sh" "$REPO/tv/install.sh" "$REPO/tv/serve.py" "$REPO/tv/probe" "$ROOT/"
cp -a "$REPO/LICENSE.md" "$REPO/BIGPICTURE.md" "$ROOT/"
printf '%s, source: stremio-web fork, branch big-picture\n' "$COMMIT$DIRTY" > "$ROOT/VERSION"

tar -C "$STAGE" -czf "$OUT/$NAME.tar.gz" stremio-bigpicture
ls -lh "$OUT/$NAME.tar.gz"
