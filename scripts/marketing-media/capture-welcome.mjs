#!/usr/bin/env node
/**
 * Capture the v0.2.1 ASCII welcome design reference as a bounded marketing GIF.
 *
 * This is intentionally NOT a capture of the shipping app. Issue #14 is still
 * open, so the reference lives on a design branch. The script reads it with
 * `git show` and never checks the branch out.
 *
 * The reference renders itself with requestAnimationFrame. We install a virtual
 * clock before the page boots, then advance exactly 50 ms per screenshot. That
 * produces a deterministic 20 fps sequence without frame drops, and the
 * rendering still comes from the reference's own paint() function.
 *
 * Outputs (under docs/media/marketing unless OUT_DIR is set):
 *   welcome-preview.gif
 *   welcome-poster.png
 *
 * Requirements: @playwright/test, ffmpeg, git.
 *
 * Usage:
 *   node scripts/marketing-media/capture-welcome.mjs
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { chromium } from '@playwright/test';

const ROOT = resolve(process.cwd());
const OUT_DIR = resolve(process.env.OUT_DIR ?? 'docs/media/marketing');
const WORK_DIR = resolve(process.env.WORK_DIR ?? '.staging/marketing');
const REF_PATH = 'docs/v0.2.1/JCode_Mobile_ASCII_Welcome.html';
const REF_REF = process.env.REF_REF ?? 'origin/design/v0.2.1-ascii-welcome';

const FPS = 20;
const STEP_MS = 1000 / FPS;
const DURATION_MS = 3000;
const FRAME_COUNT = Math.round(DURATION_MS / STEP_MS);
const POSTER_MS = 2800;
const WIDTH = 390;
const HEIGHT = 844;
const GIF_WIDTH = Number(process.env.GIF_WIDTH ?? 240);

mkdirSync(OUT_DIR, { recursive: true });
mkdirSync(WORK_DIR, { recursive: true });

const htmlPath = join(WORK_DIR, 'welcome-reference.html');
if (!existsSync(join(ROOT, 'docs/v0.2.1/JCode_Mobile_ASCII_Welcome.html'))) {
  let html;
  try {
    html = execFileSync('git', ['show', `${REF_REF}:${REF_PATH}`], {
      cwd: ROOT,
      encoding: 'buffer',
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    throw new Error(
      `Could not read ${REF_REF}:${REF_PATH}. Fetch the design ref or set REF_REF. ` +
        `This script never switches branches. (${error.message})`,
    );
  }
  writeFileSync(htmlPath, html);
} else {
  writeFileSync(
    htmlPath,
    execFileSync('git', ['show', `HEAD:${REF_PATH}`], { cwd: ROOT, encoding: 'buffer' }),
  );
}

const framesDir = join(WORK_DIR, 'welcome-frames');
rmSync(framesDir, { recursive: true, force: true });
mkdirSync(framesDir, { recursive: true });

/**
 * Freeze requestAnimationFrame and performance.now. The reference's own paint()
 * runs when we tick the clock; wall time cannot skip a frame.
 */
const clockScript = () => {
  let vnow = 0;
  let nextId = 1;
  const pending = new Map();
  Object.defineProperty(performance, 'now', { value: () => vnow });
  window.requestAnimationFrame = (callback) => {
    const id = nextId++;
    pending.set(id, callback);
    return id;
  };
  window.cancelAnimationFrame = (id) => {
    pending.delete(id);
  };
  window.__marketingTick = (ms) => {
    vnow += ms;
    const callbacks = [...pending.values()];
    pending.clear();
    for (const callback of callbacks) callback(vnow);
    return vnow;
  };
  window.__marketingPending = () => pending.size;
  window.__marketingNow = () => vnow;
};

const labelScript = () => {
  const app = document.querySelector('.app');
  if (!app) throw new Error('Welcome reference root was not found.');
  const controls = document.querySelector('.motion-controls');
  if (controls) controls.style.display = 'none';
  const label = document.createElement('div');
  label.textContent = 'v0.2.1 DESIGN PREVIEW';
  label.setAttribute('data-marketing-label', 'v0.2.1-design-preview');
  label.style.cssText = [
    'position:absolute',
    'top:18px',
    'right:20px',
    'z-index:6',
    'font:500 14px/1 "Welcome Mono", ui-monospace, monospace',
    'letter-spacing:.1em',
    'color:#A0B6AD',
    'opacity:.86',
    'white-space:nowrap',
    'pointer-events:none',
  ].join(';');
  app.appendChild(label);
};

