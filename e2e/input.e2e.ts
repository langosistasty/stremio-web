// Stremio Big Picture, Phase 5: gamepad, remote keys and the on-screen keyboard.
// SPDX-License-Identifier: GPL-2.0-only

import { test, expect } from './support/tv';

const BIG_PICTURE = 'bigpicture=1';
// Standard gamepad mapping.
const A = 0, B = 1, Y = 3, RB = 5, GUIDE = 16, UP = 12, DOWN = 13, LEFT = 14, RIGHT = 15;

test.describe('gamepad', () => {
    test.use({ gamepad: true });

    test('the D-pad moves focus, A opens, and B goes back to the same poster', async ({ remote }) => {
        const view = remote.view();
        await remote.open('/', BIG_PICTURE);
        await expect(view.getByTitle('movie top 1', { exact: true })).toBeFocused();
        await remote.pad(RIGHT);
        await expect(view.getByTitle('movie top 2', { exact: true })).toBeFocused();
        await remote.pad(DOWN);
        await expect(view.getByTitle('series top 2', { exact: true })).toBeFocused();
        await remote.pad(UP);
        await remote.pad(LEFT);
        await expect(view.getByTitle('movie top 1', { exact: true })).toBeFocused();

        await remote.pad(A);
        await remote.arrived(/#\/detail\/movie\/ttmovie-top-1/);
        await remote.pad(B);
        await expect(remote.page).toHaveURL(/#\/$/);
        await expect(view.getByTitle('movie top 1', { exact: true })).toBeFocused();
    });

    test('A on a nav rail tab, a plain link, follows it', async ({ remote }) => {
        await remote.open('/', BIG_PICTURE);
        await expect(remote.view().getByTitle('movie top 1', { exact: true })).toBeFocused();
        await remote.pad(LEFT);
        await remote.pad(DOWN);
        await expect(remote.focused()).toHaveAttribute('href', '#/discover');
        await remote.pad(A);
        await expect(remote.page).toHaveURL(/#\/discover/);
    });

    test('holding the D-pad repeats, like a held key', async ({ remote }) => {
        await remote.open('/', BIG_PICTURE);
        await expect(remote.view().getByTitle('movie top 1', { exact: true })).toBeFocused();
        await remote.pad(RIGHT, 900);
        const title = await remote.focused().getAttribute('title');
        expect(Number(title?.replace('movie top ', ''))).toBeGreaterThanOrEqual(4);
    });

    test('the left stick moves focus too', async ({ remote }) => {
        await remote.open('/', BIG_PICTURE);
        await expect(remote.view().getByTitle('movie top 1', { exact: true })).toBeFocused();
        await remote.pad('stick-right');
        await expect(remote.view().getByTitle('movie top 2', { exact: true })).toBeFocused();
    });

    test('RB jumps a few rows down, Y opens Search, and Guide goes Home', async ({ remote }) => {
        await remote.open('/', BIG_PICTURE);
        await expect(remote.view().getByTitle('movie top 1', { exact: true })).toBeFocused();
        await remote.pad(RB);
        await expect(remote.focused()).toHaveAttribute('title', /^series imdbRating|^channel top/);

        await remote.pad(Y);
        await expect(remote.page).toHaveURL(/#\/search/);
        await remote.pad(GUIDE);
        await expect(remote.page).toHaveURL(/#\/$/);
    });

    test('with upstream gamepad support also switched on, a press still acts once', async ({ remote }) => {
        const gamepadSupport = remote.view().locator('xpath=//*[normalize-space(text())="Enable gamepad support"]/ancestor::*[contains(@class, "option")][1]//*[@tabindex][1]');
        await remote.open('/settings', BIG_PICTURE);
        await expect(remote.focused()).toHaveCount(1);
        await remote.press('ArrowRight');
        await remote.focusBy('ArrowDown', gamepadSupport);
        await remote.press('Enter');
        await expect(gamepadSupport).toHaveClass(/checked/);

        await remote.open('/', BIG_PICTURE);
        await expect(remote.view().getByTitle('movie top 1', { exact: true })).toBeFocused();
        await remote.pad('stick-right');
        await remote.page.waitForTimeout(400);
        await expect(remote.view().getByTitle('movie top 2', { exact: true })).toBeFocused();
    });
});

test.describe('remote keys', () => {
    test('Home and Search keys go to Board and Search', async ({ remote }) => {
        await remote.open('/settings', BIG_PICTURE);
        await expect(remote.focused()).toHaveCount(1);
        await remote.sendKey('BrowserSearch');
        await expect(remote.page).toHaveURL(/#\/search/);
        await remote.sendKey('BrowserHome');
        await expect(remote.page).toHaveURL(/#\/$/);
    });

    test('Page Down and Page Up jump a few rows', async ({ remote }) => {
        await remote.open('/', BIG_PICTURE);
        await expect(remote.view().getByTitle('movie top 1', { exact: true })).toBeFocused();
        await remote.press('PageDown');
        await expect(remote.focused()).not.toHaveAttribute('title', /^(movie top|series top)/);
        await remote.press('PageUp');
        await expect(remote.view().getByTitle('movie top 1', { exact: true })).toBeFocused();
    });
});

test.describe('on-screen keyboard', () => {
    const keyboard = (remote: { page: import('@playwright/test').Page }) => remote.page.locator('#bigpicture-keyboard');

    test('Enter on an untouched field opens it; its keys type, and Done searches', async ({ remote }) => {
        await remote.open('/search', BIG_PICTURE);
        const input = remote.view().locator('input').first();
        await expect(input).toBeFocused();
        await remote.press('Enter');
        await expect(keyboard(remote)).toBeVisible();
        await expect(keyboard(remote).locator('[data-char="q"]')).toBeFocused();

        // q -> a (down) -> s -> d (right twice), then type it.
        await remote.press('ArrowDown');
        await remote.press('ArrowRight', 2);
        await expect(keyboard(remote).locator('[data-char="d"]')).toBeFocused();
        await remote.press('Enter');
        await expect(input).toHaveValue('d');
        await expect(keyboard(remote).locator('[data-preview]')).toHaveText('d');

        await remote.focusBy('ArrowDown', keyboard(remote).locator('[data-action="space"]'));
        await remote.focusBy('ArrowRight', keyboard(remote).locator('[data-action="done"]'));
        await remote.press('Enter');
        await expect(keyboard(remote)).toHaveCount(0);
        await expect(remote.page).toHaveURL(/search=d/);
    });

    test('Back closes the keyboard first and keeps the field focused', async ({ remote }) => {
        await remote.open('/search', BIG_PICTURE);
        const input = remote.view().locator('input').first();
        await expect(input).toBeFocused();
        await remote.press('Enter');
        await expect(keyboard(remote)).toBeVisible();
        await remote.press('Escape');
        await expect(keyboard(remote)).toHaveCount(0);
        await expect(input).toBeFocused();
        await expect(remote.page).toHaveURL(/#\/search/);
    });

    test('Shift types capitals, for passwords', async ({ remote }) => {
        await remote.open('/intro', BIG_PICTURE);
        await expect(remote.focused()).toHaveCount(1);
        await remote.press('ArrowDown');
        await expect(remote.focused()).toHaveAttribute('type', 'password');
        await remote.press('Enter');
        await remote.focusBy('ArrowDown', keyboard(remote).locator('[data-action="shift"]'));
        await remote.press('Enter');
        await remote.focusBy('ArrowUp', keyboard(remote).locator('[data-char="z"]'));
        await remote.press('Enter');
        await expect(keyboard(remote).locator('[data-preview]')).toHaveText('•');
        await remote.press('Escape');
        await expect(remote.focused()).toHaveValue('Z');
    });

    test.describe('with a gamepad', () => {
        test.use({ gamepad: true });

        test('A opens it on a field and types with its keys', async ({ remote }) => {
            await remote.open('/search', BIG_PICTURE);
            const input = remote.view().locator('input').first();
            await expect(input).toBeFocused();
            await remote.pad(A);
            await expect(keyboard(remote).locator('[data-char="q"]')).toBeFocused();
            await remote.pad(A);
            await expect(input).toHaveValue('q');
            await remote.pad(B);
            await expect(keyboard(remote)).toHaveCount(0);
        });
    });
});
