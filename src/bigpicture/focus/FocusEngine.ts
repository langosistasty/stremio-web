// Stremio Big Picture: arrow navigation, initial focus, focus memory and the Back key.
// One capture-phase key handler decides first, so upstream handlers never see a key
// that Big Picture has used; the spatial-navigation polyfill only runs when Big Picture is off.
// SPDX-License-Identifier: GPL-2.0-only

import FocusMemory from './memory';
import nextInDirection from './spatial';
import {
    currentLayer, focusElement, focusables, inLayer, inRail, isEditable, isFocusable,
    keepsArrow, navigationScope, openLayer, railEntry, topRoute, type Direction,
} from './dom';

type Navigation = {
    // The history entry (react-router's location key).
    entry: string,
    type: 'POP' | 'PUSH' | 'REPLACE',
    path: string,
};

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
// A catalog row still loading (upstream's MetaRow placeholder).
const LOADING = '[class*="placeholder-container"]';
// What a view starts on. Catalog views wait for their posters, because loading
// placeholders come first. Phase 4 refines this per screen.
const START_RULES: { path: RegExp, selector: string, wait: boolean }[] = [
    { path: /^\/search/, selector: 'input', wait: false },
    { path: /^\/(discover|library|continuewatching)?(\/|$)/, selector: POSTER, wait: true },
];
// Last resort for a layer that ignores Escape and outside clicks.
const CLOSE_BUTTON = '[class*="close-button"], [class*="cancel-button"]';
const CLOSE_STEP_MS = 150;

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
    private navigation: Navigation = { entry: '', type: 'POP', path: '/' };
    private view: Element | null = null;
    private pending: Pending | null = { mode: 'initial', since: Date.now() };
    private observer: MutationObserver | null = null;
    private frame = 0;
    private timer = 0;
    private watchdog = 0;
    // A control focused only because the wait for content ran out; see check().
    private provisional: HTMLElement | null = null;

    constructor(private readonly goBack: () => void) {}

    start() {
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

    private stop() {
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
        // The player keeps its own keys until Phase 6.
        if (this.navigation.path.startsWith('/player')) return;

        const active = document.activeElement;
        const direction = ARROWS[event.key];
        if (direction) {
            if (keepsArrow(active, direction)) return;
            consume(event);
            this.move(direction);
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
        this.memory.remember(view, this.navigation.entry, target, Array.from(view.querySelectorAll(ALL_CONTROLS)));
    };

    private move(direction: Direction) {
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
        let next = nextInDirection(active, focusables(scope), direction, allowMisaligned);
        // Left enters the nav rail at the current tab, from any row, as TV apps do.
        if (direction === 'left' && !inRail(active) && (next === null || inRail(next))) {
            next = railEntry(scope) ?? next;
        }
        engineStats.moves += 1;
        if (next) focusElement(next);
    }

    private back() {
        const layer = currentLayer();
        if (layer) {
            this.closeLayer(layer);
        } else if (this.navigation.path !== '/') {
            // Home is the floor: Back never leaves Board through older history.
            this.goBack();
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

    private check = () => {
        engineStats.checks += 1;
        clearTimeout(this.timer);
        const view = topRoute();
        if (view !== this.view) {
            this.view = view;
            const restore = this.navigation.type === 'POP' && view !== null && this.memory.has(view, this.navigation.entry);
            this.pending = { mode: restore ? 'restore' : 'initial', since: Date.now() };
        }

        // An open layer manages its own focus (react-focus-lock).
        if (!view || openLayer()) return;
        const active = document.activeElement;
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
            const remembered = this.memory.recall(view, this.navigation.entry, Array.from(view.querySelectorAll(ALL_CONTROLS)));
            if (remembered && isFocusable(remembered)) return { element: remembered, final: true };
            if (!settled && this.memory.has(view, this.navigation.entry)) return null;
        }

        const candidates = focusables(view);
        const rule = START_RULES.find(({ path }) => path.test(this.navigation.path));
        if (rule) {
            const preferred = candidates.find((candidate) => candidate.matches(rule.selector));
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
