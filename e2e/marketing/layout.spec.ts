import { APK_URL } from './urls';
import {
  assertHeadingStructure,
  assertNoHorizontalOverflow,
  expect,
  openSite,
  test,
} from './helpers';

test.describe('static marketing layout', () => {
  test('paints a single visible heading hierarchy without horizontal overflow', async ({ page }) => {
    await openSite(page);
    await assertNoHorizontalOverflow(page);
    await assertHeadingStructure(page);
    await expect(page.locator('h1')).toBeVisible();
  });

  test('primary CTA is the exact v0.2.1 Android APK', async ({ page }) => {
    await openSite(page);
    const cta = page.locator('a#download-apk[data-cta="download"]');
    await expect(cta).toBeVisible();
    await expect(cta).toHaveAttribute('href', APK_URL);
    await expect(cta).toHaveAccessibleName(/0\.2\.1/);
    await expect(cta).toHaveAccessibleName(/android|apk/i);
    await expect(cta).toHaveAttribute('referrerpolicy', 'no-referrer');
  });

  test('every section anchor resolves and remains reachable', async ({ page }) => {
    await openSite(page);
    const broken = await page.evaluate(() => {
      const broken: string[] = [];
      for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'))) {
        const href = anchor.getAttribute('href') ?? '';
        if (href === '#' || href.startsWith('#!')) continue;
        const id = decodeURIComponent(href.slice(1));
        if (id && !document.getElementById(id)) broken.push(href);
      }
      return broken;
    });
    expect(broken, 'broken internal anchors').toEqual([]);

    const nav = page.locator('#site-nav');
    await expect(nav).toBeVisible();
    // Responsive CSS intentionally hides some section links on narrow
    // viewports. The remaining navigation must still be present and usable.
    expect(await nav.locator('a.nav-link:visible').count()).toBeGreaterThan(0);
    await expect(nav.locator('a[data-link="github"]')).toBeVisible();
  });
});
