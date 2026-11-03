// Stremio Big Picture: arrow navigation, initial focus, focus memory and the Back key.
// One capture-phase key handler decides first, so upstream handlers never see a key
// that Big Picture has used; the spatial-navigation polyfill only runs when Big Picture is off.
// SPDX-License-Identifier: GPL-2.0-only

import FocusMemory from './memory';
import nextInDirection from './spatial';
import { checkPlayer, playerKey } from './player';
import { openKeyboard, wantsKeyboard } from '../input/keyboard';
import {
    currentLayer, focusElement, focusables, inLayer, inRail, isEditable, isFocusable,
    focusGroup, isTextInput, keepsArrow, navigationScope, openLayer, openedMenu, railEntry, railOf, scrollFurther, topRoute, type Direction,
} from './dom';

type Navigation = {
    // The history entry (react-router's location key).
    entry: string,
    type: 'POP' | 'PUSH' | 'REPLACE',
    path: string,
    search: string,
};

type Navigate = (to: string, options: { replace: boolean }) => void;

type Pending = {
    // 'restore' prefers where focus was before; 'initial' starts on the view's main content.
    mode: 'restore' | 'initial',
    since: number,
};

const ARROWS: Record<string, Direction> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
const BACK_KEYS = new Set(['Escape', 'BrowserBack', 'GoBack']);
// Content often arrives after the view: wait this long for it before settling for the nav bars.
const SETTLE_MS = 1500;
const ALL_CONTROLS = 'a[href], button, input, select, textarea, [tabindex]';
const POSTER = '[href^="#/metadetails/"], [href^="#/detail/"]';
// A details page with an episode chosen: /detail/<type>/<id>/<episode>.
const EPISODE_PATH = /^\/((?:meta)?details?\/[^/]+\/[^/]+)\/[^/]+$/;
const STREAM = '[class*="stream-container"], [class*="stream-action"]';
const EPISODE = '[class*="video-container"]';
// A catalog row still loading (upstream's MetaRow placeholder).
const LOADING = '[class*="placeholder-container"]';
// What a view starts on. Catalog views wait for their posters, because loading
// placeholders come first. Phase 4 refines this per screen.
// Selectors are tried in order, so a details page prefers a stream over an episode.
const START_RULES: { path: RegExp, selectors: string[], wait: boolean }[] = [
    { path: /^\/search/, selectors: ['input'], wait: false },
    { path: /^\/(discover|library|continuewatching)?(\/|$)/, selectors: [POSTER], wait: true },
    // Streams and episodes arrive from addons after the page itself.
    { path: /^\/(meta)?details?\//, selectors: [STREAM, EPISODE], wait: true },
];
// Last resort for a layer that ignores Escape and outside clicks.
const CLOSE_BUTTON = '[class*="close-button"], [class*="cancel-button"]';
const CLOSE_STEP_MS = 150;
const SCROLL_RETRY_MS = 250;
const MENU_OPEN_MS = 120;
const PAGE_STEPS = 3;

const syntheticEvents = new WeakSet<Event>();

// Running totals for the diagnostics heartbeat: a focus fight shows as many checks
// and engine-made focus changes without key presses.
const engineStats = { checks: 0, moves: 0, focused: 0 };

const consume = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
};

class FocusEngine {
    private memory = new FocusMemory();
    private navigation: Navigation = { entry: '', type: 'POP', path: '/', search: '' };
    private view: Element | null = null;
    private pending: Pending | null = { mode: 'initial', since: Date.now() };
    private observer: MutationObserver | null = null;
    private frame = 0;
    private timer = 0;
    private watchdog = 0;
    // A control focused only because the wait for content ran out; see check().
    private provisional: HTMLElement | null = null;
    // The last control focused outside the nav rail, for Right out of the rail.
    private lastContent: HTMLElement | null = null;

    // onHomeBack: Back on Board, where history has nowhere left to go (asks to quit).
    constructor(private readonly goBack: () => void, private readonly navigate: Navigate, private readonly onHomeBack?: () => void) {}

    // The key for remembering focus by place rather than by history entry.
    private get place() {
        return this.navigation.path + this.navigation.search;
    }

