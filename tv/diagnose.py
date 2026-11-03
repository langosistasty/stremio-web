#!/usr/bin/env python3
# Stremio Big Picture: record and explain freezes (used by launch.sh --diagnose).
# SPDX-License-Identifier: GPL-2.0-only
"""sample DIR: every 2 s, append per-process CPU and memory (and NVIDIA GPU load) to DIR/processes.jsonl.
analyze DIR: turn DIR/page.jsonl, processes.jsonl and shell.log into a plain-text report on stdout.
check DIR STARTED_MS: print why Stremio looks frozen right now, or nothing (the launcher's watchdog)."""

import json
import os
import re
import shutil
import subprocess
import sys
import time
from datetime import datetime

INTERVAL = 2.0
STALL_SECONDS = 6
ROLES = [
    ("web", re.compile(r"WebKitWebProcess")),
    ("network", re.compile(r"WebKitNetworkProcess")),
    ("gpu", re.compile(r"WebKitGPUProcess")),
    ("shell", re.compile(r"libexec/stremio/stremio\b")),
    ("server", re.compile(r"server\.js")),
]


def role_of(cmdline):
    for role, pattern in ROLES:
        if pattern.search(cmdline):
            return role
    return None


def cpu_ticks(pid):
    with open(f"/proc/{pid}/stat", encoding="ascii", errors="replace") as stat:
        fields = stat.read().rsplit(")", 1)[1].split()
    return int(fields[11]) + int(fields[12]), int(fields[21])


def rss_mb(pid):
    with open(f"/proc/{pid}/status", encoding="ascii", errors="replace") as status:
        for line in status:
            if line.startswith("VmRSS:"):
                return int(line.split()[1]) // 1024
    return 0


def gpu_load():
    if not shutil.which("nvidia-smi"):
        return None
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=utilization.gpu,utilization.decoder,memory.used", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=3,
        ).stdout.strip().splitlines()[0]
        gpu, decoder, memory = (int(value.strip()) for value in out.split(","))
        return {"gpu": gpu, "decoder": decoder, "memMB": memory}
    except (OSError, subprocess.SubprocessError, ValueError, IndexError):
        return None


def sample(directory):
    hz = os.sysconf("SC_CLK_TCK")
    previous = {}
    with open(os.path.join(directory, "processes.jsonl"), "a", encoding="utf-8") as out:
        while True:
            now = time.time()
            roles = {}
            for pid in filter(str.isdigit, os.listdir("/proc")):
                try:
                    with open(f"/proc/{pid}/cmdline", "rb") as cmdline:
                        role = role_of(cmdline.read().replace(b"\0", b" ").decode("utf-8", "replace"))
                    if role is None:
                        continue
                    ticks, started = cpu_ticks(pid)
                    key = (pid, started)
                    cpu = None
                    if key in previous:
                        then, old_ticks = previous[key]
                        cpu = round(100 * (ticks - old_ticks) / hz / (now - then))
                    previous[key] = (now, ticks)
                    entry = roles.setdefault(role, {"cpu": 0, "rssMB": 0})
                    entry["cpu"] += cpu or 0
                    entry["rssMB"] += rss_mb(pid)
                except (OSError, ValueError, IndexError):
                    continue
            out.write(json.dumps({"t": int(now * 1000), "roles": roles, "gpu": gpu_load()}) + "\n")
            out.flush()
            time.sleep(INTERVAL)


def read_jsonl(path):
    rows = []
    if os.path.exists(path):
        with open(path, encoding="utf-8", errors="replace") as source:
            for line in source:
                try:
                    rows.append(json.loads(line))
                except ValueError:
                    pass
    return rows


# Watchdog thresholds. Generous, because restarting interrupts whatever was on screen.
# The environment overrides exist for tests.
PAGE_SILENT_SECONDS = int(os.environ.get("BIGPICTURE_PAGE_SILENT_SECONDS", 45))
# A start takes about 5 s on the TV PC (2026-11-03); 60 s leaves room for a cold disk
# after boot, and a web process that crashed while starting (a rare Skia error) leaves
# a blank screen for at most a minute.
FIRST_HEARTBEAT_SECONDS = int(os.environ.get("BIGPICTURE_FIRST_HEARTBEAT_SECONDS", 60))
FROZEN_PICTURE_BEATS = 10  # 20 s of heartbeats


