import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
    // Every test file runs in its own process with a private in-memory SQLite database.
    pool: 'forks',
    env: {
      NODE_ENV: 'test',
      DATABASE_PATH: ':memory:',
      RATE_LIMIT_ENABLED: 'false',
      SETUP_CODE: 'TEST-SETUP-CODE',
      LOG_LEVEL: 'silent',
    },
    testTimeout: 20_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts', 'src/types/**'],
      reporter: ['text-summary', 'html'],
    },
  },
});
