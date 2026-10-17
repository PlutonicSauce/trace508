import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120000,
  expect: { timeout: 20000 },
  workers: 1,
  use: {
    baseURL: process.env.TEST_BASE_URL ?? 'http://127.0.0.1:3000',
    headless: true,
    viewport: { width: 1440, height: 1000 },
    trace: process.env.TRACE508_TEST_TRACE === '1' ? 'retain-on-failure' : 'off',
  },
  reporter: [['list'], ['json', { outputFile: '.local/e2e-results.json' }]],
});
