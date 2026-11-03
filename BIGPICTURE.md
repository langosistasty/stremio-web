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
| **Stremio Big Picture** in the launcher, or `tv/launch.sh` | Serves the UI on `127.0.0.1:18470` and opens Stremio with `?bigpicture=1`; `launch.sh --normal` uses the saved setting |

When it's on, the page carries `data-bigpicture` on `<html>`, and inside the shell the window goes fullscreen.

The local UI is its own origin, so it has its own login and settings, separate from Stremio's built-in UI. Keep the port the same: changing it starts from a blank profile.

## Navigation

`src/bigpicture/focus/` takes over the keyboard while Big Picture is on. Upstream's handlers and the spatial-navigation polyfill keep working when it's off.

| Key | What it does |
|---|---|
| Arrows | Move to the nearest control in that direction. Left and Right only move along a row, so a row's end is a dead end. Up and Down weigh distance against being out of line, so forms are walked in reading order and grids keep their column |
| Left, with nothing in line | Enters the nav rail at the current tab, from any row |
| Right, in the nav rail | Returns to the control you left the screen from |
| Enter | Activates the control (upstream behaviour) |
| Escape, Backspace, BrowserBack | Back: closes the open menu, popup or dialog first, otherwise goes back in history. On Board, where history ends, it asks to quit (see below). Backspace still deletes text in a text field |

- **One key handler:** it runs in the capture phase, before any upstream handler, so a key Big Picture uses never also triggers an upstream shortcut. The bundled spatial-navigation polyfill is switched off (its `keyMode` set to `NONE`) while Big Picture is on. The player has its own rules (below).
- **Where arrows stay:** inside an upstream `--spatial-navigation-contain` menu, else the topmost open popup or dialog (react-focus-lock marks them), else the route on screen.
- **Controls that need their arrows:** text fields keep Left and Right until the caret reaches an end; sliders keep Left and Right. Up and Down always move on.
- **Unreachable controls:** upstream marks many controls `tabIndex={-1}` (the nav rail, Settings switches, addon buttons). They're made focusable at runtime, and reverted when the mode is switched off.
- **Initial focus:** a view starts on its main content, not the nav bars: Board, Discover and Library on the first poster, Search on its text field. Catalog views wait up to 1.5 s for posters. If they're late, focus takes a stopgap and moves to the first poster when it arrives, unless a key was pressed in between.
- **Focus memory:** Back returns to the control that had focus, per history entry. A view that stayed mounted gets the same element back; a view that was rebuilt is matched by link, title and text.
- **Closing layers:** Back sends the layer an Escape of its own, then an outside click, then presses its close or cancel button, stopping as soon as the layer is gone. In Big Picture, Escape never leaves fullscreen.
- **Focus ring:** an amber outline with a soft glow on the focused control; on posters it's drawn on the artwork. It's part of the TV look (see below).
- **Per screen (Phase 4):**

  | Screen | Starts on | Notes |
  |---|---|---|
  | Board, Discover, Library, Continue Watching | First poster | Waits for posters; rows that load out of order are handled |
  | Search | Text field | Enter searches; Down enters the results; rows below render as the list scrolls |
  | Details (movie, episode) | First stream | Streams arrive from addons, so it waits for them |
  | Details (series) | First episode | Enter on an episode shows its streams; Back returns to the episode list, not past the series |
  | Settings, Addons, Intro, Calendar | First content control | An addon's details dialog takes focus when it opens |
