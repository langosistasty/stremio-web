// Stremio Big Picture: which controls on screen the arrow keys can reach.
// Starting from the current focus, it follows every arrow move breadth-first. To try
// the moves from a control it puts focus there directly; every move itself is a real key.
// SPDX-License-Identifier: GPL-2.0-only

import type { Remote } from './tv';

type Crawl = {
    reached: number,
    total: number,
    // Controls on screen that no sequence of arrow presses reaches.
    unreachable: string[],
};

const ARROWS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

// Numbers every control on screen the way the focus engine sees them.
const tagControls = (remote: Remote) => remote.page.evaluate(() => {
    const view = document.querySelector('.routes-container')?.lastElementChild;
    const layer = Array.from(document.querySelectorAll<HTMLElement>('[data-focus-lock-disabled="false"], [role="menu"]'))
        .filter((element) => element.getClientRects().length > 0).pop();
    const scope = layer ?? view;
    if (!scope) return 0;
    let next = Number(document.body.dataset.e2eNext ?? 0);
    scope.querySelectorAll<HTMLElement>('a[href], button, input, select, textarea, [tabindex]').forEach((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const visible = element.getClientRects().length > 0 && style.visibility !== 'hidden' &&
            !(element.matches('input, select, textarea') && style.opacity === '0') && rect.width >= 2 && rect.height >= 2;
        if (element.tabIndex < 0 || !visible || element.hasAttribute('data-focus-guard') || element.closest('[aria-hidden="true"]')) return;
        if (!element.dataset.e2eId) element.dataset.e2eId = String(next++);
    });
    document.body.dataset.e2eNext = String(next);
    return next;
});

const focusedId = (remote: Remote) => remote.page.evaluate(() => (document.activeElement as HTMLElement | null)?.dataset.e2eId ?? null);

const describe = (remote: Remote, ids: string[]) => remote.page.evaluate((ids) => ids.map((id) => {
    const element = document.querySelector<HTMLElement>(`[data-e2e-id="${id}"]`);
    if (!element) return `#${id} (gone)`;
    const name = element.getAttribute('title') ?? element.getAttribute('aria-label') ?? (element.textContent ?? '').trim().slice(0, 40);
    const kind = (element.getAttribute('class') ?? '').split(' ')[0].replace(/-[\w-]{5}$/, '');
    return `${element.tagName.toLowerCase()}.${kind} "${name}"`;
}), ids);

const crawl = async (remote: Remote, { limit = 200 } = {}): Promise<Crawl> => {
    await tagControls(remote);
    const start = await focusedId(remote);
    if (start === null) throw new Error('Nothing is focused to start from');
    const reached = new Set([start]);
    const queue = [start];
    while (queue.length > 0 && reached.size < limit) {
        const from = queue.shift()!;
        for (const key of ARROWS) {
            // Arrive the way the engine does: text fields get the caret at the end.
            await remote.page.evaluate((id) => {
                const element = document.querySelector<HTMLElement>(`[data-e2e-id="${id}"]`);
                // Scroll as the engine does when a control isn't fully visible: to mid-screen.
                element?.focus({ preventScroll: true });
                element?.scrollIntoView({ block: 'center', inline: 'nearest' });
                if (element instanceof HTMLInputElement && element.type === 'text') {
                    element.setSelectionRange(element.value.length, element.value.length);
                }
            }, from);
            await remote.page.keyboard.press(key);
            let to = await focusedId(remote);
            // A move that found nothing may scroll for more content and try again.
            if (to === from) {
                await remote.page.waitForTimeout(400);
                to = await focusedId(remote);
            }
            await tagControls(remote);
            to = to ?? await focusedId(remote);
            if (to !== null && !reached.has(to)) {
                reached.add(to);
                queue.push(to);
            }
        }
    }
    const all = await remote.page.evaluate(() => Array.from(document.querySelectorAll<HTMLElement>('[data-e2e-id]'))
        .filter((element) => element.getClientRects().length > 0)
        .map((element) => element.dataset.e2eId!));
    // A control nested in a reached one (upstream wraps some buttons in links) is the
    // same thing on screen, so it counts as reached.
    const nested = await remote.page.evaluate(([all, reached]) => all.filter((id) => {
        const element = document.querySelector(`[data-e2e-id="${id}"]`);
        return reached.some((other) => {
            const reachedElement = document.querySelector(`[data-e2e-id="${other}"]`);
            return reachedElement !== null && element !== null && (reachedElement.contains(element) || element.contains(reachedElement));
        });
    }), [all, [...reached]] as [string[], string[]]);
    const unreachable = all.filter((id) => !reached.has(id) && !nested.includes(id));
    return { reached: reached.size, total: all.length, unreachable: await describe(remote, unreachable) };
};

export { crawl };