def tail_beats(path, count):
    if not os.path.exists(path):
        return []
    with open(path, "rb") as source:
        source.seek(0, os.SEEK_END)
        offset = max(0, source.tell() - 64 * 1024)
        source.seek(offset)
        lines = source.read().decode("utf-8", "replace").splitlines()
        if offset > 0:
            lines = lines[1:]  # cut mid-line
    beats = []
    for line in lines[-count:]:
        try:
            beats.append(json.loads(line))
        except ValueError:
            pass
    return beats


def check(directory, started_ms):
    now = time.time() * 1000
    beats = tail_beats(os.path.join(directory, "page.jsonl"), FROZEN_PICTURE_BEATS)
    recent = [beat for beat in beats if beat.get("t", 0) >= started_ms]
    if not recent:
        if now - started_ms > FIRST_HEARTBEAT_SECONDS * 1000:
            print(f"the page sent no heartbeat within {FIRST_HEARTBEAT_SECONDS}s of starting")
        return
    silent = (now - recent[-1]["t"]) / 1000
    if silent > PAGE_SILENT_SECONDS:
        print(f"the page stopped: no heartbeat for {silent:.0f}s on {recent[-1].get('route')}")
        return
    # A still picture alone is normal (screen off, nothing to draw); a still picture
    # while someone keeps pressing keys is a freeze.
    if len(recent) >= FROZEN_PICTURE_BEATS and all(beat.get("frames") == 0 and beat.get("visible") == "visible" for beat in recent):
        keys = sum(beat.get("keys", 0) for beat in recent)
        if keys >= 3:
            print(f"the picture stopped for {len(recent) * 2}s while {keys} keys were pressed, on {recent[-1].get('route')}")


def clock(start, t):
    seconds = max(0, int((t - start) / 1000))
    return f"+{seconds // 60:02d}:{seconds % 60:02d}"