- **Movement rules learned from the screens:**
  - **Focus groups:** Left and Right look first inside the smallest group around the control (a row's posters, a bar's buttons).
  - **What counts as "in that direction":** a control must start past the current one's middle, so overlapping layouts like a bar over the last row still work.
  - **The rail:** it's only entered with Left; Up and Down stay out of it.
  - **Covered controls:** a control fully on screen, and fully inside its scrolling list, but covered by something else is skipped. One clipped by its list (a row scrolled up behind Board's hero) stays reachable, since scrolling brings it back.
  - **Lazy lists:** with nothing further down, Up and Down scroll the list and look again, for lists that render as they scroll (Search, Discover).
  - **Dropdowns:** a dropdown that opens takes focus, on its chosen option, so Back closes it first.
  - **Text fields:** arriving in one puts the cursor at the end; empty email fields let Left and Right go.
- **The polyfill's search isn't used:** when its hit test fails (on Settings switches, for example), it measures from the scroll container instead of the control, which skips controls or moves the wrong way. `spatial.ts` replaces it with about 40 lines.

## Quitting

Back (B on a gamepad) on Board asks **Quit Stremio?**, as TV apps do (`src/bigpicture/input/quit.ts`).
- **Quit** (A or Enter, focused when it opens) closes Stremio through the shell's own `quit` command. The launcher then stops the UI server, as when the window is closed.
- **Cancel**, or Back again, closes the question, with focus back where it was. Pressing Back twice never quits by accident.
- **In a browser** there is nothing to quit, so Back on Board does nothing.
- **How it fits in:** like the on-screen keyboard, it's a plain layer outside React, so the focus engine's arrows and Back work on it unchanged.

## Player

`src/bigpicture/focus/player.ts` puts a remote on upstream's player without changing `Player.js`. Focus decides the mode:

| Mode | Key | Does |
|---|---|---|
| Watching (nothing focused) | Left / Right | Seek, through upstream's own keys |
| | Up, Down, Enter, Start | Bring up the controls, on Play/Pause |
| | Back | Leave the player, back on the stream that was playing |
| Controls (a button focused) | Arrows | Move between the controls |
| | Enter | Press it; a menu it opens (speed, subtitles, audio) takes focus |
| | Back | Hide the controls |
| Menu open | Arrows | Stay in the menu |
| | Back | Close the menu (its button is pressed again) |
| Any | Play/Pause media key | Upstream's Space |
| | Fast-forward / Rewind, Next / Previous keys, gamepad shoulders and triggers | Seek |
| | Stop media key | Leave the player |

- **Overlay timing:** upstream shows its overlay on mouse movement and hides it after 3 s of stillness. Big Picture sends that movement on every key, and drops focus when the overlay hides, so the next Left or Right seeks again.
- **Why Back is handled here:** upstream's Escape in the player only exits when it didn't just leave fullscreen, which a TV never does.
- **Stream switching:** there's no separate quality or stream picker. "Quality" means another stream, and Back lands on the playing stream in the details list, with the others right next to it.

## Input

**Gamepad** (`src/bigpicture/input/gamepad.ts`): any pad with the standard mapping (Xbox, PlayStation, and most others through the browser), polled every 16 ms. Upstream's own gamepad support, which reads only buttons 0–5 and the sticks, is switched off while Big Picture is on, so each press acts once.

| Button | Acts as |
|---|---|
| D-pad, left stick | Arrows (held: repeats after 400 ms, every 120 ms) |
| A / Cross | Enter |
| B / Circle, Back / Select | Back |
| LB, LT / RB, RT | Page Up / Page Down (3 rows) |
| Y / Triangle | Search |
| Start / Options | Context menu key (reserved for the player) |
| Guide / PS | Home |

**Remote keys:** Page Up/Down jump 3 rows. Browser Home and Browser Search keys (found on many remotes and air mice) go to Board and Search.

**On-screen keyboard** (`src/bigpicture/input/keyboard.ts`):
- **Opening:** Enter or A on a text field opens it, unless that field was typed into on a real keyboard since it was focused; then Enter keeps its usual meaning (submit).
- **Layout:** digits, letters and `@ . - _`, plus Shift, Space, Delete, Clear and Done, with a preview line (masked for passwords).
- **Done:** closes the keyboard; in the search field it also searches.
- **Back:** closes it, with focus back on the field.
- **How it fits in:** it's a plain DOM layer outside React, marked `data-bigpicture-layer`, so the focus engine's arrows and Back work on it unchanged. Values go in through the field's native setter and an `input` event, the way React-controlled fields accept them.

## TV look: "house lights down"

Big Picture has its own look (`src/bigpicture/theme/`), approved on 2026-11-03. The screen behaves like a cinema: artwork is the light source, the interface is the dimmed room around it, and one warm accent (projector light) marks where you are. It only applies with Big Picture on; normal Stremio keeps upstream's look.

| Token | Hex | Use |
|---|---|---|
| Auditorium | `#0D1220` | Background: deep blue ink, which blends into film backdrops |
| Balcony | `#161D30` | Raised surfaces: dialogs, the keyboard |
| Aisle | `#2A3350` | Inactive and selected controls, placeholders |
| Screen | `#F1EEE6` | Main text |
| Usher | `#A3ABC2` | Secondary text |
| Projector | `#FFB547` | The one accent: focus, the current screen, progress |

- **Type:** Big Shoulders Display, a condensed face from Chicago signage, for titles; Atkinson Hyperlegible Next, designed for legibility, for everything else. Both are bundled under the SIL Open Font License (`src/bigpicture/theme/fonts/`), with Latin and Latin Extended (ő, ű) subsets, so a TV needs no network for them.
- **How:** upstream draws its colours from CSS variables, so the theme sets those variables to the tokens, scoped to `html[data-bigpicture]`. Upstream's CSS modules have hashed class names, so the few direct rules match on class-name prefixes.
- **Posters:** the focused poster grows a little, with the ring on its artwork, and only it shows its name.
- **Rail:** quiet icons; the current screen's is amber, and the labels show when focus enters the rail. Search has a tab there, second after Board (`screens/RailSearch.tsx`, upstream's own tab button rendered into the rail).
- **Board's hero** (`screens/BoardHero.tsx`): the focused title's backdrop fills the top half, fading into the room on the left and below, with its name in the display face, its year, runtime, genres and rating, and three lines of description. It follows focus once focus rests for 250 ms, with a 300 ms crossfade, from the previews the core already holds for Board. The top bar gives way to it on Board (Search is in the rail), the rows show posters only, since the hero names the focused one, and the focused row stays just under the hero.
- **No upstream change for the screens:** the hero and the rail tab are rendered through portals into the view on screen, found by class-name prefix (`screens/usePortalTarget.ts`). It's re-checked twice a second, because Board first renders a placeholder copy of its layout while loading.
- **Motion:** short (160 ms) and only in answer to a key press. With reduced motion on, it's instant.
- **Screenshots:** `E2E_SHOTS=1 e2e/run.sh --no-build --project=webkit screenshots` saves every screen at 1920×1080 to `e2e/shots/`, with real addons and artwork for the public screens (needs the network) and the fake account for Library and Calendar.

