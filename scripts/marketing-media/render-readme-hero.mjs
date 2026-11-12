#!/usr/bin/env node
/**
 * Render the README hero from the committed HTML composition.
 *
 * The composition is typography, rules, and the real v0.3.0 home and session
 * captures. It does not draw app UI.
 *
 * Usage:
 *   node scripts/marketing-media/render-readme-hero.mjs
 */
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from '@playwright/test';

const ROOT = resolve(process.cwd());
const OUT_DIR = resolve(process.env.OUT_DIR ?? 'docs/media/marketing');
const SOURCE = join(ROOT, 'scripts/marketing-media/readme-hero.html');
const OUTPUT = join(OUT_DIR, 'readme-hero.png');

mkdirSync(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 900 },
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
