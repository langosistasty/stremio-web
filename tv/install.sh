#!/usr/bin/env bash
# Stremio Big Picture: install an extracted bundle for this user. Never needs root.
# SPDX-License-Identifier: GPL-2.0-only
set -eu

SOURCE="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"
TARGET="${XDG_DATA_HOME:-$HOME/.local/share}/stremio-bigpicture"
APP_ID="com.stremio.Stremio"
ASSUME_YES=0
AUTOSTART=""

usage() {
    echo "Usage: install.sh [options]"
    echo "  --yes            Install the Stremio Flatpak without asking, if it's missing"
    echo "  --autostart      Also open Stremio Big Picture when you log in (for a TV that only does this)"
    echo "  --no-autostart   Stop opening it at login"
}

for argument in "$@"; do
    case "$argument" in
        -y|--yes) ASSUME_YES=1 ;;
        --autostart) AUTOSTART=on ;;
        --no-autostart) AUTOSTART=off ;;
        -h|--help) usage; exit 0 ;;
        *) echo "Unknown option: $argument" >&2; usage >&2; exit 64 ;;
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
# Copies through a FAT-formatted USB stick lose the executable bits.
chmod +x "$TARGET"/*.sh "$TARGET"/*.py
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

# Launcher entries: Big Picture itself, for Plasma Bigscreen and any other launcher, and
# the doctor. Exec paths are quoted, so a home folder with spaces works.
APPLICATIONS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$APPLICATIONS"
ENTRY="$APPLICATIONS/stremio-bigpicture.desktop"
cat > "$ENTRY" <<EOF
[Desktop Entry]
Type=Application
Name=Stremio Big Picture
GenericName=Media Center
Comment=Stremio for the TV, with a remote, gamepad or keyboard
Icon=com.stremio.Stremio
Exec="$TARGET/launch.sh"
Terminal=false
Categories=AudioVideo;Video;Player;TV;
Keywords=stremio;tv;movies;series;streaming;
StartupNotify=false
StartupWMClass=com.stremio.Stremio
EOF
echo "Added \"Stremio Big Picture\" to your applications"

AUTOSTART_ENTRY="${XDG_CONFIG_HOME:-$HOME/.config}/autostart/stremio-bigpicture.desktop"
case "$AUTOSTART" in
    on)
        mkdir -p "$(dirname "$AUTOSTART_ENTRY")"
        cp "$ENTRY" "$AUTOSTART_ENTRY"
        echo "Stremio Big Picture will open when you log in (undo: install.sh --no-autostart)"
        ;;
    off)
        rm -f "$AUTOSTART_ENTRY"
        echo "Stremio Big Picture will no longer open at login"
        ;;
    *)
        # A reinstall refreshes an existing autostart entry, which may point at an old path.
        if [ -f "$AUTOSTART_ENTRY" ]; then cp "$ENTRY" "$AUTOSTART_ENTRY"; fi
        ;;
esac

cat > "$APPLICATIONS/stremio-bigpicture-doctor.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Stremio TV Doctor
Comment=Check whether this PC can run Stremio Big Picture
Icon=utilities-system-monitor
Exec="$TARGET/doctor.sh"
Terminal=true
Categories=Utility;
EOF

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$APPLICATIONS" >/dev/null 2>&1
fi

echo
echo "Open \"Stremio Big Picture\" from your launcher, or run: $TARGET/launch.sh"
echo "To check this PC first, run: $TARGET/doctor.sh"
