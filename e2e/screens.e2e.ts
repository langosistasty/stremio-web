// Stremio Big Picture, Phase 4: every screen. Each starts focus somewhere useful, and
// every control on it can be reached with the arrow keys alone.
// SPDX-License-Identifier: GPL-2.0-only

import { test, expect, type Remote } from './support/tv';
import { crawl } from './support/crawl';

const BIG_PICTURE = 'bigpicture=1';

const describeFocus = (remote: Remote) => remote.focused().evaluate((element) => (
    element.getAttribute('title') ?? element.getAttribute('aria-label') ?? (element.textContent ?? '').trim()
));

// Library, Continue Watching and Calendar need an account; offline they show a log-in prompt.
const SCREENS: { route: string, start: RegExp | string }[] = [
    { route: '/', start: 'movie top 1' },
    { route: '/discover', start: 'movie top 1' },
    { route: '/library', start: /log in/i },
    { route: '/continuewatching', start: /log in/i },
    { route: '/calendar', start: /log in/i },
    { route: '/search?search=matrix', start: '' },
    { route: '/addons', start: /installed/i },
    { route: '/settings', start: /general/i },
    { route: '/detail/movie/ttmovie-top-1', start: /WatchHub|Fixture/ },
    { route: '/detail/series/ttseries-top-1', start: /Episode 1/ },
    { route: '/detail/series/ttseries-top-1/ttseries-top-1%3A1%3A1', start: /WatchHub|Fixture/ },
    { route: '/intro', start: '' },
];

for (const { route, start } of SCREENS) {
    test(`${route} starts in the right place, and every control is reachable`, async ({ remote }) => {
        test.setTimeout(120000);
        await remote.open(route, BIG_PICTURE);
        await expect(remote.focused()).toHaveCount(1, { timeout: 8000 });
        // Late content (streams, rows) may still move the start; let it settle.
        await remote.page.waitForTimeout(1600);
        const startedOn = await describeFocus(remote);
        if (typeof start === 'string') expect(startedOn).toBe(start);
        else expect(startedOn).toMatch(start);

        const result = await crawl(remote, { limit: 150 });
        expect(result.unreachable, `reached ${result.reached} of ${result.total}`).toEqual([]);
    });
}

