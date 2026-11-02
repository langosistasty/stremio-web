// Stremio Big Picture, Phase 3: TV size, safe margin, simplified menus, scrolling.
// SPDX-License-Identifier: GPL-2.0-only

import { test, expect, type Remote } from './support/tv';

const BIG_PICTURE = 'bigpicture=1';

const interfaceScale = (remote: Remote) => remote.page.evaluate(() => (
    Number(getComputedStyle(document.documentElement).getPropertyValue('--interface-scale'))
));

// A Settings row's control, found by the row's label.
const settingControl = (remote: Remote, label: string) => remote.view()
    .locator(`xpath=//*[normalize-space(text())="${label}"]/ancestor::*[contains(@class, "option")][1]//*[@tabindex][1]`);

const inViewport = (remote: Remote, text: string) => remote.view().getByText(text, { exact: true }).first().evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return rect.top >= 0 && rect.bottom <= window.innerHeight;
});

test.describe('TV layout', () => {
    test('Big Picture enlarges the interface 1.5 times by default, and only in Big Picture', async ({ remote }) => {
        await remote.open('/', BIG_PICTURE);
        await expect.poll(() => interfaceScale(remote)).toBe(1.5);
        await remote.open('/');
        await expect.poll(() => interfaceScale(remote)).toBe(1);
    });

    test('TV size is chosen in Settings with the keyboard, and remembered', async ({ remote }) => {
        const size = settingControl(remote, 'TV size');
        await remote.open('/settings', BIG_PICTURE);
        await expect(remote.focused()).toHaveCount(1);
        await remote.press('ArrowRight');
        await remote.focusBy('ArrowDown', size);
        await remote.press('Enter');
        const option = remote.view().locator('[aria-selected]').filter({ hasText: /^200%$/ });
        await expect(option).toBeVisible();
        await remote.focusBy('ArrowDown', option);
        await remote.press('Enter');
        await expect.poll(() => interfaceScale(remote)).toBe(2);

        await remote.open('/', BIG_PICTURE);
        await expect.poll(() => interfaceScale(remote)).toBe(2);
    });

    test('a TV safe margin keeps everything away from the screen edges', async ({ remote }) => {
        const margin = settingControl(remote, 'TV safe margin');
        await remote.open('/settings', BIG_PICTURE);
        await expect(remote.focused()).toHaveCount(1);
        await remote.press('ArrowRight');
        await remote.focusBy('ArrowDown', margin);
        await remote.press('Enter');
        const option = remote.view().locator('[aria-selected]').filter({ hasText: /^5%$/ });
        await remote.focusBy('ArrowDown', option);
        await remote.press('Enter');

        const left = () => remote.page.locator('#app').evaluate((element) => element.getBoundingClientRect().left);
        await expect.poll(left).toBeGreaterThan(0);
    });

    test('the first row keeps its heading on screen, also after scrolling back up', async ({ remote }) => {
        const view = remote.view();
        await remote.open('/', BIG_PICTURE);
        await expect(view.getByTitle('movie top 1', { exact: true })).toBeFocused();
        expect(await inViewport(remote, 'Popular - Movie')).toBe(true);

        await remote.press('ArrowDown', 4);
        expect(await inViewport(remote, 'Popular - Movie')).toBe(false);
        await remote.press('ArrowUp', 4);
        await expect(view.getByTitle('movie top 1', { exact: true })).toBeFocused();
        expect(await inViewport(remote, 'Popular - Movie')).toBe(true);
    });

    test('a focused poster further down is fully on screen', async ({ remote }) => {
        await remote.open('/', BIG_PICTURE);
        await expect(remote.view().getByTitle('movie top 1', { exact: true })).toBeFocused();
        await remote.press('ArrowDown', 3);
        const box = await remote.focused().evaluate((element) => {
            const rect = element.getBoundingClientRect();
            return { top: rect.top, bottom: rect.bottom, height: window.innerHeight };
        });
        expect(box.top).toBeGreaterThanOrEqual(0);
        expect(box.bottom).toBeLessThanOrEqual(box.height);
    });

    test('the fullscreen button is gone in Big Picture, where the TV stays fullscreen', async ({ remote }) => {
        const fullscreenButton = remote.view().locator('nav [title*="ullscreen"], nav [title*="ull screen"]');
        await remote.open('/');
        await expect(fullscreenButton).toHaveCount(1);
        await remote.open('/', BIG_PICTURE);
        await expect(remote.view().getByTitle('movie top 1', { exact: true })).toBeFocused();
        await expect(fullscreenButton).toHaveCount(0);
    });
});

test.describe('inside the shell', () => {
    test.use({ shell: true });

    test('the Escape-leaves-fullscreen setting is hidden, since Escape means Back', async ({ remote }) => {
        await remote.open('/settings');
        const quitOnClose = remote.view().locator('[class*="option"]', { hasText: 'Quit on close' });
        await expect(quitOnClose.first()).toBeVisible();
        const escapeOption = remote.view().locator('[class*="option"]', { hasText: /Escape key/i });
        await expect(escapeOption.first()).toBeVisible();

        await remote.open('/settings', BIG_PICTURE);
        await expect(quitOnClose.first()).toBeVisible();
        await expect(escapeOption).toHaveCount(0);
    });
});
