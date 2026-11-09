import { expect, test, type Page } from '@playwright/test';

import { screenshot, trackPageErrors } from './helpers';
import { seedCredentials } from './seed';

async function clearCredentials(context: import('@playwright/test').BrowserContext) {
  await context.addInitScript(() => {
    try {
      window.localStorage.removeItem('jcode.e2e.credentials');
    } catch {
      // Nothing to clear.
    }
  });
}

async function waitForScene(page: Page) {
  await page.waitForFunction(
    () => Boolean((globalThis as Record<string, unknown>).__JCODE_WELCOME_SCENE__),
    undefined,
    { timeout: 30_000 },
  );
  return page.evaluate(
    () =>
      (globalThis as Record<string, unknown>).__JCODE_WELCOME_SCENE__ as {
        cols: number;
        rows: number;
        donutStart: number;
        donutEnd: number;
        titleMasked: boolean;
      },
  );
}

async function waitForSettled(page: Page) {
  await page.waitForFunction(
    () => {
      const perf = (globalThis as Record<string, unknown>).__JCODE_WELCOME_PERF__ as
        | { idleFrames: number; progress: number }
        | undefined;
      return Boolean(perf && (perf.idleFrames > 0 || perf.progress >= 1));
    },
    undefined,
    { timeout: 20_000 },
  );
  return page.evaluate(
    () =>
      (globalThis as Record<string, unknown>).__JCODE_WELCOME_PERF__ as {
        frames: number;
        openingFrames: number;
        idleFrames: number;
        worstFrameMs: number;
        progress: number;
        openingDurationMs: number | null;
        settledAt: number | null;
      },
  );
}

async function asciiText(page: Page): Promise<string> {
  return page.locator('[data-testid="welcome-ascii"]').innerText();
}

test.describe('animated ASCII welcome', () => {
  test.beforeEach(async ({ context }) => {
    await clearCredentials(context);
  });

  test('first unpaired launch reveals the donut and keeps a bounded idle turn', async ({
    page,
  }) => {
    const errors = trackPageErrors(page);
    await page.goto('/');

    await expect(page.getByTestId('welcome-skip')).toBeVisible({ timeout: 30_000 });
    const scene = await waitForScene(page);
    expect(scene.titleMasked).toBe(true);
    expect(scene.cols).toBeGreaterThanOrEqual(40);
    expect(scene.rows).toBeGreaterThanOrEqual(50);
    expect(scene.donutEnd).toBeGreaterThan(scene.donutStart);
    // The idle redraw band is a fraction of the full grid, not the whole screen.
    expect(scene.donutEnd - scene.donutStart).toBeLessThan(scene.rows * 0.6);

    const perf = await waitForSettled(page);
    expect(perf.openingDurationMs).not.toBeNull();
    expect(perf.openingDurationMs ?? 0).toBeGreaterThan(1_200);
    expect(perf.openingDurationMs ?? 0).toBeLessThan(4_000);
    expect(perf.openingFrames).toBeGreaterThan(4);
    expect(perf.idleFrames).toBeGreaterThan(0);

    await expect(page.getByRole('heading', { name: /Welcome to jcode/ })).toBeVisible();
    await expect(page.getByTestId('welcome-connect')).toBeVisible();
    await expect(page.getByTestId('welcome-preview')).toBeVisible();
    await expect(page.getByTestId('theme-tidal')).toBeVisible();
    await expect(page.getByTestId('appearance-system')).toBeVisible();

    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      layers: document.querySelector('[data-testid="welcome-ascii"]')?.children.length ?? 0,
    }));
    expect(layout.overflow).toBeLessThanOrEqual(0);
    expect(layout.layers).toBeLessThanOrEqual(6);

    // The settled donut keeps turning while the screen is focused.
    const before = await asciiText(page);
    await page.waitForTimeout(500);
    const after = await asciiText(page);
    expect(after).not.toBe(before);

    await screenshot(page, 'v021-welcome-settled');
    expect(errors).toEqual([]);
  });

  test('Skip finishes the opening, exposes the actions and starts the idle turn', async ({
    page,
  }) => {
    await page.goto('/');
    const skip = page.getByTestId('welcome-skip');
    await expect(skip).toBeVisible({ timeout: 30_000 });
    await skip.click();

    await expect(skip).toHaveCount(0);
    await expect(page.getByTestId('welcome-motion')).toBeVisible();
    await expect(page.getByRole('heading', { name: /Welcome to jcode/ })).toBeVisible();

    const opacity = await page.evaluate(() => {
      const heading = document.querySelector('[role="heading"]');
      const parent = heading?.closest('[style*="opacity"]');
      return parent ? getComputedStyle(parent).opacity : null;
    });
    expect(opacity === null ? '1' : opacity).toBe('1');

    const perf = await waitForSettled(page);
    expect(perf.progress).toBe(1);
    const before = await asciiText(page);
    await page.waitForTimeout(400);
    expect(await asciiText(page)).not.toBe(before);
  });

  test('Pause stops the idle turn and Play resumes it', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('welcome-skip')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('welcome-skip').click();
    await expect(page.getByTestId('welcome-motion')).toBeVisible();
    await waitForSettled(page);

    await page.getByTestId('welcome-motion').click();
    await expect(page.getByTestId('welcome-motion')).toHaveAccessibleName('Play animation');
    const pausedAt = await page.evaluate(
      () => ((globalThis as Record<string, unknown>).__JCODE_WELCOME_PERF__ as { frames: number }).frames,
    );
    await page.waitForTimeout(500);
    const stillPaused = await page.evaluate(
      () => ((globalThis as Record<string, unknown>).__JCODE_WELCOME_PERF__ as { frames: number }).frames,
    );
    expect(stillPaused - pausedAt).toBeLessThanOrEqual(1);

    await page.getByTestId('welcome-motion').click();
    await expect(page.getByTestId('welcome-motion')).toHaveAccessibleName('Pause animation');
    const resumedAt = await page.evaluate(
      () => ((globalThis as Record<string, unknown>).__JCODE_WELCOME_PERF__ as { frames: number }).frames,
    );
    await page.waitForTimeout(500);
    const resumed = await page.evaluate(
      () => ((globalThis as Record<string, unknown>).__JCODE_WELCOME_PERF__ as { frames: number }).frames,
    );
    expect(resumed - resumedAt).toBeGreaterThan(0);
  });

  test('a saved server keeps the Welcome route pointing at Sessions', async ({ page, context }) => {
    await seedCredentials(context);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your sessions' })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole('button', { name: 'App menu' }).click();
    await page.getByRole('button', { name: 'Appearance' }).click();
    await expect(page.getByTestId('appearance-screen')).toBeVisible();
    await page.getByRole('button', { name: 'Replay welcome' }).click();

    await expect(page.getByTestId('welcome-sessions')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('welcome-connect')).toHaveCount(0);
    await expect(page.getByTestId('welcome-preview')).toBeVisible();
    await page.getByTestId('welcome-sessions').click();
    await expect(page.getByRole('heading', { name: 'Your sessions' })).toBeVisible({
      timeout: 30_000,
    });
  });
});