    start() {
        // The bundled spatial-navigation polyfill would also act on arrows that Big Picture
        // passes on (the player's seek keys); switch it off through its own API meanwhile.
        const polyfill = (window as { __spatialNavigation__?: { keyMode: string } }).__spatialNavigation__;
        this.polyfillKeyMode = polyfill?.keyMode ?? null;
        if (polyfill) polyfill.keyMode = 'NONE';
        window.addEventListener('keydown', this.onKeyDown, true);
        document.addEventListener('focusin', this.onFocusIn, true);
        // Views change, content loads, layers open and close: re-check focus after each batch.
        this.observer = new MutationObserver(this.schedule);
        this.observer.observe(document.body, {
            subtree: true,
            childList: true,
            attributes: true,
            attributeFilter: ['class', 'style', 'hidden', 'data-focus-lock-disabled'],
        });
        // Focus can also drop without any mutation (a blur on unmount, engine quirks).
        // A TV must never sit with nothing focused, so catch that too.
        document.addEventListener('focusout', this.onFocusOut, true);
        this.watchdog = window.setInterval(() => {
            const active = document.activeElement;
            if (!active || active === document.body || !active.isConnected) this.schedule();
        }, 500);
        this.view = topRoute();
        this.schedule();
        return () => this.stop();
    }

    setNavigation(navigation: Navigation) {
        this.navigation = navigation;
    }

    private polyfillKeyMode: string | null = null;

    private stop() {
        const polyfill = (window as { __spatialNavigation__?: { keyMode: string } }).__spatialNavigation__;
        if (polyfill && this.polyfillKeyMode) polyfill.keyMode = this.polyfillKeyMode;
        window.removeEventListener('keydown', this.onKeyDown, true);
        document.removeEventListener('focusin', this.onFocusIn, true);
        document.removeEventListener('focusout', this.onFocusOut, true);
        this.observer?.disconnect();
        clearTimeout(this.frame);
        clearTimeout(this.timer);
        clearInterval(this.watchdog);
    }

    private onFocusOut = (event: FocusEvent) => {
        if (event.relatedTarget === null) this.schedule();
    };

    // Coalesces mutation bursts. A timeout, not requestAnimationFrame: headless WebKit
    // never runs frames, and a hidden window throttles them.
    private schedule = () => {
        clearTimeout(this.frame);
        this.frame = window.setTimeout(this.check, 30);
    };

    private onKeyDown = (event: KeyboardEvent) => {
        if (syntheticEvents.has(event) || event.isComposing || event.ctrlKey || event.altKey || event.metaKey) return;
        // Once the person has pressed something, focus is theirs: never move it for them.
        this.provisional = null;
        // The player has its own TV rules (player.ts); keys it doesn't use go to upstream.
        if (this.navigation.path.startsWith('/player')) {
            const actions = { goBack: () => this.goBack(), sendUpstream: (key: string) => this.sendUpstream(key) };
            if (playerKey(event, topRoute(), actions)) consume(event);
            return;
        }

        const active = document.activeElement;
        const direction = ARROWS[event.key];
        if (direction) {
            if (keepsArrow(active, direction)) return;
            consume(event);
            this.move(direction);
            return;
        }

        // Enter on a text field opens the on-screen keyboard, unless it was typed into.
        if (event.key === 'Enter' && isTextInput(active) && wantsKeyboard(active)) {
            consume(event);
            openKeyboard(active);
            return;
        }

        // Remote and gamepad keys: jump a few rows, or go Home or to Search.
        if (event.key === 'PageUp' || event.key === 'PageDown') {
            if (isEditable(active)) return;
            consume(event);
            for (let step = 0; step < PAGE_STEPS; step += 1) this.move(event.key === 'PageUp' ? 'up' : 'down', false);
            return;
        }
        if (event.key === 'BrowserHome' || event.key === 'GoHome') {
            consume(event);
            if (this.navigation.path !== '/') this.navigate('/', { replace: false });
            return;
        }
        if (event.key === 'BrowserSearch') {
            consume(event);
            if (!this.navigation.path.startsWith('/search')) this.navigate('/search', { replace: false });
            return;
        }

        if (event.key === 'Enter' && active instanceof HTMLElement && !isEditable(active)) {
            // Let the control act first, then move into a menu it opened.
            window.setTimeout(() => this.enterOpenedMenu(active), MENU_OPEN_MS);
            return;
        }

        if (BACK_KEYS.has(event.key) || (event.key === 'Backspace' && !isEditable(active))) {
            consume(event);
            if (!event.repeat) this.back();
        }
    };

    private onFocusIn = (event: FocusEvent) => {
        const view = topRoute();
        const target = event.target;
        if (!view || !(target instanceof HTMLElement) || !view.contains(target) || inLayer(target)) return;
        this.pending = null;
        this.memory.remember(view, this.navigation.entry, this.place, target, Array.from(view.querySelectorAll(ALL_CONTROLS)));
        if (!inRail(target)) this.lastContent = target;
    };

