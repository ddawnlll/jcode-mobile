import { join } from 'node:path';
import { defineConfig } from '@playwright/test';
import { BASE_PATH, BASE_URL, E2E_HOST, E2E_PORT, MARKETING_OUT_DIR, REPO_ROOT } from './urls';

const bun = process.execPath;
const buildScript = join(REPO_ROOT, 'scripts/marketing/build.mjs');
const serveScript = join(REPO_ROOT, 'scripts/marketing/serve.mjs');
const siteDir = process.env.MARKETING_SOURCE_DIR ?? join(REPO_ROOT, 'website');
const outDir = MARKETING_OUT_DIR;

const siteSpecs = /(layout|resources|interaction|a11y)\.spec\.ts/;

export default defineConfig({
  testDir: '.',
  testMatch: /.*\.spec\.ts/,
  fullyParallel: true,
  workers: 2,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  outputDir: join(REPO_ROOT, '.staging/marketing/results'),
  reporter: [
    ['list'],
    ['html', { outputFolder: join(REPO_ROOT, '.staging/marketing/report'), open: 'never' }],
  ],
  use: {
    baseURL: BASE_URL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: {
    command: [
      `"${bun}" "${buildScript}" --source "${siteDir}" --out "${outDir}" --quiet`,
      `"${bun}" "${serveScript}" --dir "${outDir}" --host ${E2E_HOST} --port ${E2E_PORT} --base-path ${BASE_PATH}`,
    ].join(' && '),
    url: BASE_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
  projects: [
    {
      name: 'site-320',
      testMatch: siteSpecs,
      use: {
        browserName: 'chromium',
        viewport: { width: 320, height: 720 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'site-390',
      testMatch: siteSpecs,
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
      },
    },
    {
      name: 'site-768',
      testMatch: siteSpecs,
      use: {
        browserName: 'chromium',
        viewport: { width: 768, height: 1024 },
        deviceScaleFactor: 1,
        hasTouch: true,
      },
    },
    {
      name: 'site-1440',
      testMatch: siteSpecs,
      use: {
        browserName: 'chromium',
        viewport: { width: 1440, height: 900 },
        deviceScaleFactor: 1,
      },
    },
    {
      name: 'no-js-390',
      testMatch: /no-js\.spec\.ts/,
      use: {
        browserName: 'chromium',
        viewport: { width: 390, height: 844 },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        javaScriptEnabled: false,
      },
    },
    {
      name: 'server',
      testMatch: /server\.spec\.ts/,
      use: { browserName: 'chromium' },
    },
  ],
});
