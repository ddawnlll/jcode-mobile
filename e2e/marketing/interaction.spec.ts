import {
  canvasStates,
  expect,
  openSite,
  orbitCanvases,
  sceneTabs,
  selectedScene,
  selectedSceneTab,
  test,
} from './helpers';

test.describe('interactive continuity specimen', () => {
  test('scene tabs support keyboard selection and a visible selected state', async ({ page }) => {
    await openSite(page);
    const tabs = sceneTabs(page);
    await expect(tabs).toHaveCount(3);
    await expect(selectedSceneTab(page)).toHaveCount(1);

    const initial = await selectedScene(page);
    expect(initial).toBeTruthy();
    const initialId = await selectedSceneTab(page).getAttribute('id');
    expect(initialId).toBeTruthy();

    const selected = page.locator(`#scene-tabs [role="tab"][data-scene="${initial}"]`);
    await selected.focus();
    await page.keyboard.press('ArrowRight');

    const focused = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement | null;
      return { id: active?.id ?? '', scene: active?.getAttribute('data-scene') ?? '' };
    });
    expect(focused.id, 'focus moves with ArrowRight').not.toBe(initialId);
    expect(focused.scene).not.toBe(initial);

    // Manual activation and automatic activation are both valid ARIA tab
    // patterns, so press Enter and then require the focused tab to own the
    // selected state.
    await page.keyboard.press('Enter');
    expect(await selectedScene(page)).toBe(focused.scene);
    await expect(page.locator('#scene-panel')).toHaveAttribute('aria-labelledby', focused.id);
    await expect(page.locator('.narrative-stage')).toHaveAttribute('data-scene', focused.scene);
    await expect(page.locator(`.scene-image[data-scene-image="${focused.scene}"]`)).toHaveClass(/is-active/);

    const ring = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement;
      const style = getComputedStyle(element);
      return {
        outlineStyle: style.outlineStyle,
        outlineWidth: style.outlineWidth,
        boxShadow: style.boxShadow,
      };
    });
    const hasVisibleFocus =
      (ring.outlineStyle !== 'none' && Number.parseFloat(ring.outlineWidth) > 0) ||
      (ring.boxShadow !== 'none' && ring.boxShadow.trim().length > 0);
    expect(hasVisibleFocus, JSON.stringify(ring)).toBe(true);

    await page.keyboard.press('Home');
    await page.keyboard.press('Enter');
    expect(await selectedScene(page)).toBe('send');
    await page.keyboard.press('End');
    await page.keyboard.press('Enter');
    expect(await selectedScene(page)).toBe('return');

    const tabStops = await tabs.evaluateAll((nodes) =>
      nodes.map((node) => node.getAttribute('tabindex') ?? 'missing'),
    );
    expect(tabStops.filter((value) => value === '0')).toHaveLength(1);
    expect(tabStops.filter((value) => value === '-1')).toHaveLength(2);
  });

  test('motion toggle pauses and resumes both orbit canvases', async ({ page }) => {
    await openSite(page);
    const canvases = orbitCanvases(page);
    await expect(canvases).toHaveCount(2);
    const hero = page.locator('#hero-orbit');
    await expect.poll(() => hero.getAttribute('data-canvas-state')).toBe('running');

    const toggle = page.locator('#motion-toggle');
    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveAccessibleName(/pause/i);

    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(toggle).toHaveAccessibleName(/play/i);
    await expect.poll(() => hero.getAttribute('data-canvas-state')).toBe('paused');
    await expect(page.locator('#motion-status')).toContainText(/paus/i);

    await toggle.focus();
    await page.keyboard.press('Space');
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(toggle).toHaveAccessibleName(/pause/i);
    await expect.poll(() => hero.getAttribute('data-canvas-state')).toBe('running');
  });

  test('orbit canvases pause when offscreen and while the page is hidden', async ({ page }) => {
    await openSite(page);
    const canvases = orbitCanvases(page);
    await expect(canvases).toHaveCount(2);
    const hero = page.locator('#hero-orbit');
    const stage = page.locator('#orbit-canvas');
    await expect.poll(() => hero.getAttribute('data-canvas-state')).toBe('running');
    // The stage canvas starts below the fold, so the observer must already be
    // holding it paused before any test interaction.
    await expect.poll(() => stage.getAttribute('data-canvas-state')).toBe('paused');

    for (const id of ['hero-orbit', 'orbit-canvas']) {
      const canvas = page.locator(`#${id}`);
      await canvas.scrollIntoViewIfNeeded();
      await expect.poll(() => canvas.getAttribute('data-canvas-state')).toBe('running');

      await page.evaluate((canvasId) => {
        const element = document.getElementById(canvasId);
        if (!element) throw new Error(`missing canvas ${canvasId}`);
        const absoluteTop = element.getBoundingClientRect().top + window.scrollY;
        const maxScroll = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        const midpoint = document.documentElement.scrollHeight / 2;
        window.scrollTo(0, absoluteTop < midpoint ? maxScroll : 0);
      }, id);
      await expect
        .poll(() => canvas.getAttribute('data-canvas-state'), { timeout: 5_000 })
        .toBe('paused');

      await canvas.scrollIntoViewIfNeeded();
      await expect.poll(() => canvas.getAttribute('data-canvas-state'), { timeout: 5_000 }).toBe('running');
    }

    await hero.scrollIntoViewIfNeeded();
    await expect.poll(() => hero.getAttribute('data-canvas-state')).toBe('running');
    await page.evaluate(() => {
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => hero.getAttribute('data-canvas-state'), { timeout: 5_000 }).toBe('paused');

    await page.evaluate(() => {
      Reflect.deleteProperty(document, 'hidden');
      Reflect.deleteProperty(document, 'visibilityState');
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('visibilitychange'));
    });
    await expect.poll(() => hero.getAttribute('data-canvas-state'), { timeout: 5_000 }).toBe('running');
  });

  test('reduced motion stops ambient animation and keeps content readable', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await openSite(page);

    expect(
      await page.evaluate(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches),
    ).toBe(true);

    const longRunningAnimations = await page.evaluate(() => {
      return document
        .getAnimations()
        .filter((animation) => {
          if (animation.playState !== 'running') return false;
          const timing = animation.effect?.getComputedTiming();
          return timing && Number(timing.duration) > 50;
        })
        .map((animation) => ({
          name: (animation as CSSAnimation).animationName ?? animation.constructor.name,
          duration: Number(animation.effect?.getComputedTiming().duration ?? 0),
        }));
    });
    expect(longRunningAnimations, 'running CSS animations under reduced motion').toEqual([]);

    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('#download-apk')).toBeVisible();
    await expect.poll(() => canvasStates(page)).toEqual(['paused', 'paused']);
  });
});
