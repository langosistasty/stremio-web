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

const isFocusable = (element: Element): element is HTMLElement => (
    element instanceof HTMLElement &&
    element.tabIndex >= 0 &&
    !element.hasAttribute('data-focus-guard') &&
    !(element as HTMLButtonElement).disabled &&
    !element.closest('[inert], [aria-hidden="true"]') &&
    isShown(element)
);

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

// The vertical nav rail's current tab, where Left enters the rail from any row.
const railEntry = (scope: Element): HTMLElement | null => {
    const rail = Array.from(scope.querySelectorAll('nav')).find((nav) => {
        const { width, height } = nav.getBoundingClientRect();
        return height > width * 2;
    });
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
        if (selectionStart === null || selectionStart !== selectionEnd) return true;
        return direction === 'left' ? selectionStart > 0 : selectionStart < value.length;
    }
    return false;
};

const focusElement = (element: HTMLElement) => {
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: 'nearest', inline: 'nearest' });
};

export type { Direction };
export {
    currentLayer,
    focusElement,
    focusables,
    inLayer,
    inRail,
    isEditable,
    isFocusable,
    keepsArrow,
    navigationScope,
    openLayer,
    railEntry,
    topRoute,
};