async function prepare(width, height, scale) {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width, height },
    deviceScaleFactor: scale,
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    locale: 'en-US',
  });
  await context.addInitScript(clockScript);
  const page = await context.newPage();
  await page.goto(`file://${htmlPath}`, { waitUntil: 'load' });
  await page.waitForFunction(
    () =>
      document.fonts.status === 'loaded' &&
      document.querySelector('.app')?.dataset.ready === 'true',
    undefined,
    { timeout: 30_000 },
  );
  // Allow the font-ready relayout microtask to finish before the first tick.
  await page.waitForTimeout(250);
  await page.evaluate(labelScript);
  // Replay from zero after fonts and layout are settled.
  await page.evaluate(() => {
    document.getElementById('replay')?.click();
  });
  return { browser, page };
}

const capture = await prepare(WIDTH, HEIGHT, 1);
for (let index = 0; index < FRAME_COUNT; index += 1) {
  await capture.page.evaluate((step) => window.__marketingTick(step), STEP_MS);
  await capture.page.screenshot({
    path: join(framesDir, `frame-${String(index).padStart(3, '0')}.png`),
  });
  if (index % 16 === 0) {
    console.log(`captured welcome frame ${index + 1}/${FRAME_COUNT}`);
  }
}
await capture.browser.close();

const poster = await prepare(WIDTH, HEIGHT, 2);
for (let elapsed = 0; elapsed < POSTER_MS; elapsed += STEP_MS) {
  await poster.page.evaluate((step) => window.__marketingTick(step), STEP_MS);
}
await poster.page.screenshot({
  path: join(OUT_DIR, 'welcome-poster.png'),
});
await poster.browser.close();

const palettePath = join(WORK_DIR, 'welcome-palette.png');
const gifPath = join(OUT_DIR, 'welcome-preview.gif');
const scaleFilter = `scale=${GIF_WIDTH}:-1:flags=lanczos`;
execFileSync(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-framerate',
    String(FPS),
    '-i',
    join(framesDir, 'frame-%03d.png'),
    '-vf',
    `${scaleFilter},palettegen=stats_mode=diff:max_colors=48`,
    palettePath,
  ],
  { stdio: 'inherit' },
);
execFileSync(
  'ffmpeg',
  [
    '-hide_banner',
    '-loglevel',
    'error',
    '-y',
    '-framerate',
    String(FPS),
    '-i',
    join(framesDir, 'frame-%03d.png'),
    '-i',
    palettePath,
    '-lavfi',
    `${scaleFilter}[scaled];[scaled][1:v]paletteuse=dither=none:diff_mode=rectangle`,
    '-gifflags',
    '+transdiff',
    '-loop',
    '0',
    gifPath,
  ],
  { stdio: 'inherit' },
);

// ffmpeg writes complete frames. ImageMagick's transparency optimizer keeps
// the same 20 fps timeline but shrinks the inter-frame payload substantially.
const optimizedPath = join(WORK_DIR, 'welcome-preview-optimized.gif');
execFileSync('magick', [gifPath, '-layers', 'Optimize', optimizedPath], { stdio: 'inherit' });
renameSync(optimizedPath, gifPath);

writeFileSync(
  join(WORK_DIR, 'welcome-capture.json'),
  JSON.stringify(
    {
      source: `${REF_REF}:${REF_PATH}`,
      sourceKind: 'v0.2.1 ASCII welcome design reference; issue #14 open',
      label: 'v0.2.1 DESIGN PREVIEW',
      fps: FPS,
      frameCount: FRAME_COUNT,
      durationMs: FRAME_COUNT * STEP_MS,
      captureViewport: { width: WIDTH, height: HEIGHT },
      gifWidth: GIF_WIDTH,
      posterAtMs: POSTER_MS,
    },
    null,
    2,
  ),
);
console.log(`wrote ${gifPath} and ${join(OUT_DIR, 'welcome-poster.png')}`);
