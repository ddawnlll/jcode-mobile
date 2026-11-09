import { APK_URL } from './urls';
import { assertNoHorizontalOverflow, expect, test } from './helpers';

test.describe('no-JavaScript fallback', () => {
  test('the page is readable and the APK remains reachable', async ({ page }) => {
    const response = await page.goto('./', { waitUntil: 'load' });
    expect(response?.status()).toBe(200);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('#download-apk')).toBeVisible();
    await expect(page.locator('#download-apk')).toHaveAttribute('href', APK_URL);
    await expect(page.locator('#site-nav')).toBeVisible();
    await expect(page.locator('footer')).toBeVisible();
    await expect(page.locator('#scene-panel')).toBeVisible();

    const h2Count = await page.locator('h2').evaluateAll((headings) =>
      headings.filter((heading) => (heading as HTMLElement).getClientRects().length > 0).length,
    );
    expect(h2Count).toBeGreaterThanOrEqual(5);

    const mainText = (await page.locator('main').innerText()).replace(/\s+/g, ' ').trim();
    expect(mainText.length).toBeGreaterThan(1_000);

    // The page keeps its no-js class because the enhancement script never ran.
    await expect(page.locator('html')).toHaveClass(/no-js/);
    await assertNoHorizontalOverflow(page);
  });
});
