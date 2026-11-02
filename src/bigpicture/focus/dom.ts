// Stremio Big Picture: DOM queries for the focus engine. Upstream uses CSS modules with
// hashed class names, so these rely on stable attributes and unhashed global classes.
// SPDX-License-Identifier: GPL-2.0-only

// An open popup or dialog: react-focus-lock marks each active lock, and ActionMenu renders a menu role.
const LAYER = '[data-focus-lock-disabled="false"], [role="menu"]';
const CANDIDATE = 'a[href], button, input, select, textarea, [tabindex]';
const TEXT_INPUT_TYPES = new Set(['text', 'search', 'email', 'password', 'tel', 'url', 'number']);

type Direction = 'left' | 'right' | 'up' | 'down';

const isShown = (element: Element) => (
    element.isConnected &&
    element.getClientRects().length > 0 &&
    window.getComputedStyle(element).visibility !== 'hidden'
);

// Visually hidden form controls (the real checkbox behind a styled one) are skipped,
// so focus never lands somewhere invisible.
const isFocusable = (element: Element): element is HTMLElement => {
    if (
        !(element instanceof HTMLElement) ||
        element.tabIndex < 0 ||
        element.hasAttribute('data-focus-guard') ||
        (element as HTMLButtonElement).disabled ||
        element.closest('[inert], [aria-hidden="true"]') ||
        !isShown(element)
    ) return false;
    const { width, height } = element.getBoundingClientRect();
    if (width < 2 || height < 2) return false;
    // Only form inputs: other controls fade in from opacity 0 (upstream's fade-in
    // animation) and must count as there from the start.
    return !element.matches('input, select, textarea') || window.getComputedStyle(element).opacity !== '0';
};

// The route on screen: lower views stay mounted but hidden (see stremio-router).
const topRoute = (): HTMLElement | null => {
    const route = document.querySelector('.routes-container')?.lastElementChild;
    return route instanceof HTMLElement ? route : null;
};

const openLayer = (): HTMLElement | null => {
    const layers = Array.from(document.querySelectorAll<HTMLElement>(LAYER)).filter(isShown);
    return layers[layers.length - 1] ?? null;
};

// Upstream marks menus with --spatial-navigation-contain: contain. Whether the property
// inherits depends on the engine, so take the outermost of the contiguous ancestors.
const containRegion = (element: Element, scope: Element | null = null): HTMLElement | null => {
    let region: HTMLElement | null = null;
    for (let node: Element | null = element; node && node !== scope; node = node.parentElement) {
        const contained = window.getComputedStyle(node).getPropertyValue('--spatial-navigation-contain').trim() === 'contain';
        if (contained && node instanceof HTMLElement) {
            region = node;
        } else if (region) {
            break;
        }
    }
    return region;
};

// Inside a popup, dialog or menu, rather than the view itself.
const inLayer = (element: Element) => element.closest(LAYER) !== null || containRegion(element) !== null;

// What Back closes first: the menu region holding focus, else the topmost popup or dialog.
const currentLayer = (): HTMLElement | null => {
    const active = document.activeElement;
    const region = active && active !== document.body ? containRegion(active) : null;
    return region && isShown(region) ? region : openLayer();
};

// Where arrows may move focus right now.
const navigationScope = (): HTMLElement => {
    const base = openLayer() ?? topRoute() ?? document.body;
    const active = document.activeElement;
    return (active && base.contains(active) && containRegion(active, base)) || base;
};

// The vertical nav rail: a nav bar much taller than wide.
const railOf = (scope: Element): HTMLElement | null => (
    Array.from(scope.querySelectorAll('nav')).find((nav) => {
        const { width, height } = nav.getBoundingClientRect();
        return height > width * 2;
    }) ?? null
);

// The rail's current tab, where Left enters the rail from any row.
const railEntry = (scope: Element): HTMLElement | null => {
    const rail = railOf(scope);
    if (!rail) return null;
    const tabs = focusables(rail);
    return tabs.find((tab) => tab.classList.contains('selected')) ?? tabs[0] ?? null;
};

const inRail = (element: Element) => {
    const nav = element.closest('nav');
    if (!nav) return false;
    const { width, height } = nav.getBoundingClientRect();
    return height > width * 2;
};

const focusables = (scope: Element): HTMLElement[] => (
    Array.from(scope.querySelectorAll(CANDIDATE)).filter(isFocusable)
);

const isTextInput = (element: Element | null): element is HTMLInputElement | HTMLTextAreaElement => (
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(element.type))
);

