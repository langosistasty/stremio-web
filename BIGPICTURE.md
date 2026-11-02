# Stremio Big Picture

A personal 10-foot TV mode for this fork of `stremio-web`, for use with arrows, Enter and Back from the couch. It's designed to work on any Linux PC with Flatpak: hardware, distro and input devices are detected at runtime, not assumed.

## How it runs

```
Flatpak com.stremio.Stremio (unmodified: GTK4, WebKitGTK, libmpv, streaming server)
    └─ --url=http://127.0.0.1:18470/  →  this UI, served from the local machine
```

- **Video:** mpv in the shell plays MKV, HEVC and surround audio directly, with GPU decoding where the driver allows it.
- **Upstream code:** `stremio-core` and the shell aren't changed.
- **Own code:** new files live in `tv/` and, from Phase 1, `src/bigpicture/` and `e2e/`.

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

| Phase | Change |
|---|---|
| 0 | Added `tv/` and this file. No upstream files changed |

## License

GPL-2.0, the same as upstream; see `LICENSE.md`. The Stremio shell is GPL-3.0 and remains a separate, unmodified program that talks to this UI over IPC.
