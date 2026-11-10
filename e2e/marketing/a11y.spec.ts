import { APK_URL, ORIGIN } from './urls';
import {
  assertHeadingStructure,
  assertNoHorizontalOverflow,
  expect,
  openSite,
  test,
} from './helpers';

test.describe('semantics, accessibility, and SEO', () => {
  test('uses valid landmarks, headings, ids, and accessible names', async ({ page }) => {
    await openSite(page);
    await assertHeadingStructure(page);

    expect(await page.locator('main').count()).toBe(1);
    await expect(page.locator('main')).toBeVisible();
    await expect(page.locator('header')).toBeVisible();
    await expect(page.locator('footer')).toBeVisible();

    const duplicateIds = await page.evaluate(() => {
      const counts = new Map<string, number>();
      for (const element of Array.from(document.querySelectorAll<HTMLElement>('[id]'))) {
        counts.set(element.id, (counts.get(element.id) ?? 0) + 1);
      }
      return [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
    });
    expect(duplicateIds, 'duplicate ids').toEqual([]);

    const brokenReferences = await page.evaluate(() => {
      const attributes = ['aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns'];
      const broken: string[] = [];
      for (const element of Array.from(document.querySelectorAll<HTMLElement>('*'))) {
        for (const attribute of attributes) {
          const value = element.getAttribute(attribute);
          if (!value) continue;
          for (const id of value.split(/\s+/).filter(Boolean)) {
            if (!document.getElementById(id)) broken.push(`${attribute}="${id}" on ${element.tagName.toLowerCase()}`);
          }
        }
      }
      return broken;
    });
    expect(brokenReferences, 'broken ARIA references').toEqual([]);

    const unnamed = await page.locator('a,button').evaluateAll((nodes) =>
      nodes
        .filter((node) => {
          const element = node as HTMLElement;
          const style = getComputedStyle(element);
          if (style.display === 'none' || style.visibility === 'hidden') return false;
          const label = element.getAttribute('aria-label')?.trim();
          const labelledBy = element.getAttribute('aria-labelledby');
          const labelledText = labelledBy
            ? labelledBy
                .split(/\s+/)
                .map((id) => document.getElementById(id)?.textContent ?? '')
                .join(' ')
                .trim()
            : '';
          const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim();
          const imageAlt = Array.from(element.querySelectorAll<HTMLImageElement>('img')).some(
            (image) => (image.getAttribute('alt') ?? '').trim().length > 0,
          );
          return !label && !labelledText && !text && !imageAlt;
        })
        .map((node) => `${node.tagName.toLowerCase()}#${(node as HTMLElement).id}`),
    );
    expect(unnamed, 'links or buttons without an accessible name').toEqual([]);

    const missingAlt = await page.locator('img').evaluateAll((images) =>
      images.filter((image) => !image.hasAttribute('alt')).map((image) => (image as HTMLImageElement).src),
    );
    expect(missingAlt, 'images without alt').toEqual([]);

    const hiddenFocusable = await page.evaluate(() => {
      const focusable = 'a[href],button,input,select,textarea,[tabindex]';
      return Array.from(document.querySelectorAll<HTMLElement>('[aria-hidden="true"]'))
        .flatMap((container) => Array.from(container.querySelectorAll<HTMLElement>(focusable)))
        .filter((element) => element.tabIndex >= 0 && !element.hasAttribute('hidden'))
        .map((element) => `${element.tagName.toLowerCase()}#${element.id}`);
    });
    expect(hiddenFocusable, 'focusable descendants of aria-hidden').toEqual([]);

    const unsafeNewTabs = await page.locator('a[target="_blank"]').evaluateAll((anchors) =>
      anchors
        .filter((anchor) => {
          const rel = (anchor.getAttribute('rel') ?? '').toLowerCase().split(/\s+/);
          return !rel.includes('noopener') && !rel.includes('noreferrer');
        })
        .map((anchor) => anchor.getAttribute('href') ?? ''),
    );
    expect(unsafeNewTabs, 'target=_blank without noopener/noreferrer').toEqual([]);
  });

  test('keyboard users can skip into the main content', async ({ page }) => {
    await openSite(page);
    const skip = page.locator('a.skip-link');
    await expect(skip).toHaveAttribute('href', '#main');
    await page.keyboard.press('Tab');
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#main$/);
  });

  test('publishes honest SEO metadata without an invented canonical origin', async ({ page }) => {
    await openSite(page);

    const seo = await page.evaluate(() => {
      const meta = (selector: string) => document.querySelector<HTMLMetaElement>(selector)?.content ?? '';
      const title = document.title.trim();
      const description = meta('meta[name="description"]');
      const ogImage = meta('meta[property="og:image"]');
      const canonical = document.querySelector<HTMLLinkElement>('link[rel="canonical"]')?.href ?? '';
      return {
        lang: document.documentElement.lang,
        title,
        description,
        viewport: meta('meta[name="viewport"]'),
        robots: meta('meta[name="robots"]'),
        ogTitle: meta('meta[property="og:title"]'),
        ogDescription: meta('meta[property="og:description"]'),
        ogType: meta('meta[property="og:type"]'),
        ogImage,
        twitterCard: meta('meta[name="twitter:card"]'),
        canonical,
      };
    });

    expect(seo.lang).toMatch(/^[a-z]{2}(-[A-Za-z0-9]+)*$/);
    expect(seo.title.length).toBeGreaterThanOrEqual(10);
    expect(seo.title.length).toBeLessThanOrEqual(80);
    expect(seo.description.length).toBeGreaterThanOrEqual(50);
    expect(seo.description.length).toBeLessThanOrEqual(220);
    expect(seo.viewport).toContain('width=device-width');
    expect(seo.robots.toLowerCase()).not.toContain('noindex');
    expect(seo.ogTitle.length).toBeGreaterThan(0);
    expect(seo.ogDescription.length).toBeGreaterThan(0);
    expect(seo.ogType).toBe('website');
    expect(seo.twitterCard).toMatch(/summary/);
    expect(seo.canonical === '' || new URL(seo.canonical, page.url()).origin === ORIGIN).toBe(true);

    expect(seo.ogImage).toBeTruthy();
    const socialCard = await page.request.get(new URL(seo.ogImage, page.url()).toString());
    expect(socialCard.status(), 'og:image').toBe(200);
    expect(socialCard.headers()['content-type']).toMatch(/^image\//);

    const structuredData = await page.locator('script[type="application/ld+json"]').allTextContents();
    expect(structuredData).toHaveLength(1);
    const json = JSON.parse(structuredData[0]) as Record<string, unknown>;
    expect(String(json['@context'])).toContain('schema.org');
    expect(json.softwareVersion).toBe('0.2.2');
    expect(json.downloadUrl).toBe(APK_URL);

    await assertNoHorizontalOverflow(page);
  });
});
