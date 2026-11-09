import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:8091';

export default defineConfig({
  testDir: './e2e',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  outputDir: '.staging/e2e/results',
  reporter: [
    ['list'],
    ['html', { outputFolder: '.staging/e2e/report', open: 'never' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'iphone-14',
      // The iPhone descriptor defaults to WebKit. The Linux e2e target runs
      // Chromium with the same viewport, touch, and DPR profile.
      use: { ...devices['iPhone 14'], browserName: 'chromium' },
    },
    {
      // A narrow Android width exercises the same screens without repeating
      // the live session-writing flow.
      name: 'pixel-7',
      testMatch: /connect\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
  ],
});
