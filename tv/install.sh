#!/usr/bin/env bash
# Stremio Big Picture: install an extracted bundle for this user. Never needs root.
# SPDX-License-Identifier: GPL-2.0-only
set -eu

SOURCE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
TARGET="${XDG_DATA_HOME:-$HOME/.local/share}/stremio-bigpicture"
APP_ID="com.stremio.Stremio"
ASSUME_YES=0

for argument in "$@"; do
    case "$argument" in
        -y|--yes) ASSUME_YES=1 ;;
        -h|--help) echo "Usage: install.sh [--yes]   (--yes installs the Stremio Flatpak without asking)"; exit 0 ;;
        *) echo "Unknown option: $argument" >&2; exit 64 ;;
    esac
done

if [ ! -f "$SOURCE/ui/index.html" ]; then
    echo "Run this from an extracted bundle made by tv/package.sh." >&2
    exit 66
fi

if [ "$SOURCE" != "$TARGET" ]; then
    mkdir -p "$TARGET"
    # Replace ui/ whole, because each build keeps its assets in a new hashed folder.
    rm -rf "$TARGET/ui"
    cp -a "$SOURCE/." "$TARGET/"
fi
echo "Installed to $TARGET"

if ! command -v flatpak >/dev/null 2>&1; then
    echo "Flatpak is missing. Install it with your distro's package manager, add Flathub, then rerun this script." >&2
    exit 69
fi

if flatpak info "$APP_ID" >/dev/null 2>&1; then
    echo "$APP_ID is already installed"
else
    answer="n"
    if [ "$ASSUME_YES" = 1 ]; then
        answer="y"
    elif [ -t 0 ]; then
        read -r -p "$APP_ID is not installed. Install it from Flathub for this user? [y/N] " answer
    fi
    case "$answer" in
        y|Y)
            flatpak remote-add --user --if-not-exists flathub https://dl.flathub.org/repo/flathub.flatpakrepo
            flatpak install --user -y flathub "$APP_ID"
            ;;
        *)
            echo "Skipped. The doctor will report this until you run: flatpak install flathub $APP_ID"
            ;;
    esac
fi

# A launcher entry lets the doctor run from Bigscreen without opening a terminal first.
APPLICATIONS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$APPLICATIONS"
cat > "$APPLICATIONS/stremio-bigpicture-doctor.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Stremio TV Doctor
Comment=Check whether this PC can run Stremio Big Picture
Icon=utilities-system-monitor
Exec=$TARGET/doctor.sh
Terminal=true
Categories=System;Utility;
EOF

echo
echo "Next: run $TARGET/doctor.sh"