    private move(direction: Direction, retry = true) {
        const scope = navigationScope();
        const active = document.activeElement;
        if (!(active instanceof HTMLElement) || active === document.body || !scope.contains(active) || !isFocusable(active)) {
            // Nothing sensible is focused: a key press is the moment to fix that, without waiting.
            this.pending = { mode: 'restore', since: 0 };
            this.check();
            return;
        }

        // Left and Right stay in line, so a row's last item is a dead end rather than a
        // jump to some other row. Up and Down may leave a column to reach the bars, but
        // not from the rail, whose bottom would otherwise drop into the content.
        const allowMisaligned = (direction === 'up' || direction === 'down') && !inRail(active);
        // The rail is entered with Left only; Up and Down from the content stay out of it.
        const rail = (direction === 'up' || direction === 'down') && !inRail(active) ? railOf(scope) : null;
        const candidates = focusables(scope).filter((candidate) => !rail?.contains(candidate));
        // Focus groups, for Left and Right: look first among the controls that share the
        // smallest container with this one (a row's posters, a bar's buttons), then on
        // the whole screen. Up and Down search the whole screen, so they cross rows.
        const group = direction === 'left' || direction === 'right' ? focusGroup(active, candidates, scope) : null;
        let next = (group && nextInDirection(active, candidates.filter((candidate) => group.contains(candidate)), direction, allowMisaligned)) ??
            nextInDirection(active, candidates, direction, allowMisaligned);
        // Left enters the nav rail at the current tab, from any row, as TV apps do.
        // Right out of the rail goes back to where you left the screen, as TV apps do,
        // rather than to whatever lines up with the tab (a row scrolled up under Board's hero).
        if (direction === 'right' && inRail(active) && this.lastContent?.isConnected && scope.contains(this.lastContent) && isFocusable(this.lastContent)) {
            next = this.lastContent;
        }
        if (direction === 'left' && !inRail(active) && (next === null || inRail(next))) {
            next = railEntry(scope) ?? next;
        }
        engineStats.moves += 1;
        if (next) {
            focusElement(next);
        } else if (retry && (direction === 'up' || direction === 'down') && scrollFurther(active, direction)) {
            // Lists like Search and Discover render rows only as they scroll into view,
            // so there may be more below: scroll, then look again once they have rendered.
            const from = active;
            window.setTimeout(() => {
                if (document.activeElement === from) this.move(direction, false);
            }, SCROLL_RETRY_MS);
        }
    }

    // Upstream dropdowns open with focus left on their label, where arrows and Back would
    // act on the screen behind. TV menus take focus when they open, on the chosen option.
    private enterOpenedMenu(opener: HTMLElement) {
        if (document.activeElement !== opener) return;
        const menu = openedMenu(opener);
        if (!menu) return;
        const options = focusables(menu);
        const target = options.find((option) => option.getAttribute('aria-selected') === 'true') ?? options[0];
        if (target) focusElement(target);
    }

    private back() {
        const layer = currentLayer();
        if (layer) {
            this.closeLayer(layer);
        } else if (EPISODE_PATH.test(this.navigation.path)) {
            // An episode's streams replace the series page in history; Back goes to its
            // episode list, as on a TV, rather than past the series.
            this.navigate(this.navigation.path.replace(EPISODE_PATH, '/$1'), { replace: true });
        } else if (this.navigation.path !== '/') {
            // Home is the floor: Back never leaves Board through older history.
            this.goBack();
        } else {
            this.onHomeBack?.();
        }
    }

