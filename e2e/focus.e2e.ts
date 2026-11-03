// Stremio Big Picture, Phase 2: arrow navigation, initial focus, focus memory, Back.
// SPDX-License-Identifier: GPL-2.0-only

import { test, expect, type Remote } from './support/tv';

const BIG_PICTURE = 'bigpicture=1';

test.describe('in Big Picture', () => {
    test('Board starts on the first poster, and arrows follow the grid', async ({ remote }) => {
        const view = remote.view();
        await remote.open('/', BIG_PICTURE);
        await expect(view.getByTitle('movie top 1', { exact: true })).toBeFocused();

        await remote.press('ArrowRight');
        await expect(view.getByTitle('movie top 2', { exact: true })).toBeFocused();
        await remote.press('ArrowDown');
        await expect(view.getByTitle('series top 2', { exact: true })).toBeFocused();
        await remote.press('ArrowUp');
        await expect(view.getByTitle('movie top 2', { exact: true })).toBeFocused();
    });

    test('Left reaches the nav rail from any row, and Up reaches the top bar', async ({ remote }) => {
        const view = remote.view();
        await remote.open('/', BIG_PICTURE);
        await expect(view.getByTitle('movie top 1', { exact: true })).toBeFocused();

        // Three rows down, the rail's tabs are no longer beside the poster.
        await remote.press('ArrowDown', 3);
        await remote.press('ArrowLeft');
        await expect(view.locator('nav a.selected')).toBeFocused();
        await remote.press('ArrowRight');
        await expect(remote.focused()).toHaveAttribute('href', /#\/detail\//);

        // Board has no top bar (its hero takes the top), so Up from the first row stays in
        // the rows (at most on the row's own "See All").
        await remote.open('/', BIG_PICTURE);
        await expect(view.getByTitle('movie top 1', { exact: true })).toBeFocused();
        await remote.press('ArrowUp');
        await expect.poll(() => remote.focused().evaluate((element) => (
            element.closest('[class*="meta-row-container-"]') !== null && element.closest('nav') === null
        ))).toBe(true);

        // Elsewhere, Up reaches the top bar.
        await remote.open('/settings', BIG_PICTURE);
        await expect(remote.focused()).toContainText(/general/i);
        await remote.press('ArrowUp');
        await expect(remote.focused()).toHaveCount(1);
        expect(await remote.focused().evaluate((element) => element.closest('nav') !== null)).toBe(true);
    });

    for (const key of ['Escape', 'Backspace', 'BrowserBack']) {
        test(`${key} returns from details to the same poster`, async ({ remote }) => {
            const view = remote.view();
            await remote.open('/', BIG_PICTURE);
            await expect(view.getByTitle('movie top 1', { exact: true })).toBeFocused();
            await remote.press('ArrowDown');
            await remote.press('ArrowRight', 2);
            await expect(view.getByTitle('series top 3', { exact: true })).toBeFocused();

            await remote.press('Enter');
            await remote.arrived(/#\/detail\/series\/ttseries-top-3/);

            await (key === 'BrowserBack' ? remote.sendKey(key) : remote.press(key));
            await expect(remote.page).toHaveURL(/#\/$/);
            await expect(view.getByTitle('series top 3', { exact: true })).toBeFocused();
        });
    }

    test('a view that was unmounted gets its focus back too', async ({ remote }) => {
        const view = remote.view();
        await remote.open('/discover', BIG_PICTURE);
        await expect(view.locator('a[href*="#/detail/"]').first()).toBeFocused();
        await remote.press('ArrowRight', 2);

        // Library replaces Discover on the same level of the view stack.
        await remote.press('ArrowLeft', 3);
        await expect(view.locator('nav a.selected')).toBeFocused();
        await remote.press('ArrowDown');
        await expect(remote.focused()).toHaveAttribute('href', '#/library');
        await remote.press('Enter');
        await remote.arrived(/#\/library.*sort=/);

        await remote.press('Escape');
        await expect(remote.page).toHaveURL(/#\/discover/);
        // Focus was last on the Library tab, in Discover's own rail.
        await expect(view.locator('nav a[href="#/library"]')).toBeFocused();
        await remote.press('ArrowRight');
        await expect(remote.focused()).toHaveAttribute('href', /#\/detail\//);
    });

    test('Back on Board stays on Board', async ({ remote }) => {
        const view = remote.view();
        await remote.open('/', BIG_PICTURE);
        await expect(view.getByTitle('movie top 1', { exact: true })).toBeFocused();
        await remote.press('Escape');
        await remote.press('Backspace');
        await expect(remote.page).toHaveURL(/#\/$/);
        await expect(view.getByTitle('movie top 1', { exact: true })).toBeFocused();
    });

    test('Back closes an open menu first, then leaves the view', async ({ remote }) => {
        const view = remote.view();
        const language = view.getByText('English', { exact: true }).first();
        await remote.open('/settings', BIG_PICTURE);
        await expect(remote.focused()).toHaveCount(1);
        await remote.press('ArrowRight');
        await remote.focusBy('ArrowDown', language.locator('xpath=ancestor-or-self::*[@tabindex][1]'));

        await remote.press('Enter');
        const options = view.locator('[class*="option-"]', { hasText: 'Deutsch' });
        await expect(options.first()).toBeVisible();
        await remote.press('ArrowDown');
        // Arrows stay inside the open menu.
        expect(await remote.focused().evaluate((element) => /option-/.test(element.className))).toBe(true);

        await remote.press('Escape');
        await expect(options.first()).toBeHidden();
        await expect(remote.page).toHaveURL(/#\/settings/);
        await expect(language.locator('xpath=ancestor-or-self::*[@tabindex][1]')).toBeFocused();

        await remote.press('Escape');
        await expect(remote.page).not.toHaveURL(/#\/settings/);
    });

    test('Back closes a popup and returns focus to its button', async ({ remote }) => {
        // The top bar's account menu; Board has no top bar, so from Settings.
        await remote.open('/settings', BIG_PICTURE);
        await expect(remote.focused()).toContainText(/general/i);
        await remote.press('ArrowUp');
        await remote.press('ArrowRight', 5);
        const menuButton = remote.focused();
        const label = await menuButton.evaluate((element) => element.className);
        expect(label).toMatch(/nav-menu|label-container/);

        await remote.press('Enter');
        const popup = remote.page.locator('[data-focus-lock-disabled="false"]');
        await expect(popup).toBeVisible();
        await remote.press('Escape');
        await expect(popup).toHaveCount(0);
        await expect(remote.page).toHaveURL(/#\/settings/);
        expect(await remote.focused().evaluate((element) => element.className)).toBe(label);
    });

    test('Up and Down leave the zoom slider; Left and Right stay its own', async ({ remote }) => {
        const view = remote.view();
        const slider = view.locator('input[type="range"]');
        await remote.open('/settings', BIG_PICTURE);
        await expect(remote.focused()).toHaveCount(1);
        await remote.press('ArrowRight');
        await remote.focusBy('ArrowDown', slider);

        await remote.press('ArrowDown');
        await expect(view.getByRole('switch', { name: 'Big Picture mode' })).toBeFocused();
        await remote.press('ArrowUp');
        await expect(slider).toBeFocused();
        await remote.press('ArrowRight');
        await expect(slider).toBeFocused();
        await remote.press('ArrowLeft');
        await expect(slider).toBeFocused();
    });

    test('Search starts in the text field, whose caret keeps Left and Right, and Down enters the results', async ({ remote }) => {
        const input = remote.view().locator('input').first();
        await remote.open('/search', BIG_PICTURE);
        await expect(input).toBeFocused();
        await remote.page.keyboard.type('abc');
        await remote.press('ArrowLeft');
        await expect(input).toBeFocused();
        expect(await input.evaluate((element: HTMLInputElement) => element.selectionStart)).toBe(2);
        // Enter searches; Down then moves from the field into the results.
        await remote.press('Enter');
        await expect(remote.page).toHaveURL(/search=abc/);
        await expect(remote.view().getByTitle('movie abc 1', { exact: true })).toBeVisible();
        await remote.press('ArrowDown');
        await expect(remote.focused()).toHaveAttribute('href', /#\/detail\//);
    });

    test('Settings starts in its content, not the nav bars', async ({ remote }) => {
        await remote.open('/settings', BIG_PICTURE);
        await expect(remote.focused()).toHaveCount(1);
        expect(await remote.focused().evaluate((element) => element.closest('nav'))).toBeNull();
    });

    test('the focused control has a large ring', async ({ remote }) => {
        await remote.open('/', BIG_PICTURE);
        await expect(remote.view().getByTitle('movie top 1', { exact: true })).toBeFocused();
        // On a poster, the ring is drawn on the artwork: a solid ring plus a glow.
        // The first shadow is the ring: its spread is the last length before the comma.
        await expect.poll(() => remote.focused().evaluate((element) => {
            const shadow = getComputedStyle(element.querySelector('[class*="poster-container-"]')!).boxShadow;
            const [ring] = shadow.split(/,(?![^(]*\))/);
            return ring.includes('255, 181, 71') ? parseFloat(ring.trim().split(' ').pop()!) : 0;
        })).toBeGreaterThanOrEqual(4);
        // Other controls carry an outline ring.
        await remote.press('ArrowLeft');
        const outline = await remote.focused().evaluate((element) => parseFloat(getComputedStyle(element).outlineWidth));
        expect(outline).toBeGreaterThanOrEqual(4);
    });
});

test.describe('on a slow network', () => {
    // Longer than the engine's wait for posters, so it first settles for another control.
    test.use({ catalogDelay: 3000 });

    test('focus moves to the first poster once it arrives', async ({ remote }) => {
        const poster = remote.view().getByTitle('movie top 1', { exact: true });
        await remote.open('/', BIG_PICTURE);
        await expect(remote.focused()).toHaveCount(1, { timeout: 2500 });
        await expect(poster).toBeFocused({ timeout: 8000 });
    });

    test('but not after a key press', async ({ remote }) => {
        const poster = remote.view().getByTitle('movie top 1', { exact: true });
        await remote.open('/', BIG_PICTURE);
        await expect(remote.focused()).toHaveCount(1, { timeout: 2500 });
        await remote.press('ArrowRight');
        const chosen = await remote.focused().evaluate((element) => element.outerHTML);
        await expect(poster).toBeVisible({ timeout: 8000 });
        await remote.page.waitForTimeout(500);
        expect(await remote.focused().evaluate((element) => element.outerHTML)).toBe(chosen);
    });
});

test.describe('when rows load out of order', () => {
    test.use({ catalogDelay: { 'movie/top': 2500 } });

    test('focus still starts on the first row', async ({ remote }) => {
        await remote.open('/', BIG_PICTURE);
        // Other rows' posters exist first; focus may wait on them, then moves up.
        await expect(remote.view().getByTitle('movie top 1', { exact: true })).toBeFocused({ timeout: 6000 });
    });
});

test.describe('inside the shell', () => {
    test.use({ shell: true });

    test('Back never leaves fullscreen', async ({ remote }) => {
        const view = remote.view();
        await remote.open('/', BIG_PICTURE);
        await expect(view.getByTitle('movie top 1', { exact: true })).toBeFocused();
        await remote.press('Enter');
        await remote.arrived(/#\/detail\//);
        await remote.press('Escape');
        await expect(view.getByTitle('movie top 1', { exact: true })).toBeFocused();
        // Back on Board asks to quit; Back again closes the question, still fullscreen.
        await remote.press('Escape');
        await expect(remote.page.getByRole('alertdialog')).toBeVisible();
        await remote.press('Escape');
        await expect(remote.page.getByRole('alertdialog')).toHaveCount(0);
        await expect(view.getByTitle('movie top 1', { exact: true })).toBeFocused();

        // Closing a popup sends it an Escape of its own, which upstream would also
        // take as "leave fullscreen". The top bar's menu, from Settings (Board has no top bar).
        await remote.press('ArrowLeft');
        await remote.focusBy('ArrowDown', remote.view().locator('nav a[href="#/settings"]'));
        await remote.press('Enter');
        await remote.arrived(/#\/settings/);
        await remote.press('ArrowUp');
        await remote.press('ArrowRight', 5);
        await remote.press('Enter');
        const popup = remote.page.locator('[data-focus-lock-disabled="false"]');
        await expect(popup).toBeVisible();
        await remote.press('Escape');
        await expect(popup).toHaveCount(0);

        const fullscreen = (await remote.shellMessages())
            .filter(({ args }) => args?.[0] === 'win-set-visibility')
            .map(({ args }) => args?.[1]);
        expect(fullscreen).toEqual([{ fullscreen: true }]);
    });
});

test.describe('quitting from the remote', () => {
    test.use({ shell: true, gamepad: true });

    const quitRequests = async (remote: Remote) => (await remote.shellMessages())
        .filter(({ args }) => args?.[0] === 'quit');

    test('Back on Board asks to quit; Back again cancels, back on the same poster', async ({ remote }) => {
        const view = remote.view();
        await remote.open('/', BIG_PICTURE);
        const poster = view.getByTitle('movie top 1', { exact: true });
        await expect(poster).toBeFocused();
        await remote.press('Escape');
        const dialog = remote.page.getByRole('alertdialog', { name: 'Quit Stremio?' });
        await expect(dialog).toBeVisible();
        await expect(remote.focused()).toHaveText('Quit');
        // Arrows stay inside the dialog.
        await remote.press('ArrowRight');
        await expect(remote.focused()).toHaveText('Cancel');
        await remote.press('ArrowDown');
        await expect(remote.focused()).toHaveText('Cancel');
        await remote.press('Escape');
        await expect(dialog).toHaveCount(0);
        await expect(poster).toBeFocused();
        expect(await quitRequests(remote)).toEqual([]);
    });

    test('Cancel keeps the app open, and Quit asks the shell to quit', async ({ remote }) => {
        await remote.open('/', BIG_PICTURE);
        await expect(remote.view().getByTitle('movie top 1', { exact: true })).toBeFocused();
        const dialog = remote.page.getByRole('alertdialog', { name: 'Quit Stremio?' });
        await remote.press('Escape');
        await remote.press('ArrowRight');
        await remote.press('Enter');
        await expect(dialog).toHaveCount(0);
        expect(await quitRequests(remote)).toEqual([]);

        await remote.press('Escape');
        await expect(remote.focused()).toHaveText('Quit');
        await remote.press('Enter');
        await expect.poll(async () => (await quitRequests(remote)).length).toBe(1);
    });

    test('the gamepad does it too: B asks, A quits', async ({ remote }) => {
        await remote.open('/', BIG_PICTURE);
        await expect(remote.view().getByTitle('movie top 1', { exact: true })).toBeFocused();
        await remote.pad(1);
        await expect(remote.page.getByRole('alertdialog', { name: 'Quit Stremio?' })).toBeVisible();
        await remote.pad(0);
        await expect.poll(async () => (await quitRequests(remote)).length).toBe(1);
    });

    test('Back elsewhere still goes back, without asking', async ({ remote }) => {
        await remote.open('/', BIG_PICTURE);
        await expect(remote.view().getByTitle('movie top 1', { exact: true })).toBeFocused();
        await remote.press('Enter');
        await remote.arrived(/#\/detail\//);
        await remote.press('Escape');
        await remote.arrived(/#\/$/);
        await expect(remote.page.getByRole('alertdialog')).toHaveCount(0);
    });
});

test.describe('with Big Picture off', () => {
    test('upstream keeps its own keyboard behaviour', async ({ remote }) => {
        const view = remote.view();
        await remote.open('/');
        await expect(view.getByTitle('movie top 1', { exact: true })).toBeVisible();
        await expect(view.locator('nav a.selected')).toHaveAttribute('tabindex', '-1');
        await expect(remote.focused()).toHaveCount(0);
        await expect(remote.page.locator('#bigpicture-styles')).toHaveCount(0);
    });

    test('switching it off mid-session undoes the promoted controls', async ({ remote }) => {
        const toggle = remote.view().getByRole('switch', { name: 'Big Picture mode' });
        await remote.open('/settings', BIG_PICTURE);
        await expect(remote.view().locator('nav a.selected')).toHaveAttribute('tabindex', '0');
        await expect(remote.focused()).toHaveCount(1);
        await remote.press('ArrowRight');
        await remote.focusBy('ArrowDown', toggle);
        await remote.press('Enter');
        await expect(toggle).toHaveAttribute('aria-checked', 'false');
        await expect(remote.view().locator('nav a.selected')).toHaveAttribute('tabindex', '-1');
    });
});
