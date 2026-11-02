// Stremio Big Picture: test fixtures. Tests drive the app with the keyboard only,
// offline, optionally inside a fake Stremio shell.
// SPDX-License-Identifier: GPL-2.0-only

import { test as base, expect, type Locator, type Page } from '@playwright/test';

type ShellMessage = { type: number, args?: unknown[] };

type Options = {
    // Pretend to run inside the Stremio desktop shell (window.chrome.webview IPC).
    shell: boolean,
};

type Remote = {
    page: Page,
    // Launch the app. `query` goes before the hash, like a launcher's --url.
    open: (route?: string, query?: string) => Promise<void>,
    press: (key: string, times?: number) => Promise<void>,
    focused: () => Locator,
    // Press `key` until `target` has focus; fails after `limit` presses.
    focusBy: (key: string, target: Locator, limit?: number) => Promise<void>,
    shellMessages: () => Promise<ShellMessage[]>,
};

// Runs in the page before any app code. Counts real pointer input, so a test that
// touches the mouse fails, and optionally installs a fake shell that behaves like
// stremio-linux-shell: answers the handshake and echoes fullscreen changes.
const pageSetup = ({ shell }: { shell: boolean }) => {
    const w = window as any;
    w.__pointerInput = [];
    ['pointerdown', 'mousedown', 'wheel', 'touchstart'].forEach((type) => {
        window.addEventListener(type, (event) => {
            if (event.isTrusted) w.__pointerInput.push(type);
        }, true);
    });

    if (!shell) return;
    w.__shellMessages = [];
    let listeners: ((message: { data: string }) => void)[] = [];
    const emit = (event: object) => setTimeout(() => {
        listeners.forEach((listener) => listener({ data: JSON.stringify(event) }));
    });
    w.chrome = w.chrome ?? {};
    w.chrome.webview = {
        postMessage: (data: string) => {
            const message = JSON.parse(data);
            w.__shellMessages.push(message);
            if (message.type === 3) {
                emit({ id: 0, type: 3, data: { transport: { properties: [[0, 'shellVersion', 0, 'e2e']] } } });
            }
            const [method, arg] = message.args ?? [];
            if (method === 'win-set-visibility' && typeof arg?.fullscreen === 'boolean') {
                emit({ id: 1, type: 1, args: ['win-visibility-changed', { visible: true, visibility: 4, isFullscreen: arg.fullscreen }] });
            }
        },
        addEventListener: (_: string, listener: (message: { data: string }) => void) => listeners.push(listener),
        removeEventListener: (_: string, listener: (message: { data: string }) => void) => {
            listeners = listeners.filter((other) => other !== listener);
        },
    };
};

const test = base.extend<Options & { remote: Remote }>({
    shell: [false, { option: true }],
    remote: async ({ page, context, baseURL, shell }, use) => {
        // Offline: only the app's own files load. Addons, the Stremio API and the
        // streaming server are unreachable unless a test routes them to fixtures.
        await context.route('**/*', (route) => (
            route.request().url().startsWith(baseURL!) ? route.continue() : route.abort('blockedbyclient')
        ));
        await page.addInitScript(pageSetup, { shell });

        const focused = () => page.locator(':focus');
        const remote: Remote = {
            page,
            open: async (route = '/', query = '') => {
                // A fresh load every time, like relaunching; a hash-only goto would not reload.
                await page.goto('about:blank');
                await page.goto(`${query ? `?${query}` : ''}#${route}`);
                // The app has rendered once the router has a view on screen.
                await expect(page.locator('#app [class*="route-container"]').first()).toBeVisible();
            },
            press: async (key, times = 1) => {
                for (let i = 0; i < times; i += 1) {
                    await page.keyboard.press(key);
                }
            },
            focused,
            focusBy: async (key, target, limit = 80) => {
                for (let i = 0; i < limit; i += 1) {
                    if (await target.evaluate((element) => element === document.activeElement)) return;
                    await page.keyboard.press(key);
                }
                throw new Error(`${key} did not reach the target within ${limit} presses`);
            },
            shellMessages: () => page.evaluate(() => (window as any).__shellMessages ?? []),
        };

        await use(remote);

        const pointerInput = await page.evaluate(() => (window as any).__pointerInput).catch(() => []);
        expect(pointerInput, 'tests must use the keyboard only').toEqual([]);
    },
});

export { test, expect };
