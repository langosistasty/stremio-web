// Stremio Big Picture: heartbeat for diagnosing freezes on a TV PC (tv/launch.sh --diagnose).
// Every 2 s it posts what the page is doing to the local UI server, so a freeze can be
// told apart: JavaScript stopped (no heartbeats), drawing stopped (no frames), or input
// stopped (no keys while you press them). Only active with ?diagnostics=1.
// SPDX-License-Identifier: GPL-2.0-only

import { engineStats } from './focus';

const INTERVAL_MS = 2000;
const TICK_MS = 250;

const enabled = () => {
    const hashQuery = window.location.hash.split('?')[1] ?? '';
    return new URLSearchParams(window.location.search).get('diagnostics') === '1' ||
        new URLSearchParams(hashQuery).get('diagnostics') === '1';
};

// Route names only: the rest of the path can hold titles, ids and stream URLs.
const routeName = () => window.location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || 'board';

const describeFocus = () => {
    const active = document.activeElement;
    if (!active || active === document.body) return 'none';
    const firstClass = (active.getAttribute('class') ?? '').split(' ')[0].replace(/-[\w-]{5}$/, '');
    return `${active.tagName.toLowerCase()}.${firstClass}`;
};

const startDiagnostics = () => {
    if (!enabled()) return;

    let seq = 0;
    let frames = 0;
    let maxLag = 0;
    let keys: string[] = [];
    let expected = performance.now() + TICK_MS;
    let last = { ...engineStats };

    const countFrame = () => {
        frames += 1;
        requestAnimationFrame(countFrame);
    };
    requestAnimationFrame(countFrame);

    // How late a short timer fires shows how long the main thread was blocked.
    setInterval(() => {
        const now = performance.now();
        maxLag = Math.max(maxLag, now - expected);
        expected = now + TICK_MS;
    }, TICK_MS);

    window.addEventListener('keydown', (event) => {
        keys.push(event.key);
    }, true);

    setInterval(() => {
        const stats = { ...engineStats };
        const beat = {
            seq: seq++,
            t: Date.now(),
            route: routeName(),
            frames,
            maxLagMs: Math.round(maxLag),
            keys: keys.length,
            lastKeys: keys.slice(-5),
            focus: describeFocus(),
            engine: {
                checks: stats.checks - last.checks,
                moves: stats.moves - last.moves,
                focused: stats.focused - last.focused,
            },
            visible: document.visibilityState,
            windowFocused: document.hasFocus(),
            domNodes: document.getElementsByTagName('*').length,
        };
        frames = 0;
        maxLag = 0;
        keys = [];
        last = stats;
        fetch('/report', { method: 'POST', body: JSON.stringify(beat), keepalive: true }).catch(() => { /* server gone */ });
    }, INTERVAL_MS);
};

export default startDiagnostics;
