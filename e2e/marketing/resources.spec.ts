import { APK_URL } from './urls';
import { brokenInternalAnchors, expect, localOnlyRequests, openSite, test } from './helpers';

test.describe('self-contained resources', () => {
  test('loads only local runtime resources and no broken requests', async ({ page }) => {
    const { external, failed } = await localOnlyRequests(page);
    expect(failed, 'failed requests').toEqual([]);
    expect(external, 'external runtime requests').toEqual([]);
  });

  test('loads every local image and custom font', async ({ page }) => {
    await openSite(page);
    await page.evaluate(async () => {
      for (const image of Array.from(document.images)) image.loading = 'eager';
      await Promise.all(
        Array.from(document.images).map(
          (image) =>
            new Promise<void>((resolve) => {
              if (image.complete) {
                resolve();
                return;
              }
              image.addEventListener('load', () => resolve(), { once: true });
              image.addEventListener('error', () => resolve(), { once: true });
              setTimeout(resolve, 5_000);
            }),
        ),
      );
    });

    const brokenImages = await page.locator('img').evaluateAll((images) =>
      images
        .filter((image) => {
          const element = image as HTMLImageElement;
          return !element.complete || element.naturalWidth === 0;
        })
        .map((image) => (image as HTMLImageElement).currentSrc || (image as HTMLImageElement).src),
    );
    expect(brokenImages, 'broken images').toEqual([]);

    const missingAlt = await page.locator('img').evaluateAll((images) =>
      images.filter((image) => !image.hasAttribute('alt')).map((image) => (image as HTMLImageElement).src),
    );
    expect(missingAlt, 'images without an alt attribute').toEqual([]);

    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      return {
        size: document.fonts.size,
        status: document.fonts.status,
        faces: Array.from(document.fonts).map((face) => ({
          family: face.family,
          status: face.status,
          weight: face.weight,
        })),
      };
    });
    expect(fonts.size, 'declared custom font faces').toBeGreaterThan(0);
    expect(fonts.status).toBe('loaded');
    // A declared face may remain unloaded until a matching weight is used.
    // At least the faces the page renders must have completed.
    expect(fonts.faces.filter((face) => face.status === 'loaded').length, 'loaded font faces').toBeGreaterThan(0);

    const families = await page.evaluate(() => {
      const heading = getComputedStyle(document.querySelector('h1') as HTMLElement).fontFamily;
      const body = getComputedStyle(document.body).fontFamily;
      return { heading, body };
    });
    expect(families.heading.toLowerCase()).toMatch(/bricolage|hanken|plex/);
    expect(families.body.toLowerCase()).toMatch(/bricolage|hanken|plex|sans-serif/);
  });

  test('keeps the CTA and internal anchors valid', async ({ page }) => {
    await openSite(page);
    const cta = page.locator('#download-apk');
    await expect(cta).toHaveAttribute('href', APK_URL);
    expect(await brokenInternalAnchors(page), 'broken internal anchors').toEqual([]);

    const localLinks = await page.locator('a[href]').evaluateAll((anchors) =>
      anchors
        .map((anchor) => anchor.getAttribute('href') ?? '')
        .filter((href) => href && !href.startsWith('#') && !/^(mailto:|tel:|https?:)/i.test(href)),
    );
    for (const href of localLinks) {
      const response = await page.request.get(new URL(href, page.url()).toString());
      expect(response.status(), href).toBeLessThan(400);
    }
  });
});
