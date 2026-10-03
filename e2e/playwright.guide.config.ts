import { defineConfig, devices } from '@playwright/test';

/**
 * Regenerates the screenshots of docs/USER_GUIDE.md against a fresh, isolated stack:
 *   npm run docs:screenshots
 */
export default defineConfig({
  testDir: './guide',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 300_000,
  expect: { timeout: 15_000 },
  outputDir: './.results-guide',
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:18091',
    colorScheme: 'light',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'guide', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } }],
});