def analyze(directory):
    beats = sorted(read_jsonl(os.path.join(directory, "page.jsonl")), key=lambda beat: beat.get("t", 0))
    samples = read_jsonl(os.path.join(directory, "processes.jsonl"))
    options = open(os.path.join(directory, "options"), encoding="utf-8").read().strip() if os.path.exists(os.path.join(directory, "options")) else "?"
    print(f"Stremio Big Picture freeze diagnosis, {datetime.now():%Y-%m-%d %H:%M}")
    print(f"Options: {options}")

    if not beats:
        print("\nNo heartbeats from the page: it never loaded, or diagnostics were not on.")
        return
    start = min([beats[0]["t"]] + [sample["t"] for sample in samples[:1]])
    end = max([beats[-1]["t"]] + [sample["t"] for sample in samples[-1:]])
    print(f"Session: {clock(start, end)[1:]} (mm:ss), {len(beats)} heartbeats")

    findings = []

    # 1. JavaScript stopped: a gap in heartbeats, or none after some point until the end.
    stalls = []
    for before, after in zip(beats, beats[1:]):
        gap = (after["t"] - before["t"]) / 1000
        if gap > STALL_SECONDS:
            stalls.append((before, gap, True))
    tail = (end - beats[-1]["t"]) / 1000
    if tail > STALL_SECONDS:
        stalls.append((beats[-1], tail, False))
    for before, gap, recovered in stalls:
        how = "then recovered" if recovered else "and never recovered before Stremio was closed"
        findings.append(
            f"PAGE STOPPED at {clock(start, before['t'])}: no heartbeat for {gap:.0f}s, {how}. "
            f"Last screen: {before['route']}, focus on {before['focus']}."
        )

    # 2. Drawing stopped while the page still ran (frames are counted with requestAnimationFrame).
    run = []
    for beat in beats + [None]:
        drawing_stopped = beat is not None and beat["frames"] == 0 and beat["visible"] == "visible"
        if drawing_stopped:
            run.append(beat)
            continue
        if len(run) >= 3:
            keys = sum(item["keys"] for item in run)
            findings.append(
                f"DRAWING STOPPED at {clock(start, run[0]['t'])} for {len(run) * 2}s while the page still ran "
                f"(screen {run[0]['route']}; {keys} key presses reached the page meanwhile)."
            )
        run = []

    # 3. Long blocks of the main thread.
    for beat in beats:
        if beat["maxLagMs"] >= 1000:
            findings.append(f"MAIN THREAD BLOCKED for {beat['maxLagMs'] / 1000:.1f}s at {clock(start, beat['t'])} on {beat['route']}.")

    # 4. The focus engine moving focus by itself, again and again.
    for beat in beats:
        engine = beat.get("engine", {})
        if engine.get("focused", 0) >= 5 or (engine.get("checks", 0) >= 60 and beat["keys"] == 0):
            findings.append(
                f"FOCUS ENGINE BUSY at {clock(start, beat['t'])} on {beat['route']}: {engine.get('checks')} checks, "
                f"{engine.get('focused')} focus changes of its own, {beat['keys']} key presses."
            )

    # 5. The window lost keyboard focus (keys then go elsewhere).
    unfocused = [beat for beat in beats if not beat.get("windowFocused", True)]
    if unfocused:
        findings.append(f"WINDOW NOT FOCUSED in {len(unfocused)} of {len(beats)} heartbeats (first at {clock(start, unfocused[0]['t'])}): keys would not reach Stremio then.")

    # 6. The launcher's watchdog restarted Stremio.
    events = os.path.join(directory, "events.log")
    if os.path.exists(events):
        with open(events, encoding="utf-8", errors="replace") as source:
            findings.extend(line.strip() for line in source if line.strip())

    print("\n== Findings ==")
    for finding in findings or ["No freeze recorded: the page kept running and drawing the whole session."]:
        print(f"- {finding}")

    print("\n== Processes ==")
    for role, _ in ROLES:
        cpus = [sample["roles"][role]["cpu"] for sample in samples if role in sample["roles"]]
        rss = [sample["roles"][role]["rssMB"] for sample in samples if role in sample["roles"]]
        if cpus:
            print(f"  {role:8} CPU peak {max(cpus):4d}%, last {cpus[-1]:4d}%; memory {rss[0]} MB at start, {max(rss)} MB peak, {rss[-1]} MB at end")
    gpus = [sample["gpu"] for sample in samples if sample.get("gpu")]
    if gpus:
        print(f"  GPU      peak {max(gpu['gpu'] for gpu in gpus)}%, last {gpus[-1]['gpu']}%; video memory {gpus[-1]['memMB']} MB at end")
    for before, gap, _ in stalls:
        during = [sample for sample in samples if before["t"] < sample["t"] <= before["t"] + gap * 1000]
        if during:
            busiest = {role: max(sample["roles"].get(role, {}).get("cpu", 0) for sample in during) for role, _ in ROLES}
            print(f"  During the stop at {clock(start, before['t'])}: " + ", ".join(f"{role} {cpu}%" for role, cpu in busiest.items() if cpu))

    print("\n== Last 15 heartbeats ==")
    print("  time    screen        frames  lag(ms) keys  focus                      engine(checks/moves/own)")
    for beat in beats[-15:]:
        engine = beat.get("engine", {})
        print(f"  {clock(start, beat['t'])}  {beat['route'][:12]:12}  {beat['frames']:6d}  {beat['maxLagMs']:7d}  {beat['keys']:4d}  "
              f"{beat['focus'][:26]:26} {engine.get('checks', 0)}/{engine.get('moves', 0)}/{engine.get('focused', 0)}")

    log = os.path.join(directory, "shell.log")
    if os.path.exists(log):
        with open(log, encoding="utf-8", errors="replace") as source:
            lines = [re.sub(r"\x1b\[[0-9;]*m", "", line.rstrip()) for line in source]
        notable = [line for line in lines if re.search(r"error|warn|critical|fail|timeout|lost|crash|abort", line, re.I)]
        print(f"\n== Shell log: {len(notable)} warnings and errors, last 25 ==")
        for line in notable[-25:]:
            print("  " + line[:220])


if __name__ == "__main__":
    command = sys.argv[1] if len(sys.argv) > 1 else ""
    try:
        if command == "sample" and len(sys.argv) == 3:
            sample(sys.argv[2])
        elif command == "analyze" and len(sys.argv) == 3:
            analyze(sys.argv[2])
        elif command == "check" and len(sys.argv) == 4:
            check(sys.argv[2], int(sys.argv[3]))
        else:
            print(__doc__, file=sys.stderr)
            sys.exit(64)
    except KeyboardInterrupt:
        pass
