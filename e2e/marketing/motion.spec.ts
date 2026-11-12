import { expect, openSite, test } from './helpers';

type MotionState = {
  ready?: boolean;
  gsap?: string | null;
  scrollTrigger?: boolean;
  framerMotion?: boolean;
  uiReady?: boolean;
  reduced?: boolean;
  scrollTriggerCount?: number;
  heroEntranceMs?: number;
};

async function motionState(page: import('@playwright/test').Page): Promise<MotionState> {
  return page.evaluate(() => (window as unknown as { __jcodeMotion?: MotionState }).__jcodeMotion ?? {});
}

async function waitForMotion(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const state = (window as unknown as { __jcodeMotion?: MotionState }).__jcodeMotion;
      return Boolean(state && state.ready && state.framerMotion && state.uiReady);
    },
    undefined,
    { timeout: 15_000 },
  );
  await expect(page.locator('html')).toHaveClass(/motion-enhanced/);
}

test.describe('bundled GSAP and Framer Motion', () => {
  test('both libraries load from the build and report an active scroll runtime', async ({ page }) => {
    const resources: string[] = [];
    page.on('request', (request) => resources.push(request.url()));
    await openSite(page);
    await waitForMotion(page);

    const state = await motionState(page);
    expect(state.gsap, 'GSAP version').toMatch(/^3\./);
    expect(state.scrollTrigger, 'ScrollTrigger registered').toBe(true);
    expect(state.framerMotion, 'Framer Motion island mounted').toBe(true);
    expect(state.scrollTriggerCount ?? 0, 'ScrollTrigger instances').toBeGreaterThan(0);
    expect(state.heroEntranceMs ?? 0, 'hero entrance budget').toBeGreaterThan(0);
    expect(state.heroEntranceMs ?? 0, 'hero entrance budget').toBeLessThanOrEqual(1_800);

    await expect(page.locator('[data-framer-motion="page-progress"]')).toHaveCount(1);
    await expect(page.locator('[data-framer-motion="scene-caption"]')).toHaveCount(1);
    await expect(page.locator('[data-framer-motion="scene-progress"]')).toHaveCount(1);

    const ownOrigin = new URL(page.url()).origin;
    const motionResources = resources.filter((raw) => /\/assets\/(motion|island|boot)-?[^/]*\.js$/.test(raw));
    expect(motionResources.length, 'motion bundle requests').toBeGreaterThanOrEqual(2);
    const remote = resources.filter((raw) => {
      try {
        return new URL(raw).origin !== ownOrigin;
      } catch {
        return false;
      }
    });
    expect(remote, 'remote runtime requests').toEqual([]);
  });

  test('scroll-linked transforms change while native scroll stays authoritative', async ({ page }) => {
    await openSite(page);
    await waitForMotion(page);
    await page.waitForTimeout(1_300);

    const atTop = await page.evaluate(() => {
      const plate = document.querySelector('.orbit-plate') as HTMLElement;
      const copy = document.querySelector('.hero-copy') as HTMLElement;
      return {
        plate: getComputedStyle(plate).transform,
        copy: getComputedStyle(copy).transform,
        scrollY: window.scrollY,
      };
    });

    await page.evaluate(() => window.scrollTo(0, Math.round(window.innerHeight * 0.72)));
    await page.waitForTimeout(700);

    const scrolled = await page.evaluate(() => {
      const plate = document.querySelector('.orbit-plate') as HTMLElement;
      const copy = document.querySelector('.hero-copy') as HTMLElement;
      return {
        plate: getComputedStyle(plate).transform,
        copy: getComputedStyle(copy).transform,
        scrollY: window.scrollY,
        documentWidth: document.documentElement.scrollWidth,
        viewportWidth: window.innerWidth,
      };
    });

    expect(scrolled.scrollY, 'native scroll position').toBeGreaterThan(atTop.scrollY);
    expect(scrolled.plate, 'plate transform responds to scroll').not.toBe(atTop.plate);
    expect(scrolled.copy, 'copy transform responds to scroll').not.toBe(atTop.copy);
    expect(scrolled.documentWidth).toBeLessThanOrEqual(scrolled.viewportWidth + 1);
  });

  test('the pinned continuity stage holds while the three states pass', async ({ page }) => {
    const width = page.viewportSize()?.width ?? 0;
    test.skip(width < 921, 'the pin is a desktop choreography; mobile keeps the sticky stage');

    await openSite(page);
    await waitForMotion(page);
    await expect(page.locator('html')).toHaveClass(/motion-pinned/);

    const gridTop = await page.locator('.narrative-grid').evaluate(
      (element) => element.getBoundingClientRect().top + window.scrollY,
    );
    await page.evaluate((top) => window.scrollTo(0, top - 72), gridTop);
    await page.waitForTimeout(450);

    const firstTop = await page.locator('.narrative-stage').evaluate(
      (element) => element.getBoundingClientRect().top,
    );
    await page.evaluate((top) => window.scrollTo(0, top + 620), gridTop);
    await page.waitForTimeout(450);
    const secondTop = await page.locator('.narrative-stage').evaluate(
      (element) => element.getBoundingClientRect().top,
    );

    expect(Math.abs(secondTop - firstTop), 'pinned stage top drift').toBeLessThan(6);
    await expect(page.locator('.narrative-stage')).toBeInViewport();

    await page.locator('#tab-away').click();
    await expect(page.locator('#tab-away')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.narrative-stage')).toHaveAttribute('data-scene', 'away');
    await expect(page.locator('.narrative-stage')).toBeInViewport();
  });

  test('AnimatePresence crossfades the scene panel without duplicating content', async ({ page }) => {
    await openSite(page);
    await waitForMotion(page);

    await expect(page.locator('.motion-scene-image')).toHaveCount(1);
    const fillsBefore = await page.locator('.scene-progress-fill').evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().width),
    );
    expect(fillsBefore[0], 'first rail segment is filled').toBeGreaterThan(1);
    expect(fillsBefore[2], 'third rail segment starts empty').toBe(0);

    await page.locator('#tab-return').click();

    await expect(page.locator('.motion-caption-text')).toContainText('source-backed');
    await expect
      .poll(() => page.locator('.motion-scene-image[data-scene-image="return"]').count())
      .toBe(1);
    await expect(page.locator('.motion-scene-image')).toHaveCount(1);
    await expect(page.locator('.motion-scene-image')).toHaveAttribute('data-scene-image', 'return');

    await expect
      .poll(() =>
        page
          .locator('.scene-progress-fill')
          .nth(2)
          .evaluate((node) => node.getBoundingClientRect().width),
      )
      .toBeGreaterThan(1);
    const fillsAfter = await page.locator('.scene-progress-fill').evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().width),
    );
    expect(fillsAfter[2], 'third rail segment fills after selection').toBeGreaterThan(1);

    const captions = await page.locator('#stage-caption-text').evaluate(
      (node) => getComputedStyle(node).display,
    );
    expect(captions, 'static fallback caption hidden after enhancement').toBe('none');
  });

  test('reduced motion keeps the frame still and the scene usable', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openSite(page);
    await waitForMotion(page);

    const state = await motionState(page);
    expect(state.reduced, 'reduced motion reported').toBe(true);
    expect(state.scrollTriggerCount, 'no ScrollTrigger work under reduced motion').toBe(0);
    await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
    await expect(page.locator('html')).not.toHaveClass(/motion-gsap/);

    const before = await page.locator('.orbit-plate').evaluate(
      (element) => getComputedStyle(element).transform,
    );
    await page.evaluate(() => window.scrollTo(0, Math.round(window.innerHeight * 0.8)));
    await page.waitForTimeout(500);
    const after = await page.locator('.orbit-plate').evaluate(
      (element) => getComputedStyle(element).transform,
    );
    expect(after, 'no scroll parallax under reduced motion').toBe(before);

    const longRunning = await page.evaluate(() =>
      document
        .getAnimations()
        .filter((animation) => {
          if (animation.playState !== 'running') return false;
          const timing = animation.effect?.getComputedTiming();
          return timing && Number(timing.duration) > 50;
        })
        .length,
    );
    expect(longRunning, 'running long CSS/WAAPI animations').toBe(0);

    await page.locator('#tab-away').click();
    await expect(page.locator('.motion-caption-text')).toContainText('Session scope');
    await expect(page.locator('.motion-scene-image')).toHaveAttribute('data-scene-image', 'away');
    await expect(page.locator('#download-apk')).toBeVisible();
  });
});
