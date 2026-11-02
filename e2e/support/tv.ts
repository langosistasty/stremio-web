// Stremio Big Picture: test fixtures. Tests drive the app with the keyboard only,
// offline, optionally inside a fake Stremio shell.
// SPDX-License-Identifier: GPL-2.0-only

import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { serveCatalogs, type CatalogDelay } from './catalog';

type ShellMessage = { type: number, args?: unknown[] };

type Options = {
    // Pretend to run inside the Stremio desktop shell (window.chrome.webview IPC).
    shell: boolean,
    // Delay catalog responses (milliseconds, for all or per "type/id"), like a slow network.
    catalogDelay: CatalogDelay,
};

type Remote = {
    page: Page,
    // Launch the app. `query` goes before the hash, like a launcher's --url.
    open: (route?: string, query?: string) => Promise<void>,
    press: (key: string, times?: number) => Promise<void>,
    // For keys a keyboard can't type here (BrowserBack, media keys): dispatched to the
    // focused element, as a remote's driver would deliver them.
    sendKey: (key: string) => Promise<void>,
    focused: () => Locator,
    // The route on screen; lower routes stay mounted but hidden.
    view: () => Locator,
    // Wait until a navigation has finished: the URL matches and focus is in the new view.
    // Keys pressed sooner than any person could race upstream's own redirects and transitions.
    arrived: (url: RegExp) => Promise<void>,
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
    catalogDelay: [0, { option: true }],
    remote: async ({ page, context, baseURL, shell, catalogDelay }, use) => {
        // Offline: only the app's own files load. The Stremio API and the streaming
        // server are unreachable; the default addons answer from fixtures.
        await context.route('**/*', (route) => (
            route.request().url().startsWith(baseURL!) ? route.continue() : route.abort('blockedbyclient')
        ));
        // Registered later, so it takes precedence: the default addons answer from fixtures.
        await serveCatalogs(context, catalogDelay);
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
            sendKey: async (key) => {
                await page.evaluate((key) => {
                    const target = document.activeElement ?? document.body;
                    const init = { key, code: key, bubbles: true, cancelable: true };
                    target.dispatchEvent(new KeyboardEvent('keydown', init));
                    target.dispatchEvent(new KeyboardEvent('keyup', init));
                }, key);
            },
            focused,
            view: () => page.locator('.routes-container > .route-container').last(),
            arrived: async (url) => {
                await expect(page).toHaveURL(url);
                await expect.poll(() => page.evaluate(() => {
                    const view = document.querySelector('.routes-container')?.lastElementChild;
                    const active = document.activeElement;
                    return !!view && !!active && active !== document.body && view.contains(active);
                })).toBe(true);
            },
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
