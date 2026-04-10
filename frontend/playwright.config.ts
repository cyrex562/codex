import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false, // Run sequentially for better stability
    forbidOnly: !!process.env.CI,
    retries: process.env.CI ? 2 : 1,
    workers: 1, // Single worker to avoid conflicts
    reporter: 'list',
    use: {
        baseURL: 'http://localhost:8080',
        trace: 'on-first-retry',
        screenshot: 'only-on-failure',
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
