// Stremio Big Picture: the player on a TV, without changing upstream's Player.
//
// Focus decides the mode. With nothing focused you're watching: Left and Right go to
// upstream's seek, and Up, Down or Enter bring up the controls. With a control focused,
// arrows move between controls. Upstream shows its overlay on mouse movement and hides it
// after 3 s; Big Picture sends it that movement on each key, and drops focus when it hides.
// SPDX-License-Identifier: GPL-2.0-only

import { focusElement, focusables, isFocusable, type Direction } from './dom';
import nextInDirection from './spatial';

type Actions = {
    goBack: () => void,
    // Sends a key to upstream's own handlers, marked so the focus engine ignores it.
    sendUpstream: (key: string) => void,
};

const ARROWS: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
const BACK_KEYS = new Set(['Escape', 'BrowserBack', 'GoBack', 'Backspace']);
// Media keys and the gamepad's shoulders map onto upstream's own player keys.
const UPSTREAM_KEYS: Record<string, string> = {
    MediaPlayPause: ' ', MediaPlay: ' ', MediaPause: ' ',
    MediaFastForward: 'ArrowRight', MediaTrackNext: 'ArrowRight', PageDown: 'ArrowRight',
    MediaRewind: 'ArrowLeft', MediaTrackPrevious: 'ArrowLeft', PageUp: 'ArrowLeft',
};
const MENU_TRY_MS = 100;
const MENU_TRIES = 10;
const MENU = '[class*="menu-layer"], [class*="side-drawer-layer"]';
// Upstream's control bar buttons; "control-bar-buttons-…" is their container.
const CONTROL_BUTTON = '[class*="control-bar-button-"]';

// The control bar button that opened the current menu.
let opener: HTMLElement | null = null;

const playerOf = (view: Element | null) => view?.querySelector<HTMLElement>('[class*="player-container"]') ?? null;

// Upstream renders a bare "layer" div to catch clicks while any menu or the side drawer is open.
const menuOpen = (player: HTMLElement) => Array.from(player.children).some((child) => (
    child.tagName === 'DIV' && child.classList.length === 1 && child.classList[0].startsWith('layer-') && child.childElementCount === 0
));

const openMenu = (player: HTMLElement) => (
    Array.from(player.querySelectorAll<HTMLElement>(MENU)).filter((menu) => focusables(menu).length > 0).pop() ?? null
);

const overlayHidden = (player: HTMLElement) => Array.from(player.classList).some((name) => name.startsWith('overlayHidden'));

// Keeps the overlay up for another 3 s, as a mouse movement over the player would.
const wake = (player: HTMLElement) => {
    player.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
};

const showControls = (player: HTMLElement) => {
    wake(player);
    // The first control bar button is Play/Pause.
    const play = Array.from(player.querySelectorAll<HTMLElement>(CONTROL_BUTTON)).find(isFocusable);
    if (play) focusElement(play);
};

const focusMenu = (player: HTMLElement) => {
    const menu = openMenu(player);
    if (!menu) return;
    const items = focusables(menu);
    const chosen = items.find((item) => item.classList.contains('selected') || item.getAttribute('aria-selected') === 'true' ||
        Array.from(item.classList).some((name) => name.startsWith('selected')));
    const target = chosen ?? items[0];
    if (target) focusElement(target);
};

// Returns whether Big Picture handled the key; if not, upstream's player gets it.
const playerKey = (event: KeyboardEvent, view: Element | null, actions: Actions): boolean => {
    const player = playerOf(view);
    if (!player) return false;
    const active = document.activeElement;
    const onControl = active instanceof HTMLElement && active !== player && player.contains(active) && isFocusable(active);
    const direction = ARROWS[event.key];

    if (BACK_KEYS.has(event.key)) {
        if (menuOpen(player)) {
            // The button that opened a menu toggles it shut again; failing that (a menu
            // opened by a shortcut key), upstream closes menus on a press outside them.
            if (opener?.isConnected) {
                opener.click();
                wake(player);
                focusElement(opener);
            } else {
                player.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
                showControls(player);
            }
            opener = null;
        } else if (onControl) {
            (active as HTMLElement).blur();
        } else {
            actions.goBack();
        }
        return true;
    }

    if (UPSTREAM_KEYS[event.key]) {
        actions.sendUpstream(UPSTREAM_KEYS[event.key]);
        return true;
    }
    if (event.key === 'MediaStop') {
        actions.goBack();
        return true;
    }

    if (direction) {
        if (menuOpen(player)) {
            const menu = openMenu(player);
            if (!menu) return true;
            if (!(active instanceof HTMLElement) || !menu.contains(active)) {
                focusMenu(player);
            } else {
                const next = nextInDirection(active, focusables(menu), direction, true);
                if (next) focusElement(next);
            }
            return true;
        }
        if (!onControl) {
            // Watching: Left and Right seek (upstream); Up and Down bring up the controls.
            if (direction === 'left' || direction === 'right') return false;
            showControls(player);
            return true;
        }
        wake(player);
        const candidates = focusables(player).filter((candidate) => !candidate.closest(MENU));
        const next = nextInDirection(active as HTMLElement, candidates, direction, true);
        if (next) focusElement(next);
        return true;
    }

    if (event.key === 'Enter' || event.key === 'ContextMenu') {
        if (!onControl && !menuOpen(player)) {
            showControls(player);
            return true;
        }
        wake(player);
        // Let the control act, then move into a menu it opened.
        // A slow machine renders the menu late, so keep looking for up to a second.
        const control = active as HTMLElement;
        let tries = 0;
        const look = () => {
            // Only while that control still has focus: a later key press owns what happens next.
            if (document.activeElement !== control) return;
            if (menuOpen(player) && !openMenu(player)?.contains(control)) {
                opener = control;
                focusMenu(player);
            } else if (++tries < MENU_TRIES) {
                window.setTimeout(look, MENU_TRY_MS);
            }
        };
        window.setTimeout(look, MENU_TRY_MS);
        return false;
    }
    return false;
};

// After DOM changes: when upstream hides the overlay, focus leaves the hidden controls,
// so the next Left or Right seeks again.
const checkPlayer = (view: Element | null) => {
    const player = playerOf(view);
    if (!player) return;
    const active = document.activeElement;
    if (overlayHidden(player) && active instanceof HTMLElement && active !== player && player.contains(active) && !menuOpen(player)) {
        active.blur();
    }
};

export { checkPlayer, playerKey };
