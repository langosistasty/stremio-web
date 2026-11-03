// Stremio Big Picture: soak test for a TV PC's renderer (tv/launch.sh --soak).
// With ?soak=1 the page drives itself: it visits the main screens and moves around each
// with arrow keys, as a person browsing would, so that scrolling, posters and the focus
// ring keep the renderer busy. A GPU or driver path that freezes under real use then
// freezes without anyone at the remote, and the freeze recording says when and where.
// The keys go through the focus engine like real ones; nothing is clicked or played.
// SPDX-License-Identifier: GPL-2.0-only

const KEY_MS = 400;
const SCREENS = ['/', '/discover', '/library', '/calendar', '/search?search=the', '/settings'];
// Down a screen, across, and back up: long enough on each to scroll its rows.
const WALK = [
    ...Array(6).fill('ArrowDown'),
    ...Array(4).fill('ArrowRight'),
    ...Array(3).fill('ArrowDown'),
    ...Array(4).fill('ArrowLeft'),
    ...Array(9).fill('ArrowUp'),
    ...Array(3).fill('ArrowRight'),
];

const enabled = () => {
    const hashQuery = window.location.hash.split('?')[1] ?? '';
    return new URLSearchParams(window.location.search).get('soak') === '1' ||
        new URLSearchParams(hashQuery).get('soak') === '1';
};

const press = (key: string) => {
    const target = document.activeElement ?? document.body;
    const init = { key, code: key, bubbles: true, cancelable: true };
    target.dispatchEvent(new KeyboardEvent('keydown', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
};

const startSoak = () => {
    if (!enabled()) return;
    let screen = 0;
    let step = 0;
    window.setInterval(() => {
        if (step === 0) {
            window.location.hash = `#${SCREENS[screen]}`;
            screen = (screen + 1) % SCREENS.length;
        } else {
            press(WALK[step - 1]);
        }
        step = (step + 1) % (WALK.length + 1);
    }, KEY_MS);
};

export default startSoak;
