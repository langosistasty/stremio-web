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

## Navigation

`src/bigpicture/focus/` takes over the keyboard while Big Picture is on. Upstream's handlers and the spatial-navigation polyfill keep working when it's off.

| Key | What it does |
|---|---|
| Arrows | Move to the nearest control in that direction. Left and Right only move along a row, so a row's end is a dead end. Up and Down weigh distance against being out of line, so forms are walked in reading order and grids keep their column |
| Left, with nothing in line | Enters the nav rail at the current tab, from any row |
| Enter | Activates the control (upstream behaviour) |
| Escape, Backspace, BrowserBack | Back: closes the open menu, popup or dialog first, otherwise goes back in history. Home is the floor. Backspace still deletes text in a text field |

- **One key handler:** it runs in the capture phase, before any upstream handler, so a key Big Picture uses never also triggers an upstream shortcut. The player keeps its own keys until Phase 6.
- **Where arrows stay:** inside an upstream `--spatial-navigation-contain` menu, else the topmost open popup or dialog (react-focus-lock marks them), else the route on screen.
- **Controls that need their arrows:** text fields keep Left and Right until the caret reaches an end; sliders keep Left and Right. Up and Down always move on.
- **Unreachable controls:** upstream marks many controls `tabIndex={-1}` (the nav rail, Settings switches, addon buttons). They're made focusable at runtime, and reverted when the mode is switched off.
- **Initial focus:** a view starts on its main content, not the nav bars: Board, Discover and Library on the first poster, Search on its text field. Catalog views wait up to 1.5 s for posters. If they're late, focus takes a stopgap and moves to the first poster when it arrives, unless a key was pressed in between.
- **Focus memory:** Back returns to the control that had focus, per history entry. A view that stayed mounted gets the same element back; a view that was rebuilt is matched by link, title and text.
- **Closing layers:** Back sends the layer an Escape of its own, then an outside click, then presses its close or cancel button, stopping as soon as the layer is gone. In Big Picture, Escape never leaves fullscreen.
- **Focus ring:** a white outline with a violet glow on the focused control, injected as a global stylesheet scoped to `html[data-bigpicture]`. Phase 3 makes it part of the TV layout.
- **The polyfill's search isn't used:** when its hit test fails (on Settings switches, for example), it measures from the scroll container instead of the control, which skips controls or moves the wrong way. `spatial.ts` replaces it with about 40 lines.

## Tests

Keyboard-only Playwright tests live in `e2e/`, with their own `package.json` so the upstream lockfile stays untouched. They run against the production build at 1920x1080, in WebKit (the shell's engine) and Chromium.
- **Offline:** the default addons answer from fixtures (`e2e/support/catalog.ts`), with optional delays to simulate a slow network.
- **Fake shell:** covers the IPC paths.
- **Keyboard only:** any mouse input fails the test.
- **WebKit as on the TV:** the WebKit project uses a WebKitGTK-on-Linux user agent, because upstream behaves differently there; for example, it turns off view transitions.
- **Workers:** 4 by default, since each is a full browser; set `E2E_WORKERS` to change it.

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

## Freezes: recording, watchdog, safe rendering

`tv/launch.sh` records every session and keeps the last 5 in `~/.local/state/stremio-bigpicture/`. The last session's report is `last-report.txt` there; `--diagnose` also copies it to `~/stremio-bigpicture-freeze-report.txt`.

- **Heartbeat:** the page (`src/bigpicture/diagnostics.ts`, on with `?diagnostics=1`, which the launcher always sets) posts to the local server every 2 s. Each heartbeat holds the frames drawn, the longest main-thread block, the key presses received, the focused control's kind, the focus engine's activity and the route name, with no titles or ids.
- **Processes:** `tv/diagnose.py` samples CPU and memory of each Stremio process, and NVIDIA GPU load.
- **Watchdog:** the launcher restarts Stremio when the page sends no heartbeat for 45 s, or when the picture stays still for 20 s while keys keep arriving. A still picture with no key presses is normal, for example with the screen off. A system suspend resets the clocks. After 3 restarts in 10 minutes it gives up and only records. Turn it off with `--no-watchdog`.
- **Safe rendering:** on NVIDIA (`/dev/nvidia0`), the launcher sets `WEBKIT_DISABLE_DMABUF_RENDERER=1`, the common workaround for WebKitGTK freezes with NVIDIA's driver. It costs menu smoothness (about 30 instead of 60 frames per second here) but not video, which mpv draws. Use `--no-safe-render` to compare.

A freeze on the TV PC was reported on 2026-11-02 during the Phase 2 test, before any of this existed, so its cause is still unknown. The next report says which layer froze.

| The report says | Meaning |
|---|---|
| PAGE STOPPED | The page's JavaScript stopped: the app or this fork's code |
| DRAWING STOPPED while the page still ran | WebKit or the GPU driver stopped painting; try `--safe-render` |
| WINDOW NOT FOCUSED | Keys went to another window |
| FOCUS ENGINE BUSY | The focus engine kept moving focus by itself |

## Upstream issues found

| Issue | Status |
|---|---|
| Library redirects `/library` to its default filter with a push instead of a replace, so Back (upstream's Backspace shortcut too) lands on `/library` and is sent forward again | Fixed here, 1 line; worth sending upstream |
| `Routes.tsx` applies a push inside `startViewTransition`, with the location captured. If Back happens before the transition callback runs, the stale callback puts the old view back on screen while the URL says otherwise | Not fixed: upstream turns view transitions off on Linux WebKit, so the TV never takes this path |

## Known fragile point

The streaming server only accepts cross-origin requests from Stremio's own domains, and its `/proxy` route rejects `http://` targets. A local UI works because the shell always sets `NO_CORS`, and the server treats the value `"0"` as true. If upstream fixes that, the doctor's "Page can reach the streaming server" check fails. The fallback is to serve the UI and the server from one origin.

## Changes from upstream

GPLv2 section 2(a) asks modified files to carry a notice of the change, so this list is kept up to date.

| Phase | Date | Change |
|---|---|---|
| 0 | 2026-11-02 | Added `tv/` and this file. No upstream files changed |
| 1 | 2026-11-02 | Added `src/bigpicture/`, `e2e/` and `tv/launch.sh`. Changed `src/App/App.js` (renders `<BigPicture />`, 3 lines) and `src/routes/Settings/Interface/Interface.tsx` (the switch, 5 lines) |
| 2 | 2026-11-02 | Added `src/bigpicture/focus/`. Changed `src/common/Fullscreen/FullscreenProvider.tsx` (Escape doesn't leave fullscreen in Big Picture, 2 lines) and `src/routes/Library/Library.js` (the redirect replaces its history entry, 1 line plus a comment) |

## License

GPL-2.0, the same as upstream; see `LICENSE.md`. The Stremio shell is GPL-3.0 and remains a separate, unmodified program that talks to this UI over IPC.
