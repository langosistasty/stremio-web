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
    forbidOnly: !!process.env.CI,
    reporter: [['list']],
    use: {
        baseURL: `http://127.0.0.1:${PORT}/`,
        trace: 'retain-on-failure',
        ...TV,
    },
    projects: [
        // WebKit is the engine inside the Linux shell, so it is the one that matters most.
        { name: 'webkit', use: { browserName: 'webkit' } },
        { name: 'chromium', use: { browserName: 'chromium' } },
    ],
    // The production build, served the way the TV serves it.
    webServer: {
        command: `python3 ../tv/serve.py ../build --port ${PORT}`,
        url: `http://127.0.0.1:${PORT}/`,
        reuseExistingServer: false,
    },
});
