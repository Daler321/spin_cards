import { defineConfig, devices } from '@playwright/test';

/**
 * Smoke tests of the Mini App in a phone-sized browser (`make e2e`). They run against the dev
 * stack through the proxy and sign in with the dev mock login (VITE_DEV_AUTH + DEV_AUTH_BYPASS).
 */
export default defineConfig({
  testDir: '.',
  outputDir: '../e2e-results',
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://proxy',
    locale: 'ru-RU',
    screenshot: 'only-on-failure',
    trace: 'retain-on-failure',
  },
  projects: [{ name: 'phone', use: { ...devices['Pixel 7'] } }],
});
