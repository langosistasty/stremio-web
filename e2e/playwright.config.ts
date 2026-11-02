// Stremio Big Picture: Playwright configuration for the keyboard-only tests.
// SPDX-License-Identifier: GPL-2.0-only

import { defineConfig } from '@playwright/test';

const PORT = Number(process.env.E2E_PORT ?? 18471);
// The TV draws 1920x1080 at scale 1, as the doctor report from the TV PC showed.
const TV = { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 };

export default defineConfig({
    testDir: '.',
    testMatch: '**/*.e2e.ts',
    fullyParallel: true,
    // Each worker is a full browser running the app; more than this can exhaust the
    // memory of a laptop that is also running a desktop.
    workers: Number(process.env.E2E_WORKERS ?? 4),
    forbidOnly: !!process.env.CI,
    reporter: [['list']],
    use: {
        baseURL: `http://127.0.0.1:${PORT}/`,
        trace: 'retain-on-failure',
        ...TV,
    },
    projects: [
        // WebKit is the engine inside the Linux shell, so it is the one that matters most.
        // Playwright's WebKit calls itself Safari on macOS; the shell's WebKitGTK says Linux,
        // and upstream behaves differently there (no view transitions, for one).
        {
            name: 'webkit',
            use: {
                browserName: 'webkit',
                userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
            },
        },
        { name: 'chromium', use: { browserName: 'chromium' } },
    ],
    // The production build, served the way the TV serves it.
    webServer: {
        command: `python3 ../tv/serve.py ../build --port ${PORT}`,
        url: `http://127.0.0.1:${PORT}/`,
        reuseExistingServer: false,
    },
});
