// Stremio Big Picture, Phase 6: the player with a remote. Plays the WebM fixture clip in
// the browser's own video element; on the TV, mpv plays it, behind the same controls.
// SPDX-License-Identifier: GPL-2.0-only

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { test, expect, type Remote } from './support/tv';

const BIG_PICTURE = 'bigpicture=1';

const video = (remote: Remote) => remote.page.locator('video');
const currentTime = (remote: Remote) => video(remote).evaluate((element: HTMLVideoElement) => element.currentTime);
const paused = (remote: Remote) => video(remote).evaluate((element: HTMLVideoElement) => element.paused);
const overlayHidden = (remote: Remote) => remote.page.locator('[class*="player-container"]').evaluate((element) => (
    Array.from(element.classList).some((name) => name.startsWith('overlayHidden'))
));
const nothingFocused = (remote: Remote) => remote.page.evaluate(() => document.activeElement === document.body);

// Opens the first stream of a movie and waits until it plays.
const play = async (remote: Remote) => {
    await remote.open('/detail/movie/ttmovie-top-1', BIG_PICTURE);
    await expect(remote.focused()).toHaveAttribute('class', /stream/, { timeout: 8000 });
    await remote.press('Enter');
    await expect(remote.page).toHaveURL(/#\/player\//);
    await expect.poll(() => currentTime(remote), { timeout: 15000 }).toBeGreaterThan(0.5);
};

test.beforeEach(() => {
    test.skip(!existsSync(join(__dirname, 'fixtures', 'clip.webm')), 'needs e2e/fixtures/clip.webm (run.sh makes it with ffmpeg)');
});

test('Back from the player returns to the stream that was playing', async ({ remote }) => {
    await play(remote);
    await remote.press('Escape');
    await expect(remote.page).toHaveURL(/#\/detail\/movie\/ttmovie-top-1/);
    await expect(remote.focused()).toHaveAttribute('class', /stream/);
    await expect(remote.focused()).toContainText('1080p');
});

test('while watching, Left and Right seek', async ({ remote }) => {
    await play(remote);
    const before = await currentTime(remote);
    await remote.press('ArrowRight');
    await expect.poll(() => currentTime(remote)).toBeGreaterThan(before + 5);
    expect(await nothingFocused(remote)).toBe(true);
    const after = await currentTime(remote);
    await remote.press('ArrowLeft');
    await expect.poll(() => currentTime(remote)).toBeLessThan(after);
});

test('Down brings up the controls on Pause; arrows move, and Enter pauses', async ({ remote }) => {
    await play(remote);
    await remote.press('ArrowDown');
    await expect(remote.focused()).toHaveAttribute('title', 'Pause');
    await remote.press('ArrowRight');
    await expect(remote.focused()).toHaveAttribute('title', 'Mute');
    await remote.press('ArrowLeft');
    await remote.press('Enter');
    await expect.poll(() => paused(remote)).toBe(true);
    await expect(remote.focused()).toHaveAttribute('title', 'Play');
    await remote.press('Enter');
    await expect.poll(() => paused(remote)).toBe(false);
});

test('Back hides the controls first, then leaves the player', async ({ remote }) => {
    await play(remote);
    await remote.press('Enter');
    await expect(remote.focused()).toHaveAttribute('title', 'Pause');
    await remote.press('Escape');
    await expect.poll(() => nothingFocused(remote)).toBe(true);
    await expect(remote.page).toHaveURL(/#\/player\//);
    await remote.press('Escape');
    await expect(remote.page).toHaveURL(/#\/detail\//);
});

test('the controls hide by themselves while playing, and Right seeks again', async ({ remote }) => {
    await play(remote);
    await remote.press('ArrowUp');
    await expect(remote.focused()).toHaveAttribute('title', 'Pause');
    await expect.poll(() => overlayHidden(remote), { timeout: 8000 }).toBe(true);
    await expect.poll(() => nothingFocused(remote)).toBe(true);
    const before = await currentTime(remote);
    await remote.press('ArrowRight');
    await expect.poll(() => currentTime(remote)).toBeGreaterThan(before + 5);
});

test('a control bar menu takes focus, keeps the arrows, and Back closes only it', async ({ remote }) => {
    await play(remote);
    await remote.press('ArrowDown');
    await expect(remote.focused()).toHaveAttribute('title', 'Pause');
    // Further right along the bar: the playback speed button opens a menu.
    for (let step = 0; step < 6; step += 1) {
        await remote.press('ArrowRight');
        await remote.press('Enter');
        // A menu takes a moment to appear and take focus.
        await remote.page.waitForTimeout(400);
        if (await remote.page.locator('[class*="menu-layer"]').count() > 0) break;
        // Not a menu button: undo anything it toggled by pressing it again.
        await remote.press('Enter');
    }
    const menu = remote.page.locator('[class*="menu-layer"]').last();
    await expect(menu).toBeVisible();
    await expect.poll(() => menu.evaluate((element) => element.contains(document.activeElement))).toBe(true);
    await remote.press('ArrowDown');
    expect(await menu.evaluate((element) => element.contains(document.activeElement))).toBe(true);

    await remote.press('Escape');
    await expect(remote.page.locator('[class*="menu-layer"]')).toHaveCount(0);
    await expect(remote.page).toHaveURL(/#\/player\//);
});

test('the Play/Pause media key pauses and resumes', async ({ remote }) => {
    await play(remote);
    await remote.sendKey('MediaPlayPause');
    await expect.poll(() => paused(remote)).toBe(true);
    await remote.sendKey('MediaPlayPause');
    await expect.poll(() => paused(remote)).toBe(false);
});