## TV layout

| Setting (Settings > Interface, shown while Big Picture is on) | Default | Effect |
|---|---|---|
| TV size: 100–200% | 150% | Multiplies upstream's interface zoom. Your own zoom setting is kept and applies on top. At 150%, a 1080p TV gets the layout of a 1280×720 screen: 6 larger posters per row instead of 9, and text about 1.5 times larger |
| TV safe margin: none, 2.5%, 5% | None | Pads the whole interface for TVs that crop the picture's edges (overscan). A TV on a PC input normally shows everything, so none is the default |

- **Zoom path:** the scale goes through upstream's own mechanism (`useInterfaceScale`). That's the shell's page zoom where available (shells after 1.2.2), otherwise CSS zoom with rewritten breakpoints, so layouts respond as on a smaller screen.
- **Scrolling:** a control is only scrolled to when it isn't fully visible, and then to mid-screen, so rows stay put and the top of a page, including the first row's heading, isn't scrolled away.
- **Simplified menus:** the fullscreen button in the top bar, and the "Escape key exit full screen" setting, are hidden in Big Picture. The TV stays fullscreen, and Escape means Back.

## Tests

Keyboard-only Playwright tests live in `e2e/`, with their own `package.json` so the upstream lockfile stays untouched. They run against the production build at 1920x1080, in WebKit (the shell's engine) and Chromium.
- **Offline:** the default addons answer from fixtures (`e2e/support/catalog.ts`): catalogs, search results, metadata, three streams per title (WatchHub), and posters. Optional delays simulate a slow network. Streams point to a WebM clip that `run.sh` generates with ffmpeg into `e2e/fixtures/` (not in git).
- **Every screen is crawled:** `e2e/support/crawl.ts` follows every arrow move from a screen's start and fails if any visible control can't be reached.
- **A fake account:** `e2e/support/account.ts` answers the Stremio API, so tests with `account: true` log in (through the same core action as Intro's form) to a library of 30 series and 20 movies, 8 of them half watched, with weekly episodes over the months around today. Library, Continue Watching and Calendar are crawled signed in, and Calendar's earlier months are opened from the remote.
- **Fake shell:** covers the IPC paths.
- **Keyboard only:** any mouse input fails the test.
- **WebKit as on the TV:** the WebKit project uses a WebKitGTK-on-Linux user agent, because upstream behaves differently there; for example, it turns off view transitions.
- **Workers:** 4 by default, since each is a full browser; set `E2E_WORKERS` to change it.

```bash
e2e/run.sh              # build, then test
e2e/run.sh --no-build   # test the existing build
```

Playwright's WebKit only supports Ubuntu and Debian libraries, so `run.sh` uses the official Playwright container when Docker or Podman is available. Without either, it runs on the host, and on other distros only Chromium runs.

## Launching

`tv/install.sh` adds **Stremio Big Picture** to the applications. That's what Plasma Bigscreen and any other launcher show, with Stremio's icon, under Video and TV. It runs `launch.sh`, which:
- **Serves and opens:** serves this UI on `127.0.0.1:18470`, opens the unmodified Stremio Flatpak with it, and stops the server when Stremio quits.
- **A second start:** if Big Picture is already running, it brings its window up. If a normal Stremio is open, it says so in a desktop notification, since a second start would only raise that window and ignore this UI.
- **A crashed session:** it takes the port back from a UI server left over from a crashed session. If another program holds the port, it refuses and says so.
- **CORS check:** once per session it checks that the streaming server still accepts this UI's address (see Known fragile point), and records and notifies if it doesn't.
- **Recording, watchdog and NVIDIA:** see "Freezes" below.

`install.sh --autostart` also opens it at login, for a PC that's only a TV; `--no-autostart` undoes it. A reinstall keeps the choice and refreshes the entry.

Running the UI server as a systemd user unit was planned, but the launcher already starts and stops it with Stremio, restarts on freezes and records sessions. A second process manager would only add ways for the two to disagree.

`tv/tests/launcher.test.sh` tests `install.sh` and `launch.sh` with a fake `flatpak` command and a throwaway home folder: the entries, autostart, a normal session, a second start, a leftover server, a busy port, the watchdog, and the CORS check against a fake streaming server.

## Trying it on a TV PC

On the dev machine, make a bundle. This needs `ffmpeg` with `libx264`, `libx265` and `libsvtav1`:

```bash
tv/package.sh
```

The bundle lands in `../tv-dist/`. Copy it to the TV PC any way you like, then run:

```bash
tar -xzf stremio-bigpicture-*.tar.gz
cd stremio-bigpicture
./install.sh                 # add --autostart to open it at every login
```

Then open **Stremio Big Picture** from the launcher. To check a new PC first, run `~/.local/share/stremio-bigpicture/doctor.sh`.

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
- **Safe rendering:** on NVIDIA (`/dev/nvidia0`), the launcher sets `WEBKIT_DISABLE_DMABUF_RENDERER=1`, the common workaround for WebKitGTK freezes with NVIDIA's driver. It costs menu smoothness (about 30 instead of 60 frames per second) but not video, which mpv draws.
- **Render modes:** `--render MODE` picks how Stremio draws: `wayland`, `wayland-safe` (the NVIDIA default), `wayland-vulkan` (GTK's Vulkan renderer; Stremio's own start script forces OpenGL on NVIDIA, so this starts the shell binary directly), `wayland-cpu` (no GPU compositing), `x11` and `x11-safe` (through XWayland). `--safe-render` and `--no-safe-render` are `wayland-safe` and `wayland`.
- **Soak test:** `--soak` makes the page browse by itself (`src/bigpicture/soak.ts`): it visits Board, Discover, Library, Calendar, Search and Settings and moves around each with arrow keys, so a render mode can be tested for freezes with no one at the remote. The screen must be on: a hidden page draws nothing.

**First test on the TV PC (2026-11-03, GTX 1050, driver 580.196.07, KDE Wayland):**
- `wayland-safe`, the default: black boxes flash across the menus. No freeze in 3.5 minutes.
- `wayland`: no black boxes, but two freezes in 5 minutes, one on Calendar and one on Board with no key pressed. Both times drawing stopped first (frames fell to 17, then 0, while the page's JavaScript still ran), and a few seconds later WebKit's process ran at 100% CPU. The watchdog restarted Stremio both times. That's the WebKit DMA-BUF freeze on NVIDIA, so this fork's code isn't the cause.
- Still to test with `--soak`: `x11`, `x11-safe`, `wayland-vulkan` and `wayland-cpu`. The default stays `wayland-safe` until one of them shows neither problem.

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

## Known navigation quirk

On Calendar, Up from a day in the right-hand columns skips the month arrows and lands on the search bar, which lines up better with those columns. Everything stays reachable (the crawl checks that), but the month arrows are reached from the left-hand columns.

## Known fragile point

The streaming server only accepts cross-origin requests from Stremio's own domains, and its `/proxy` route rejects `http://` targets. A local UI works because the shell always sets `NO_CORS`, and the server treats the value `"0"` as true. If upstream fixes that, the launcher's CORS check and the doctor's "Page can reach the streaming server" both report it.

The fallback would be one origin for both, with the UI server proxying the streaming server. It isn't built, because it isn't needed today. Video bytes would also pass through Python on an old CPU, so it should be designed when it's needed, not before.

## Changes from upstream

GPLv2 section 2(a) asks modified files to carry a notice of the change, so this list is kept up to date.

| Phase | Date | Change |
|---|---|---|
| 0 | 2026-11-02 | Added `tv/` and this file. No upstream files changed |
| 1 | 2026-11-02 | Added `src/bigpicture/`, `e2e/` and `tv/launch.sh`. Changed `src/App/App.js` (renders `<BigPicture />`, 3 lines) and `src/routes/Settings/Interface/Interface.tsx` (the switch, 5 lines) |
| 2 | 2026-11-02 | Added `src/bigpicture/focus/`. Changed `src/common/Fullscreen/FullscreenProvider.tsx` (Escape doesn't leave fullscreen in Big Picture, 2 lines) and `src/routes/Library/Library.js` (the redirect replaces its history entry, 1 line plus a comment) |
| 3 | 2026-11-02 | TV size and safe margin (`store.ts`, `BigPictureSettings.tsx`, `focus/styles.ts`). Changed `src/App/useInterfaceScale.ts` (TV size multiplies the scale, 4 lines), `src/routes/Settings/Interface/Interface.tsx` (the Big Picture rows; the Escape-fullscreen row hidden in Big Picture) and `src/components/NavBar/HorizontalNavBar/HorizontalNavBar.js` (fullscreen button hidden in Big Picture, 4 lines) |
| 4 | 2026-11-02 | Every screen: start rules, focus groups, lazy lists, dropdowns and dialogs, details Back (all in `src/bigpicture/focus/`), and `e2e/screens.e2e.ts` with the crawler. No upstream files changed |
| 5 | 2026-11-02 | Gamepad, remote keys and on-screen keyboard (`src/bigpicture/input/`). Changed `src/App/App.js` (upstream's gamepad reader off in Big Picture, 3 lines) |
| 6 | 2026-11-02 | Player keys, overlay and menus (`src/bigpicture/focus/player.ts`), polyfill off in Big Picture, `e2e/player.e2e.ts`. No upstream files changed |
| 7 | 2026-11-03 | Launcher entry and autostart (`tv/install.sh`), second-start, leftover-server and busy-port handling, notifications and the CORS check (`tv/launch.sh`), `tv/tests/launcher.test.sh`. No upstream files changed |
| 8 | 2026-11-03 | First test on the TV PC. Render modes and the soak test (`tv/launch.sh`, `src/bigpicture/soak.ts`), the fake account and signed-in screen tests (`e2e/support/account.ts`, `e2e/screens.e2e.ts`). No upstream files changed |
| 9 | 2026-11-03 | Quitting from the remote: Back on Board asks to quit (`src/bigpicture/input/quit.ts`, the focus engine's Back, styles), tests in `e2e/focus.e2e.ts`. No upstream files changed |
| 10 | 2026-11-03 | The TV look: tokens, bundled fonts, focus, posters and rail on every screen, Board's hero and Search in the rail (`src/bigpicture/theme/`, `src/bigpicture/screens/`); the old ring moved out of `focus/styles.ts`. Focus engine: Right out of the rail returns to where you were, and clipped controls stay reachable. Screenshot tests (`e2e/screenshots.e2e.ts`) and the fake account's addon collection. No upstream files changed |

## License

GPL-2.0, the same as upstream; see `LICENSE.md`. The Stremio shell is GPL-3.0 and remains a separate, unmodified program that talks to this UI over IPC.
