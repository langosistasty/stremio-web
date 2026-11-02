// Stremio Big Picture: gamepads, turned into the keys the rest of Big Picture understands.
// Reads the standard mapping (Xbox, PlayStation and most pads through SDL or the browser),
// including the D-pad, which upstream's gamepad support doesn't. Upstream's is off while
// Big Picture is on, so each press acts once.
// SPDX-License-Identifier: GPL-2.0-only

import pressKey from './keys';

// Standard mapping: https://w3c.github.io/gamepad/#remapping
const BUTTON_KEYS: Record<number, string> = {
    0: 'Enter', // A, Cross
    1: 'Escape', // B, Circle
    3: 'BrowserSearch', // Y, Triangle
    4: 'PageUp', // LB, L1
    5: 'PageDown', // RB, R1
    6: 'PageUp', // LT, L2
    7: 'PageDown', // RT, R2
    8: 'Escape', // Back, Select, Share
    9: 'ContextMenu', // Start, Options
    12: 'ArrowUp',
    13: 'ArrowDown',
    14: 'ArrowLeft',
    15: 'ArrowRight',
    16: 'BrowserHome', // Guide, PS
};
// Keys that repeat while held, like a keyboard's.
const REPEATING = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'PageUp', 'PageDown']);
const REPEAT_DELAY_MS = 400;
const REPEAT_INTERVAL_MS = 120;
const STICK_THRESHOLD = 0.6;
const POLL_MS = 16;

type Held = { since: number, last: number };

const stickKeys = (pad: Gamepad): string[] => {
    const [x = 0, y = 0] = pad.axes;
    const keys: string[] = [];
    if (x <= -STICK_THRESHOLD) keys.push('ArrowLeft');
    if (x >= STICK_THRESHOLD) keys.push('ArrowRight');
    if (y <= -STICK_THRESHOLD) keys.push('ArrowUp');
    if (y >= STICK_THRESHOLD) keys.push('ArrowDown');
    return keys;
};

const startGamepads = () => {
    if (typeof navigator.getGamepads !== 'function') return () => { /* no Gamepad API */ };
    const held = new Map<string, Held>();

    // A timer, not requestAnimationFrame: frames stop when nothing redraws (and in
    // headless test browsers), and a pad must work regardless.
    const timer = window.setInterval(() => {
        const now = performance.now();
        const down = new Set<string>();
        for (const pad of navigator.getGamepads()) {
            if (!pad || !pad.connected) continue;
            // Only the standard mapping has known button numbers.
            if (pad.mapping === 'standard') {
                pad.buttons.forEach((button, index) => {
                    const key = BUTTON_KEYS[index];
                    if (key && button.pressed) down.add(key);
                });
            }
            stickKeys(pad).forEach((key) => down.add(key));
        }

        down.forEach((key) => {
            const state = held.get(key);
            if (!state) {
                held.set(key, { since: now, last: now });
                pressKey(key);
            } else if (REPEATING.has(key) && now - state.since >= REPEAT_DELAY_MS && now - state.last >= REPEAT_INTERVAL_MS) {
                state.last = now;
                pressKey(key, true);
            }
        });
        Array.from(held.keys()).forEach((key) => {
            if (!down.has(key)) held.delete(key);
        });
    }, POLL_MS);

    return () => window.clearInterval(timer);
};

export default startGamepads;
