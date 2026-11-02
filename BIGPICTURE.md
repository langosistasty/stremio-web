# Stremio Big Picture

A personal 10-foot TV mode for this fork of `stremio-web`, for use with arrows, Enter and Back from the couch. It's designed to work on any Linux PC with Flatpak: hardware, distro and input devices are detected at runtime, not assumed.

## How it runs

```
Flatpak com.stremio.Stremio (unmodified: GTK4, WebKitGTK, libmpv, streaming server)
    └─ --url=http://127.0.0.1:18470/  →  this UI, served from the local machine
```

- **Video:** mpv in the shell plays MKV, HEVC and surround audio directly, with GPU decoding where the driver allows it.
- **Upstream code:** `stremio-core` and the shell aren't changed.
- **Own code:** new files live in `tv/`, `src/bigpicture/` and `e2e/`. Upstream files only get small, marked hooks into them (see the change log).

## Turning it on

| Way | Effect |
|---|---|
| Settings > Interface > **Big Picture mode** | Saved for this UI's address |
| `?bigpicture=1` or `?bigpicture=0` in the URL | Forces it on or off for that launch only, without changing the saved setting. Works before the hash or inside it (`#/?bigpicture=1`) |
| `tv/launch.sh` | Serves the UI on `127.0.0.1:18470` and opens Stremio with `?bigpicture=1`; `--normal` uses the saved setting |

When it's on, the page carries `data-bigpicture` on `<html>`, and inside the shell the window goes fullscreen.

The local UI is its own origin, so it has its own login and settings, separate from Stremio's built-in UI. Keep the port the same: changing it starts from a blank profile.

## Tests

Keyboard-only Playwright tests live in `e2e/`, with their own `package.json` so the upstream lockfile stays untouched. They run against the production build, offline, at 1920x1080, in WebKit (the shell's engine) and Chromium. A fake shell covers the IPC paths. Any mouse input fails the test.

```bash
e2e/run.sh              # build, then test
e2e/run.sh --no-build   # test the existing build
```

Playwright's WebKit only supports Ubuntu and Debian libraries, so `run.sh` uses the official Playwright container when Docker or Podman is available. Without either, it runs on the host, and on other distros only Chromium runs.

## Trying it on a TV PC

On the dev machine, make a bundle. This needs `ffmpeg` with `libx264`, `libx265` and `libsvtav1`:

```bash
tv/package.sh
```

The bundle lands in `../tv-dist/`. Copy it to the TV PC any way you like, then run:

```bash
tar -xzf stremio-bigpicture-*.tar.gz
cd stremio-bigpicture
./install.sh
~/.local/share/stremio-bigpicture/doctor.sh
```

The doctor changes nothing on the system. It writes `~/stremio-bigpicture-report.txt`, with home paths, user name and host name removed. Run it from a terminal on the TV's desktop, or open **Stremio TV Doctor** from the launcher.

The doctor reports the decoder, decode errors, whole-system CPU and NVDEC load. It doesn't report dropped frames: mpv only exposes them at debug log level, which distorts them, so it asks you whether each clip looked smooth. The test clips are synthetic, so also try a real high-bitrate film.

| Doctor option | Use |
|---|---|
| `--static` | Inspect the system without opening Stremio |
| `--app ID` | Test another Flatpak build, for example `com.stremio.Stremio.Devel` |
| `--port N` | Use another local UI port |

## Known fragile point

The streaming server only accepts cross-origin requests from Stremio's own domains, and its `/proxy` route rejects `http://` targets. A local UI works because the shell always sets `NO_CORS`, and the server treats the value `"0"` as true. If upstream fixes that, the doctor's "Page can reach the streaming server" check fails. The fallback is to serve the UI and the server from one origin.

## Changes from upstream

GPLv2 section 2(a) asks modified files to carry a notice of the change, so this list is kept up to date.

| Phase | Date | Change |
|---|---|---|
| 0 | 2026-11-02 | Added `tv/` and this file. No upstream files changed |
| 1 | 2026-11-02 | Added `src/bigpicture/`, `e2e/` and `tv/launch.sh`. Changed `src/App/App.js` (renders `<BigPicture />`, 3 lines) and `src/routes/Settings/Interface/Interface.tsx` (the switch, 5 lines) |

## License

GPL-2.0, the same as upstream; see `LICENSE.md`. The Stremio shell is GPL-3.0 and remains a separate, unmodified program that talks to this UI over IPC.
