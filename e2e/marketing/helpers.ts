import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test as base, type Locator, type Page } from '@playwright/test';
import { BASE_PATH, MARKETING_OUT_DIR, ORIGIN } from './urls';

type MarketingFixtures = { pageErrors: string[] };

/**
 * Every site test insists on a clean browser console and no uncaught page
 * errors. A static marketing page has no acceptable runtime exception.
 */
export const test = base.extend<MarketingFixtures>({
  pageErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(`console.error: ${message.text()}`);
      });
      await use(errors);
      expect(errors, 'browser errors').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

export async function openSite(page: Page): Promise<void> {
  const response = await page.goto('./', { waitUntil: 'load' });
  expect(response?.status(), 'document status').toBe(200);
  await expect(page.locator('main')).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  // The page boot script removes this marker when it initializes. A page that
  // stays in no-js mode is still readable, so this is a settle hint, not a
  // correctness assertion.
  await page
    .waitForFunction(() => !document.documentElement.classList.contains('no-js'), undefined, { timeout: 5_000 })
    .catch(() => undefined);
}

export async function assertNoHorizontalOverflow(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => {
    const width = window.innerWidth;
    const documentWidth = document.documentElement.scrollWidth;
    const bodyWidth = document.body.scrollWidth;
    const offenders = Array.from(document.querySelectorAll<HTMLElement>('body *'))
      .filter((element) => {
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 1 && (rect.right > width + 1 || rect.left < -1);
      })
      .slice(0, 8)
      .map((element) => ({
        tag: element.tagName.toLowerCase(),
        id: element.id,
        className: typeof element.className === 'string' ? element.className.slice(0, 80) : '',
        rect: (() => {
          const rect = element.getBoundingClientRect();
          return { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width) };
        })(),
      }));
    return { width, documentWidth, bodyWidth, offenders };
  });

  expect(metrics.documentWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.width + 1);
  expect(metrics.bodyWidth, JSON.stringify(metrics)).toBeLessThanOrEqual(metrics.width + 1);
}

export interface VisibleHeading {
  level: number;
  text: string;
}

export async function visibleHeadings(page: Page): Promise<VisibleHeading[]> {
  return page.locator('h1,h2,h3,h4,h5,h6').evaluateAll((nodes) =>
    nodes
      .filter((node) => {
        const element = node as HTMLElement;
        const style = getComputedStyle(element);
        return (
          style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          element.getClientRects().length > 0
        );
      })
      .map((node) => ({
        level: Number(node.tagName.slice(1)),
        text: (node.textContent ?? '').replace(/\s+/g, ' ').trim(),
      })),
  );
}

export async function assertHeadingStructure(page: Page): Promise<void> {
  const headings = await visibleHeadings(page);
  expect(headings.length, 'visible headings').toBeGreaterThan(3);
  expect(headings.filter((heading) => heading.level === 1), 'visible h1 count').toHaveLength(1);
  expect(headings.every((heading) => heading.text.length > 0), 'empty visible heading').toBe(true);

  let previous = 0;
  const jumps: string[] = [];
  for (const heading of headings) {
    if (previous > 0 && heading.level > previous + 1) {
      jumps.push(`h${previous} -> h${heading.level}: ${heading.text}`);
    }
    previous = heading.level;
  }
  expect(jumps, 'heading level jumps').toEqual([]);
}

export function sceneTabs(page: Page): Locator {
  return page.locator('#scene-tabs [role="tab"]');
}

export function selectedSceneTab(page: Page): Locator {
  return page.locator('#scene-tabs [role="tab"][aria-selected="true"]');
}

export async function selectedScene(page: Page): Promise<string | null> {
  return selectedSceneTab(page).getAttribute('data-scene');
}

export function orbitCanvases(page: Page): Locator {
  return page.locator('canvas#hero-orbit, canvas#orbit-canvas');
}

export async function canvasStates(page: Page): Promise<string[]> {
  return page
    .locator('canvas#hero-orbit, canvas#orbit-canvas')
    .evaluateAll((nodes) => nodes.map((node) => node.getAttribute('data-canvas-state') ?? 'missing'));
}

export function readMarketingManifest(): {
  entry: string;
  fileCount: number;
  files: Array<{ path: string; bytes: number; sha256: string }>;
} {
  return JSON.parse(readFileSync(join(MARKETING_OUT_DIR, 'build-manifest.json'), 'utf8'));
}

export async function brokenInternalAnchors(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const broken: string[] = [];
    for (const anchor of Array.from(document.querySelectorAll<HTMLAnchorElement>('a[href^="#"]'))) {
      const raw = anchor.getAttribute('href') ?? '';
      if (raw === '#' || raw.startsWith('#!')) continue;
      const fragment = decodeURIComponent(raw.slice(1));
      if (fragment && !document.getElementById(fragment)) {
        broken.push(`${raw} (${anchor.textContent?.replace(/\s+/g, ' ').trim() ?? ''})`);
      }
    }
    return broken;
  });
}

export async function localOnlyRequests(page: Page): Promise<{ external: string[]; failed: string[] }> {
  const seen: string[] = [];
  const failed: string[] = [];
  page.on('request', (request) => {
    seen.push(request.url());
  });
  page.on('requestfailed', (request) => {
    failed.push(`${request.url()} ${request.failure()?.errorText ?? ''}`.trim());
  });

  await openSite(page);
  await page.evaluate(async () => {
    const step = Math.max(200, window.innerHeight * 0.8);
    const height = Math.max(document.body.scrollHeight, document.documentElement.scrollHeight);
    for (let y = 0; y <= height; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(500);
  await page.waitForTimeout(200);

  const external = seen
    .filter((raw) => !raw.startsWith('data:') && !raw.startsWith('blob:'))
    .filter((raw) => {
      try {
        const url = new URL(raw);
        return url.origin !== ORIGIN || !url.pathname.startsWith(`${BASE_PATH}/`);
      } catch {
        return true;
      }
    });
  return { external, failed };
}
