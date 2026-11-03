// Stremio Big Picture: screenshots of every screen at TV size, for reviewing the design
// without a TV. Skipped unless E2E_SHOTS=1; images go to e2e/shots/ (not in git).
//   E2E_SHOTS=1 e2e/run.sh --no-build --project=webkit screenshots
// Public screens use the real addons and artwork (needs the network); screens that need
// an account use the fake one, with fixture posters.
// SPDX-License-Identifier: GPL-2.0-only

import { test, expect, type Remote } from './support/tv';

const BIG_PICTURE = 'bigpicture=1';
const SHOTS = process.env.E2E_SHOTS === '1';

const shoot = async (remote: Remote, name: string) => {
    // Posters and backdrops arrive late; give them time to load and fade in.
    await remote.page.waitForLoadState('networkidle').catch(() => { /* streaming keeps it busy */ });
    await remote.page.waitForTimeout(2500);
    await remote.page.screenshot({ path: `shots/${name}.png` });
};

test.describe('screenshots', () => {
    test.skip(!SHOTS, 'set E2E_SHOTS=1 to take screenshots');
    // Headless WebKit draws no frames between screenshots, so a transition starts only
    // when one is taken and the picture shows its first frame (upstream's white ring
    // instead of the amber one). Without motion the screens show their settled look.
    test.use({ reducedMotion: 'reduce' });
    test.describe.configure({ mode: 'parallel' });

    test.describe('online', () => {
        test.use({ online: true });

        test('board', async ({ remote }) => {
            await remote.open('/', BIG_PICTURE);
            await expect(remote.page.locator('[class*="poster-image-"]').first()).toBeVisible({ timeout: 30000 });
            await expect(remote.page.locator('.bigpicture-hero-title')).toBeVisible({ timeout: 15000 });
            await shoot(remote, 'board');
            await remote.press('ArrowRight', 2);
            await remote.press('ArrowDown');
            await shoot(remote, 'board-moved');
            await remote.press('ArrowLeft', 4);
            await shoot(remote, 'board-rail');
        });

        test('discover', async ({ remote }) => {
            await remote.open('/discover', BIG_PICTURE);
            await expect(remote.focused()).toHaveCount(1, { timeout: 15000 });
            await shoot(remote, 'discover');
        });

        test('details', async ({ remote }) => {
            await remote.open('/', BIG_PICTURE);
            await expect(remote.page.locator('[class*="meta-item-link-"]:focus')).toHaveCount(1, { timeout: 30000 });
            await remote.press('Enter');
            await remote.page.waitForTimeout(4000);
            await shoot(remote, 'details-movie');
        });

        test('search, settings, addons, quit', async ({ remote }) => {
            await remote.open('/search?search=matrix', BIG_PICTURE);
            await remote.page.waitForTimeout(3000);
            await shoot(remote, 'search');
            await remote.open('/settings', BIG_PICTURE);
            await shoot(remote, 'settings');
            await remote.open('/addons', BIG_PICTURE);
            await shoot(remote, 'addons');
            await remote.open('/search', BIG_PICTURE);
            await remote.press('Enter');
            await shoot(remote, 'keyboard');
        });
    });

    test.describe('quit', () => {
        test.use({ online: true, shell: true });

        test('quit dialog', async ({ remote }) => {
            await remote.open('/', BIG_PICTURE);
            await expect(remote.focused()).toHaveCount(1, { timeout: 15000 });
            await remote.page.waitForTimeout(1500);
            await remote.press('Escape');
            await shoot(remote, 'quit');
        });
    });

    test.describe('signed in', () => {
        test.use({ account: true });

        test('library, continue watching, calendar', async ({ remote }) => {
            await remote.open('/library', BIG_PICTURE);
            await shoot(remote, 'library');
            await remote.open('/continuewatching', BIG_PICTURE);
            await shoot(remote, 'continuewatching');
            await remote.open('/calendar', BIG_PICTURE);
            await shoot(remote, 'calendar');
        });
    });
});
