// Playwright configuration for the Stillness 12 surface.
//
// The suite runs Chromium against the same web bundle through the Rust Adapter
// v2. It is browser coverage, not Android or iOS native verification. Desktop
// chromium uses the same build and exercises the rail/inspector layout.
import { defineConfig, devices } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configDir = path.dirname(fileURLToPath(import.meta.url));

const baseURL = process.env.STILLNESS_E2E_BASE_URL ?? 'http://127.0.0.1:7650';
const authFile = path.join(configDir, '.e2e-auth.json');

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 25_000 },
  outputDir: path.join(configDir, '.e2e-results'),
  reporter: [
    ['list'],
    ['html', { outputFolder: path.join(configDir, '.e2e-report'), open: 'never' }],
  ],
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    {
      name: 'pairing',
      testMatch: /pairing\.spec\.ts/,
      use: { ...devices['iPhone 14'], browserName: 'chromium' },
    },
    {
      name: 'mobile',
      testMatch: /stillness\.spec\.ts/,
      dependencies: ['pairing'],
      use: {
        ...devices['iPhone 14'],
        browserName: 'chromium',
        storageState: authFile,
      },
    },
    {
      name: 'desktop',
      testMatch: /(desktop|stillness)\.spec\.ts/,
      dependencies: ['pairing'],
      use: {
        ...devices['Desktop Chrome'],
        browserName: 'chromium',
        viewport: { width: 1280, height: 900 },
        storageState: authFile,
      },
    },
  ],
});