    // Upstream layers close themselves in different ways. Try them in order, stopping
    // once the layer is gone: an Escape key (marked as ours, so the key handler lets it
    // through), an outside click, then a close button. A real Escape never travels on,
    // because FullscreenProvider would also leave fullscreen on it.
    private closeLayer(layer: HTMLElement) {
        const open = () => layer.isConnected && layer.getClientRects().length > 0;
        const active = document.activeElement;
        const target = active instanceof HTMLElement && layer.contains(active) ? active : layer;
        const escape = new KeyboardEvent('keydown', {
            key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true, cancelable: true,
        });
        syntheticEvents.add(escape);
        target.dispatchEvent(escape);

        setTimeout(() => {
            if (!open()) return;
            ['pointerdown', 'mousedown', 'mouseup'].forEach((type) => {
                document.body.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true }));
            });
            setTimeout(() => {
                if (open()) layer.querySelector<HTMLElement>(CLOSE_BUTTON)?.click();
            }, CLOSE_STEP_MS);
        }, CLOSE_STEP_MS);
    }

    // A key for upstream's own handlers (the player's), marked so this engine ignores it.
    private sendUpstream(key: string) {
        const code = key === ' ' ? 'Space' : key;
        const keyCode = { ' ': 32, ArrowLeft: 37, ArrowRight: 39 }[key] ?? 0;
        const init = { key, code, keyCode, which: keyCode, bubbles: true, cancelable: true };
        const down = new KeyboardEvent('keydown', init);
        const up = new KeyboardEvent('keyup', init);
        syntheticEvents.add(down);
        syntheticEvents.add(up);
        document.body.dispatchEvent(down);
        document.body.dispatchEvent(up);
    }

    private check = () => {
        engineStats.checks += 1;
        clearTimeout(this.timer);
        const view = topRoute();
        // In the player, nothing focused is a normal state (watching); see player.ts.
        if (this.navigation.path.startsWith('/player')) {
            this.view = view;
            this.pending = null;
            checkPlayer(view);
            return;
        }
        if (view !== this.view) {
            this.view = view;
            const restore = this.navigation.type === 'POP' && view !== null && this.memory.has(view, this.navigation.entry, this.place);
            this.pending = { mode: restore ? 'restore' : 'initial', since: Date.now() };
        }

        if (!view) return;
        const active = document.activeElement;
        // An open layer keeps focus inside itself (react-focus-lock), but upstream doesn't
        // always move focus in when it opens: then start on its first control.
        const layer = openLayer();
        if (layer) {
            if (!(active instanceof HTMLElement) || !layer.contains(active) || !isFocusable(active)) {
                const first = focusables(layer)[0];
                if (first) {
                    engineStats.focused += 1;
                    focusElement(first);
                }
            }
            return;
        }
        if (active && view.contains(active) && isFocusable(active)) {
            this.pending = null;
            // Content that was slow to load replaces a stopgap, until the first key press.
            if (active === this.provisional) {
                const choice = this.pick(view, { mode: 'initial', since: 0 });
                if (choice && choice.element !== active) {
                    this.provisional = choice.final ? null : choice.element;
                    engineStats.focused += 1;
                    focusElement(choice.element);
                } else if (choice?.final) {
                    this.provisional = null;
                }
            }
            return;
        }

        // Focus was lost (a layer closed, a control disappeared): go back to where it was.
        this.pending = this.pending ?? { mode: 'restore', since: Date.now() };
        const choice = this.pick(view, this.pending);
        if (choice) {
            this.pending = null;
            this.provisional = choice.final ? null : choice.element;
            engineStats.focused += 1;
            focusElement(choice.element);
        } else {
            // Nothing to focus yet; content may still be loading.
            this.timer = window.setTimeout(this.check, SETTLE_MS);
        }
    };

    // `final` is false for a stopgap taken because the wait ran out before content arrived.
    private pick(view: Element, pending: Pending): { element: HTMLElement, final: boolean } | null {
        const settled = Date.now() - pending.since >= SETTLE_MS;
        if (pending.mode === 'restore') {
            const remembered = this.memory.recall(view, this.navigation.entry, this.place, Array.from(view.querySelectorAll(ALL_CONTROLS)));
            if (remembered && isFocusable(remembered)) return { element: remembered, final: true };
            if (!settled && this.memory.has(view, this.navigation.entry, this.place)) return null;
        }

        const candidates = focusables(view);
        const rule = START_RULES.find(({ path }) => path.test(this.navigation.path));
        if (rule) {
            const preferred = rule.selectors
                .map((selector) => candidates.find((candidate) => candidate.matches(selector)))
                .find((candidate) => candidate !== undefined);
            if (preferred) {
                // Rows load in any order: a poster below a row still loading is only a stopgap.
                const loadingAbove = rule.wait && Array.from(view.querySelectorAll(LOADING)).some((row) => (
                    (row.compareDocumentPosition(preferred) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
                ));
                return { element: preferred, final: !loadingAbove };
            }
            if (rule.wait && !settled) return null;
        }
        // The main content, not the nav bars. A view with no content after the wait
        // (an empty library) starts on the nav bars.
        const content = candidates.find((candidate) => !candidate.closest('nav'));
        if (content) return { element: content, final: !rule?.wait };
        const fallback = settled ? candidates[0] : undefined;
        return fallback ? { element: fallback, final: false } : null;
    }
}

export { engineStats };
export default FocusEngine;