const isEditable = (element: Element | null) => (
    isTextInput(element) || (element instanceof HTMLElement && element.isContentEditable)
);

// Whether a focused control needs this arrow itself: text fields move the caret until it
// reaches an edge, and sliders change their value. Up and down always move focus.
const keepsArrow = (element: Element | null, direction: Direction) => {
    if (direction === 'up' || direction === 'down') return false;
    if (element instanceof HTMLInputElement && element.type === 'range') return true;
    if (element?.getAttribute('role') === 'slider') return true;
    if (isTextInput(element)) {
        const { selectionStart, selectionEnd, value } = element;
        // Email and number fields have no caret position to read: empty ones let the
        // arrow go, filled ones keep it for editing (Up and Down still leave).
        if (selectionStart === null) return value.length > 0;
        if (selectionStart !== selectionEnd) return true;
        return direction === 'left' ? selectionStart > 0 : selectionStart < value.length;
    }
    return false;
};

// The smallest container around the element that holds other controls too, below the
// scope; null when the element is alone up to the scope.
const focusGroup = (element: Element, candidates: HTMLElement[], scope: Element): Element | null => {
    for (let node = element.parentElement; node && node !== scope; node = node.parentElement) {
        if (candidates.some((candidate) => candidate !== element && node.contains(candidate))) return node;
    }
    return null;
};

// A menu that opened next to the element (an upstream dropdown keeps focus on its label):
// a shown contain region or popup within a few levels of the element.
const openedMenu = (element: Element): HTMLElement | null => {
    let node: Element | null = element;
    for (let level = 0; level < 4 && node; level += 1, node = node.parentElement) {
        const regions = Array.from(node.querySelectorAll<HTMLElement>('*')).filter((candidate) => (
            !candidate.contains(element) &&
            isShown(candidate) &&
            (candidate.matches(LAYER) ||
                window.getComputedStyle(candidate).getPropertyValue('--spatial-navigation-contain').trim() === 'contain')
        ));
        const region = regions.find((candidate) => focusables(candidate).length > 0);
        if (region) return region;
    }
    return null;
};

// Scrolls the element's nearest vertically scrollable ancestor by most of a screen, if
// it can go further that way. Returns whether it scrolled.
const scrollFurther = (element: Element, direction: 'up' | 'down') => {
    for (let node = element.parentElement; node && node !== document.documentElement; node = node.parentElement) {
        const { overflowY } = window.getComputedStyle(node);
        if (!/(auto|scroll)/.test(overflowY) || node.scrollHeight <= node.clientHeight) continue;
        const room = direction === 'down' ? node.scrollHeight - node.clientHeight - node.scrollTop : node.scrollTop;
        if (room < 1) return false;
        node.scrollBy({ top: (direction === 'down' ? 1 : -1) * Math.min(room, node.clientHeight * 0.6), behavior: 'instant' as ScrollBehavior });
        return true;
    }
    return false;
};

// Whether the element shows whole, inside every ancestor that clips it.
const fullyVisible = (element: HTMLElement) => {
    // The route container that clips at the screen's edge is one of the ancestors, so
    // no viewport check is needed (and under CSS zoom its units differ between engines).
    const rect = element.getBoundingClientRect();
    for (let node = element.parentElement; node && node !== document.body; node = node.parentElement) {
        const style = window.getComputedStyle(node);
        if (style.overflowX === 'visible' && style.overflowY === 'visible') continue;
        const clip = node.getBoundingClientRect();
        if (rect.top < clip.top || rect.left < clip.left || rect.bottom > clip.bottom || rect.right > clip.right) return false;
    }
    return true;
};

// Scroll only when needed, and then put the control mid-screen vertically, as TV apps
// do: rows stay in a steady place, and the top of a page is never scrolled away.
const focusElement = (element: HTMLElement) => {
    element.focus({ preventScroll: true });
    // Arriving in a text field puts the caret at the end, so Right leaves at once and
    // Left starts editing.
    if (isTextInput(element) && element.type !== 'number' && element.type !== 'email') {
        element.setSelectionRange(element.value.length, element.value.length);
    }
    if (!fullyVisible(element)) {
        element.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
};

export type { Direction };
export {
    currentLayer,
    focusElement,
    focusGroup,
    focusables,
    inLayer,
    inRail,
    isEditable,
    isFocusable,
    keepsArrow,
    navigationScope,
    openLayer,
    openedMenu,
    railEntry,
    railOf,
    scrollFurther,
    topRoute,
};
