// Stremio Big Picture: deliver a key press from a non-keyboard input (gamepad, on-screen
// keyboard) the way a keyboard would, so every handler treats it the same.
// SPDX-License-Identifier: GPL-2.0-only

const KEY_CODES: Record<string, number> = {
    Enter: 13, Escape: 27, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40,
    PageUp: 33, PageDown: 34, ContextMenu: 93, BrowserSearch: 170, BrowserHome: 172,
};

const pressKey = (key: string, repeat = false) => {
    const target = document.activeElement instanceof HTMLElement ? document.activeElement : document.body;
    const init = { key, code: key, keyCode: KEY_CODES[key] ?? 0, which: KEY_CODES[key] ?? 0, repeat, bubbles: true, cancelable: true };
    const handled = !target.dispatchEvent(new KeyboardEvent('keydown', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
    // A browser only follows a link or presses a button for a real Enter. Upstream's
    // Button handles Enter itself (and cancels the event); plain links and buttons need a
    // click. Checkboxes handle Enter without cancelling, so they're left out.
    if (key === 'Enter' && !handled && !repeat && target !== document.body &&
        target.matches('a[href], button, [role="option"], [role="menuitem"]')) {
        target.click();
    }
};

export default pressKey;
