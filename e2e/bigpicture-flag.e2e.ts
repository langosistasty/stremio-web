// Stremio Big Picture, Phase 1: the mode switch, launch flag and shell fullscreen.
// SPDX-License-Identifier: GPL-2.0-only

import { test, expect } from './support/tv';

const fullscreenRequests = (messages: { args?: unknown[] }[]) => (
    messages.filter(({ args }) => args?.[0] === 'win-set-visibility')
);

test.describe('without the shell', () => {
    test('is off by default, and the normal UI is unchanged', async ({ remote }) => {
        await remote.open('/');
        await expect(remote.page.locator('html')).not.toHaveAttribute('data-bigpicture');
    });

    test('the launch flag turns it on before or inside the hash', async ({ remote }) => {
        await remote.open('/', 'bigpicture=1');
        await expect(remote.page.locator('html')).toHaveAttribute('data-bigpicture');

        await remote.open('/?bigpicture=on');
        await expect(remote.page.locator('html')).toHaveAttribute('data-bigpicture');
    });

    test('the launch flag lasts for that session only', async ({ remote }) => {
        await remote.open('/', 'bigpicture=1');
        await expect(remote.page.locator('html')).toHaveAttribute('data-bigpicture');

        await remote.open('/');
        await expect(remote.page.locator('html')).not.toHaveAttribute('data-bigpicture');
    });

    test('the Settings switch works with the keyboard and is remembered', async ({ remote }) => {
        const html = remote.page.locator('html');
        const toggle = remote.page.getByRole('switch', { name: 'Big Picture mode' });

        await remote.open('/settings');
        await remote.focusBy('Tab', toggle);
        await expect(toggle).toHaveAttribute('aria-checked', 'false');

        await remote.press('Enter');
        await expect(toggle).toHaveAttribute('aria-checked', 'true');
        await expect(html).toHaveAttribute('data-bigpicture');

        await remote.open('/');
        await expect(html).toHaveAttribute('data-bigpicture');

        // A launch flag still wins over the saved setting, for that session.
        await remote.open('/', 'bigpicture=0');
        await expect(html).not.toHaveAttribute('data-bigpicture');

        // The override did not touch the saved setting, which turns off the same way.
        await remote.open('/settings');
        await remote.focusBy('Tab', toggle);
        await expect(toggle).toHaveAttribute('aria-checked', 'true');
        await remote.press('Enter');
        await expect(toggle).toHaveAttribute('aria-checked', 'false');
        await remote.open('/');
        await expect(html).not.toHaveAttribute('data-bigpicture');
    });
});

test.describe('inside the shell', () => {
    test.use({ shell: true });

    test('asks for fullscreen exactly once when Big Picture is on', async ({ remote }) => {
        await remote.open('/', 'bigpicture=1');
        await expect.poll(async () => fullscreenRequests(await remote.shellMessages())).toEqual([
            expect.objectContaining({ args: ['win-set-visibility', { fullscreen: true }] }),
        ]);
        // The shell answers each request with a state change; that must not trigger another one.
        await remote.page.waitForTimeout(1000);
        expect(fullscreenRequests(await remote.shellMessages())).toHaveLength(1);
    });

    test('leaves the window alone when Big Picture is off', async ({ remote }) => {
        await remote.open('/');
        await expect.poll(async () => (await remote.shellMessages()).length).toBeGreaterThan(0);
        await remote.page.waitForTimeout(1000);
        expect(fullscreenRequests(await remote.shellMessages())).toEqual([]);
    });
});
