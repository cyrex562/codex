import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/ui',
    fullyParallel: true,
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 0,
    workers: process.env.CI ? 1 : undefined,
    reporter: 'line',
    webServer: {
        command: 'npm run dev -- --host 127.0.0.1 --port 4173',
        url: 'http://127.0.0.1:4173',
        reuseExistingServer: !process.env.CI,
        timeout: 120_000,
    },
    use: {
        baseURL: 'http://127.0.0.1:4173',
        trace: 'on-first-retry',
    },
    projects: [
        {
            name: 'chromium',
            use: { ...devices['Desktop Chrome'] },
        },
        {
            name: 'firefox',
            use: { ...devices['Desktop Firefox'] },
        },
        // webkit approximates WebKitGTK 2.36 behaviour for logic testing.
        // Full WebKitGTK 2.36 gate runs in the webkit-compat CI job
        // (ubuntu-22.04 with WebKitGTK installed).
        {
            name: 'webkit',
            use: { ...devices['Desktop Safari'] },
        },
    ],
});
