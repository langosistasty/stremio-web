// Stremio Big Picture: test fixtures. Tests drive the app with the keyboard only,
// offline, optionally inside a fake Stremio shell.
// SPDX-License-Identifier: GPL-2.0-only

import { test as base, expect, type Locator, type Page } from '@playwright/test';
import { serveCatalogs, type CatalogDelay } from './catalog';
import { serveAccount } from './account';

type ShellMessage = { type: number, args?: unknown[] };

type Options = {
    // Pretend to run inside the Stremio desktop shell (window.chrome.webview IPC).
    shell: boolean,
    // Delay catalog responses (milliseconds, for all or per "type/id"), like a slow network.
    catalogDelay: CatalogDelay,
    // Connect a fake standard-mapping gamepad (remote.pad drives it).
    gamepad: boolean,
    // Log in to a fake Stremio account with a library (see account.ts) on the first open.
    account: boolean,
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
    // Press a gamepad button (standard mapping number) for holdMs, or tilt the left stick.
    pad: (button: number | 'stick-left' | 'stick-right' | 'stick-up' | 'stick-down', holdMs?: number) => Promise<void>,
};

// Runs in the page before any app code. Counts real pointer input, so a test that
// touches the mouse fails, and optionally installs a fake shell that behaves like
// stremio-linux-shell: answers the handshake and echoes fullscreen changes.
const pageSetup = ({ shell, gamepad }: { shell: boolean, gamepad: boolean }) => {
    const w = window as any;
    if (gamepad) {
        const pad = {
            id: 'Test pad (STANDARD GAMEPAD)', index: 0, connected: true, mapping: 'standard', timestamp: 0,
            buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
            axes: [0, 0, 0, 0],
        };
        w.__pad = pad;
        Object.defineProperty(navigator, 'getGamepads', { value: () => [pad, null, null, null], configurable: true });
    }
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
    gamepad: [false, { option: true }],
    account: [false, { option: true }],
    remote: async ({ page, context, baseURL, shell, catalogDelay, gamepad, account }, use) => {
        // Offline: only the app's own files load. The Stremio API and the streaming
        // server are unreachable; the default addons answer from fixtures.
        await context.route('**/*', (route) => (
            route.request().url().startsWith(baseURL!) ? route.continue() : route.abort('blockedbyclient')
        ));
        // Registered later, so it takes precedence: the default addons answer from fixtures.
        await serveCatalogs(context, catalogDelay);
        if (account) await serveAccount(context);
        let signedIn = !account;
        await page.addInitScript(pageSetup, { shell, gamepad });

        const focused = () => page.locator(':focus');
        const remote: Remote = {
            page,
            open: async (route = '/', query = '') => {
                // A fresh load every time, like relaunching; a hash-only goto would not reload.
                await page.goto('about:blank');
                if (!signedIn) {
                    // Through the same core action Intro's log-in form dispatches.
                    await page.goto('');
                    await page.waitForFunction(() => (window as any).core);
                    await page.evaluate(() => (window as any).core.dispatch({
                        action: 'Ctx',
                        args: { action: 'Authenticate', args: { type: 'Login', email: 'tv@e2e.invalid', password: 'e2e' } },
                    }));
                    await page.waitForFunction(() => ((localStorage.getItem('library') ?? '') + (localStorage.getItem('library_recent') ?? '')).includes('ttlib'));
                    signedIn = true;
                    await page.goto('about:blank');
                }
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
                    // Upstream's view transition (outside Linux WebKit) must have finished too.
                    const transitioning = document.getAnimations().some((animation) => (
                        animation.playState === 'running' &&
                        ((animation.effect as KeyframeEffect | null)?.pseudoElement ?? '').startsWith('::view-transition')
                    ));
                    return !transitioning && !!view && !!active && active !== document.body && view.contains(active);
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
            pad: async (button, holdMs = 80) => {
                const set = (down: boolean) => page.evaluate(([button, down]) => {
                    const pad = (window as any).__pad;
                    const axes: Record<string, [number, number]> = {
                        'stick-left': [0, -1], 'stick-right': [0, 1], 'stick-up': [1, -1], 'stick-down': [1, 1],
                    };
                    if (typeof button === 'number') {
                        pad.buttons[button] = { pressed: down, touched: down, value: down ? 1 : 0 };
                    } else {
                        const [axis, value] = axes[button];
                        pad.axes[axis] = down ? value : 0;
                    }
                }, [button, down] as const);
                await set(true);
                await page.waitForTimeout(holdMs);
                await set(false);
                // Let the poller see the release before the next press.
                await page.waitForTimeout(50);
            },
        };

        await use(remote);

        const pointerInput = await page.evaluate(() => (window as any).__pointerInput).catch(() => []);
        expect(pointerInput, 'tests must use the keyboard only').toEqual([]);
    },
});

export type { Remote };
export { test, expect };
