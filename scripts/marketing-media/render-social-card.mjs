#!/usr/bin/env node
/**
 * Render the 1200 x 630 social card from the committed 0.3.1 composition.
 *
 * Usage:
 *   node scripts/marketing-media/render-social-card.mjs
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(process.cwd());
const OUT_DIR = resolve(process.env.OUT_DIR ?? 'website/assets');
const SOURCE = join(ROOT, 'scripts/marketing-media/social-card.html');
const OUTPUT = join(OUT_DIR, 'social-card.png');

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1200, height: 630 },
  deviceScaleFactor: 2,
  colorScheme: 'dark',
  reducedMotion: 'reduce',
});
await page.goto(pathToFileURL(SOURCE).href, { waitUntil: 'load' });
await page.evaluate(async () => {
  await document.fonts.ready;
  await Promise.all(
    [...document.images].map((image) =>
      image.complete
        ? Promise.resolve()
        : new Promise((resolve) => {
            image.addEventListener('load', resolve, { once: true });
            image.addEventListener('error', resolve, { once: true });
          }),
    ),
  );
});
await page.waitForTimeout(250);
await page.screenshot({ path: OUTPUT, fullPage: false });
await browser.close();
console.log(`wrote ${OUTPUT}`);
