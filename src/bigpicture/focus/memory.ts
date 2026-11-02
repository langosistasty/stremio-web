// Stremio Big Picture: remember where focus was, per route view and per history entry.
// SPDX-License-Identifier: GPL-2.0-only

// Identifies a control again after its view was unmounted and rendered anew.
type Descriptor = {
    signature: string,
    // Which of the controls with this signature it was (a title can be in several rows).
    nth: number,
};

const signature = (element: Element) => [
    element.getAttribute('href'),
    element.getAttribute('title'),
    element.getAttribute('aria-label'),
    (element.textContent ?? '').trim().slice(0, 80),
].join('\u0000');

const describe = (element: HTMLElement, candidates: HTMLElement[]): Descriptor => {
    const own = signature(element);
    const same = candidates.filter((candidate) => signature(candidate) === own);
    return { signature: own, nth: Math.max(0, same.indexOf(element)) };
};

const find = ({ signature: wanted, nth }: Descriptor, candidates: HTMLElement[]) => {
    const same = candidates.filter((candidate) => signature(candidate) === wanted);
    return same[nth] ?? same[0] ?? null;
};

class FocusMemory {
    // A view that stays mounted below another one keeps its elements.
    private byView = new WeakMap<Element, HTMLElement>();
    // Keyed by history entry, for views that were unmounted in between, and by path,
    // for entries that were replaced (an episode's streams replace its series page).
    private byEntry = new Map<string, Descriptor>();
    private byPath = new Map<string, Descriptor>();

    remember(view: Element, entry: string, path: string, element: HTMLElement, candidates: HTMLElement[]) {
        const descriptor = describe(element, candidates);
        this.byView.set(view, element);
        this.byEntry.set(entry, descriptor);
        this.byPath.set(path, descriptor);
    }

    recall(view: Element, entry: string, path: string, candidates: HTMLElement[]): HTMLElement | null {
        const element = this.byView.get(view);
        if (element && candidates.includes(element)) return element;
        const descriptor = this.byEntry.get(entry) ?? this.byPath.get(path);
        return descriptor ? find(descriptor, candidates) : null;
    }

    has(view: Element, entry: string, path: string) {
        return this.byView.has(view) || this.byEntry.has(entry) || this.byPath.has(path);
    }
}

export default FocusMemory;