test.describe('screen by screen', () => {
    test('Details of a series: an episode leads to its streams, and Back returns to the episode', async ({ remote }) => {
        // Arrive the way a person does, from Board, so Back has history to go back through.
        const view = remote.view();
        await remote.open('/', BIG_PICTURE);
        await expect(view.getByTitle('movie top 1', { exact: true })).toBeFocused();
        await remote.press('ArrowDown');
        await expect(view.getByTitle('series top 1', { exact: true })).toBeFocused();
        await remote.press('Enter');
        await remote.arrived(/#\/detail\/series\/ttseries-top-1/);
        const episode2 = remote.view().locator('[class*="video-container"]', { hasText: 'Episode 2' });
        await expect(remote.view().locator('[class*="video-container"]').first()).toBeFocused({ timeout: 8000 });
        await remote.press('ArrowDown');
        await expect(episode2).toBeFocused();
        await remote.press('Enter');
        await expect(remote.page).toHaveURL(/ttseries-top-1%3A1%3A2/);
        await expect(remote.focused()).toHaveAttribute('class', /stream/, { timeout: 8000 });

        await remote.press('Escape');
        await expect(remote.page).not.toHaveURL(/%3A1%3A2/);
        await expect(episode2).toBeFocused();
    });

    test('Search: typing and Enter show results that the arrows reach', async ({ remote }) => {
        await remote.open('/search', BIG_PICTURE);
        const input = remote.view().locator('input').first();
        await expect(input).toBeFocused();
        await remote.page.keyboard.type('dune');
        await remote.press('Enter');
        await expect(remote.page).toHaveURL(/search=dune/);
        await expect(remote.view().getByTitle('movie dune 1', { exact: true })).toBeVisible();
        await remote.press('ArrowDown');
        await expect(remote.focused()).toHaveAttribute('title', /dune/);
    });

    test('Discover: a filter opens, and Back closes it without leaving the screen', async ({ remote }) => {
        await remote.open('/discover', BIG_PICTURE);
        await expect(remote.view().getByTitle('movie top 1', { exact: true })).toBeFocused();
        await remote.press('ArrowUp');
        const filter = remote.focused();
        await expect(filter).toHaveCount(1);
        expect(await filter.evaluate((element) => element.closest('nav'))).toBeNull();
        await remote.press('Enter');
        const options = remote.page.locator('[aria-selected]');
        await expect(options.first()).toBeVisible();
        // The open menu takes focus, on its chosen option.
        await expect(remote.focused()).toHaveAttribute('aria-selected', 'true');
        await remote.press('Escape');
        await expect(options).toHaveCount(0);
        await expect(remote.page).toHaveURL(/#\/discover/);
    });

    test('Addons: an addon opens its details, and Back closes them', async ({ remote }) => {
        await remote.open('/addons', BIG_PICTURE);
        await expect(remote.focused()).toContainText(/installed/i);
        // Down from the tabs reaches the list of installed addons.
        await remote.press('ArrowDown');
        await expect(remote.focused()).toContainText('Cinemeta');
        const addon = await remote.focused().evaluate((element) => element.outerHTML.slice(0, 200));
        await remote.press('Enter');
        const dialog = remote.page.locator('[data-focus-lock-disabled="false"]');
        await expect(dialog).toBeVisible();
        // The dialog takes focus, and arrows move inside it.
        await expect.poll(() => dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
        await remote.press('ArrowDown');
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(true);
        await remote.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(remote.page).toHaveURL(/#\/addons/);
        await expect.poll(() => remote.focused().evaluate((element) => element.outerHTML.slice(0, 200))).toBe(addon);
    });

    test('Intro: the log-in fields take text, and arrows move between them', async ({ remote }) => {
        // Logging in needs Stremio's servers, so only the form itself is tested offline.
        await remote.open('/intro', BIG_PICTURE);
        const email = remote.view().locator('input[type="email"], input').first();
        await expect(email).toBeFocused();
        await remote.page.keyboard.type('tv@example.com');
        await remote.press('ArrowDown');
        await expect(email).not.toBeFocused();
        await expect(remote.focused()).toHaveAttribute('type', 'password');
        await remote.press('ArrowUp');
        await expect(email).toBeFocused();
        await expect(email).toHaveValue('tv@example.com');
    });
});

// With a fake account (support/account.ts): a library of series and movies, some half
// watched, with episodes over the months around today.
test.describe('signed in', () => {
    test.use({ account: true });

    const SIGNED_IN: { route: string, start: RegExp }[] = [
        { route: '/library', start: /library/ },
        { route: '/continuewatching', start: /library/ },
        { route: '/calendar', start: /\S/ },
    ];
    for (const { route, start } of SIGNED_IN) {
        test(`${route} starts in the right place, and every control is reachable`, async ({ remote }) => {
            // Calendar has a control per day and per episode: crawling it takes minutes.
            test.setTimeout(360000);
            await remote.open(route, BIG_PICTURE);
            await expect(remote.focused()).toHaveCount(1, { timeout: 8000 });
            await remote.page.waitForTimeout(1600);
            expect(await describeFocus(remote)).toMatch(start);
            const result = await crawl(remote, { limit: 250 });
            expect(result.unreachable, `reached ${result.reached} of ${result.total}`).toEqual([]);
        });
    }

    test('Calendar: earlier months open from the remote, and their days are reachable', async ({ remote }) => {
        await remote.open('/calendar', BIG_PICTURE);
        const prev = remote.view().locator('[class*="prev"]').first();
        // Calendar starts on its month selector.
        await expect(prev).toBeFocused({ timeout: 8000 });
        let url = remote.page.url();
        for (let month = 0; month < 3; month += 1) {
            await remote.press('Enter');
            await expect(remote.page).not.toHaveURL(url);
            url = remote.page.url();
            await expect(prev).toBeFocused();
            // The new month's grid re-renders after the URL changes; keys pressed during
            // that land on cells that are about to be replaced.
            await remote.page.waitForTimeout(400);
            await remote.press('ArrowDown');
            await expect(remote.focused()).toHaveAttribute('class', /cell/);
            await remote.press('ArrowRight');
            await remote.press('ArrowDown');
            await expect(remote.focused()).toHaveAttribute('class', /cell/);
            await remote.press('ArrowUp');
            await remote.press('ArrowLeft');
            await remote.press('ArrowUp');
            await expect(prev).toBeFocused();
        }
    });
});