test.describe('reduced motion welcome', () => {
  test.use({ reducedMotion: 'reduce' });

  test.beforeEach(async ({ context }) => {
    await clearCredentials(context);
  });

  test('paints one readable still frame and offers no motion control', async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /Welcome to jcode/ })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByTestId('welcome-connect')).toBeVisible();
    await expect(page.getByTestId('welcome-preview')).toBeVisible();
    await expect(page.getByTestId('welcome-skip')).toHaveCount(0);
    await expect(page.getByTestId('welcome-motion')).toHaveCount(0);

    const perf = await page.evaluate(
      () =>
        (globalThis as Record<string, unknown>).__JCODE_WELCOME_PERF__ as {
          openingFrames: number;
          idleFrames: number;
        },
    );
    expect(perf.openingFrames).toBe(0);
    expect(perf.idleFrames).toBeGreaterThan(0);

    const before = await asciiText(page);
    await page.waitForTimeout(600);
    expect(await asciiText(page)).toBe(before);

    await screenshot(page, 'v021-welcome-reduced-motion');
    expect(errors).toEqual([]);
  });
});

test.describe('short narrow welcome', () => {
  test.use({ viewport: { width: 320, height: 568 } });

  test.beforeEach(async ({ context }) => {
    await clearCredentials(context);
  });

  test('keeps the primary actions reachable without horizontal overflow', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByTestId('welcome-skip')).toBeVisible({ timeout: 30_000 });
    await page.getByTestId('welcome-skip').click();

    const connect = page.getByTestId('welcome-connect');
    await connect.scrollIntoViewIfNeeded();
    await expect(connect).toBeVisible();
    const box = await connect.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth))
      .toBeLessThanOrEqual(0);

    await connect.click();
    await expect(page.getByRole('heading', { name: 'Bring your server.' })).toBeVisible({
      timeout: 30_000,
    });
  });
});
