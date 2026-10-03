import { defineConfig, devices } from '@playwright/test';

/**
 * End-to-end tests drive the real Docker stack in a browser. `npm run e2e` (see run.mjs)
 * starts an isolated stack on port 18090 with a fresh database, runs the specs in order
 * (onboarding first) and tears it down again.
 */
export default defineConfig({
  testDir: './tests',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 10_000 },
  outputDir: './.results',
  reporter: [['list'], ['html', { open: 'never', outputFolder: './.report' }]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:18090',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    viewport: { width: 1440, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
