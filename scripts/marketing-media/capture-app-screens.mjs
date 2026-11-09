#!/usr/bin/env node
/**
 * Capture real v0.2.0 app surfaces for README and website marketing.
 *
 * Requirements:
 *   - a local static build of the app on APP_URL (default 127.0.0.1:8092)
 *   - no pairing, adapter, daemon, or provider credentials
 *
 * The only data shown is the app's own labelled Preview sample data. The
 * script clears browser storage first so a paired profile can never leak in.
 *
 * Usage:
 *   node scripts/marketing-media/capture-app-screens.mjs
 *   APP_URL=http://127.0.0.1:8092 OUT_DIR=.staging/marketing/shots \
 *     node scripts/marketing-media/capture-app-screens.mjs
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const APP_URL = process.env.APP_URL ?? 'http://127.0.0.1:8092/';
const OUT_DIR = resolve(process.env.OUT_DIR ?? '.staging/marketing/shots');
const VIEWPORT = { width: 430, height: 900 };

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: VIEWPORT,
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  reducedMotion: 'reduce',
  locale: 'en-US',
  timezoneId: 'UTC',
});

await context.addInitScript(() => {
  try {
    window.localStorage.clear();
    window.sessionStorage.clear();
  } catch {
    // Storage may be blocked; the app still boots into Welcome.
  }
});

const page = await context.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`);
});

async function shot(name) {
  await page.screenshot({ path: join(OUT_DIR, `${name}.png`), fullPage: false });
  console.log(`captured ${name}`);
}

await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: /Your work\./ }).waitFor({ timeout: 45_000 });
await page.waitForTimeout(600);
await shot('welcome');

await page.getByTestId('welcome-preview').click();
await page.getByRole('heading', { name: 'Your sessions' }).waitFor({ timeout: 30_000 });
await page.getByTestId('preview-banner').waitFor();
await page.waitForTimeout(500);
await shot('sessions-v020');

await page
  .locator('[data-testid^="session-"]')
  .filter({ hasText: 'Reconnect path review' })
  .first()
  .click();
await page.getByTestId('assistant-message-1').waitFor({ timeout: 30_000 });
await page.getByTestId('markdown-table').waitFor({ timeout: 30_000 });
// Bring the rich assistant answer (table, quote, math) into the visible
// conversation viewport without changing any app state.
await page.evaluate(() => {
  const block = document.querySelector('[data-testid="assistant-message-1"]');
  const scroller = block?.parentElement?.parentElement?.parentElement;
  if (scroller) scroller.scrollTop = 850;
});
await page.waitForTimeout(700);
await shot('conversation-v020');

await page.getByRole('button', { name: /Open session work/ }).click();
await page.getByRole('heading', { name: 'Session work' }).waitFor({ timeout: 30_000 });
await page.waitForTimeout(500);
await shot('work-v020');

// The connection setup is a real screen with no server contact. Reload to a
// clean first-run state so Preview state cannot leak into it.
await page.goto(APP_URL, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: /Your work\./ }).waitFor({ timeout: 45_000 });
await page.getByTestId('welcome-connect').click();
await page.getByRole('heading', { name: 'Bring your server.' }).waitFor({ timeout: 30_000 });
await page.waitForTimeout(500);
await shot('connect-v020');

const summary = await page.evaluate(() => ({
  title: document.title,
  theme: document.documentElement.dataset.theme ?? null,
  storedKeys: Object.keys(localStorage),
}));
console.log(JSON.stringify({ out: OUT_DIR, viewport: VIEWPORT, ...summary, errors }, null, 2));

await browser.close();
if (errors.length > 0) process.exitCode = 1;
