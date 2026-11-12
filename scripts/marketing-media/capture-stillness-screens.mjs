#!/usr/bin/env node
/**
 * Capture the public v0.3.0 product images from a real Stillness build.
 *
 * The script expects an isolated Adapter v2 with a disposable data directory
 * and a fixed pairing code. It creates one real session on that isolated
 * harness, sends one real prompt, and captures the resulting UI. It never
 * touches a production adapter or daemon.
 *
 * Usage:
 *   APP_URL=http://127.0.0.1:7652 \
 *   PAIR_CODE=DEMO-0300-MAIN \
 *   node scripts/marketing-media/capture-stillness-screens.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:7652/';
const PAIR_CODE = process.env.PAIR_CODE ?? 'DEMO-0300-MAIN';
const OUT_DIR = resolve(process.env.OUT_DIR ?? 'docs/media/marketing');
const AUTH_FILE = resolve(
  process.env.AUTH_FILE ?? '.staging/marketing/playwright-auth.json',
);
const SESSION_TITLE = process.env.SESSION_TITLE ?? 'Release notes, from the train';
const PROMPT =
  process.env.PROMPT ??
  'In three plain sentences, explain why server-side execution matters when the phone disconnects. Do not use tools.';

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(resolve(AUTH_FILE, '..'), { recursive: true });

const browser = await chromium.launch({
  args: ['--font-render-hinting=none', '--hide-scrollbars'],
});

const phone = await browser.newContext({
  viewport: { width: 430, height: 900 },
  deviceScaleFactor: 2,
  colorScheme: 'light',
  reducedMotion: 'reduce',
  locale: 'en-US',
  timezoneId: 'UTC',
});

const page = await phone.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

async function shot(name) {
  await page.screenshot({ path: join(OUT_DIR, `${name}.png`), fullPage: false });
  console.log(`captured ${name}`);
}

async function openDrawer() {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
}

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
// Clear once, then reload. An init script would also clear the paired token
// on later navigations, which would make the desktop capture unauthenticated.
await page.evaluate(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByTestId('welcome-screen').waitFor({ timeout: 45_000 });
await page.waitForTimeout(700);
await shot('welcome-v030');

await page.getByTestId('start-pairing').click();
await page.getByTestId('pair-screen').waitFor();
await page.waitForTimeout(400);
await shot('pair-v030');

await page.getByTestId('pair-server').fill(APP_URL.replace(/\/$/, ''));
await page.getByTestId('pair-code').fill(PAIR_CODE);
await page.getByTestId('pair-device').fill('JCode Mobile');
await page.getByTestId('pair-submit').click();
await page.getByTestId('ready-screen').waitFor({ timeout: 60_000 });
await page.waitForTimeout(400);
await shot('pair-verified-v030');
await page.getByRole('button', { name: /Enter JCode/ }).click();
await page.getByTestId('home-screen').waitFor({ timeout: 45_000 });

// Create one clean real session. The prompt below is a real generation on the
// isolated harness; no transcript text is fabricated.
await page.getByTestId('new-session-button').click();
await page.getByTestId('new-session-screen').waitFor();
await page.getByRole('button', { name: /Personal chat/ }).click();
await page.getByLabel('Title (optional)').fill(SESSION_TITLE);
await page.getByTestId('create-session-submit').click();
await page.getByTestId('session-screen').waitFor({ timeout: 60_000 });
await page.getByTestId('session-title').getByText(SESSION_TITLE).waitFor();

await page.getByTestId('composer-input').fill(PROMPT);
await page.getByTestId('send-button').click();
await page
  .getByTestId('delivery-state')
  .filter({ hasText: /Accepted by agent|Sent to server/ })
  .waitFor({ timeout: 30_000 });
const assistant = page
  .locator('[data-testid="assistant-message"], [data-testid="live-assistant-message"]')
  .last();
await assistant.waitFor({ timeout: 120_000 });
await page.waitForFunction(
  () => {
    const nodes = document.querySelectorAll(
      '[data-testid="assistant-message"], [data-testid="live-assistant-message"]',
    );
    const last = nodes[nodes.length - 1];
    return (last?.textContent?.trim().length ?? 0) > 80;
  },
  undefined,
  { timeout: 120_000 },
);
await page.waitForTimeout(1_200);
await page.locator('.transcript-scroll').evaluate((element) => {
  element.scrollTop = element.scrollHeight;
});
await page.waitForTimeout(500);
await shot('session-v030');

await page.getByTestId('model-button').click();
await page.getByTestId('model-sheet').waitFor();
await page.waitForTimeout(400);
await shot('models-v030');
await page.getByTestId('model-sheet').getByRole('button', { name: 'Close' }).click();

// Capture the desktop shell while this live turn is still in the transcript.
// Reloading would replace the live answer with the adapter's persisted
// history, which currently exposes only the user side of the turn.
await page.setViewportSize({ width: 1280, height: 900 });
await page.waitForTimeout(800);
await page.locator('.transcript-scroll').evaluate((element) => {
  element.scrollTop = element.scrollHeight;
});
await page.waitForTimeout(400);
await shot('desktop-v030');
await page.setViewportSize({ width: 430, height: 900 });
await page.waitForTimeout(500);

await page.getByRole('button', { name: 'Back to sessions' }).click();
await page.getByTestId('sessions-screen').waitFor();
await openDrawer();
await page.locator('.drawer').getByRole('button', { name: 'Home' }).click();
await page.getByTestId('home-screen').waitFor();
await page.waitForTimeout(600);
await shot('home-v030');

await openDrawer();
await page.locator('.drawer').getByRole('button', { name: 'Settings' }).click();
await page.getByTestId('settings-screen').waitFor();
await page.waitForTimeout(400);
await shot('settings-v030');

await phone.storageState({ path: AUTH_FILE });

writeFileSync(
  join(OUT_DIR, 'capture.json'),
  `${JSON.stringify(
    {
      captured_at: new Date().toISOString(),
      app_url: APP_URL,
      session_title: SESSION_TITLE,
      prompt: PROMPT,
      viewport: { width: 430, height: 900 },
      desktop_viewport: { width: 1280, height: 900 },
      auth_file: AUTH_FILE.startsWith(`${resolve('.')}/`)
        ? AUTH_FILE.slice(resolve('.').length + 1)
        : 'outside-repository',
      errors,
    },
    null,
    2,
  )}\n`,
);

await browser.close();
if (errors.length > 0) process.exitCode = 1;
