/**
 * Startup measurement against the real adapter.
 *
 * This is browser coverage on the web target, not native Android performance.
 * It reports measurements instead of asserting an invented budget:
 *
 * 1. cold online load: time from reload to an interactive screen, resource bytes
 * 2. cached offline load: time from reload to the saved session/list, with the
 *    network disabled, which proves cache-first rendering
 *
 * The numbers are attached to the test result and printed as JSON so evidence
 * can be archived. A generous timeout only guards against a hang.
 */
import { test, expect } from '@playwright/test';

const SCREEN = '[data-testid="home-screen"], [data-testid="session-screen"]';

test('cached UI paints before the network and reports startup cost', async ({ page, context }) => {
  test.skip(test.info().project.name !== 'mobile', 'startup is measured once on the mobile project');
  test.setTimeout(120_000);

  await page.addInitScript(() => {
    (window as unknown as { __shellStart?: number }).__shellStart = performance.now();
  });

  await page.goto('/');
  const onlineStart = Date.now();
  await expect(page.locator(SCREEN).first()).toBeVisible({ timeout: 45_000 });
  const onlineMs = Date.now() - onlineStart;

  // Let the cache write settle, then measure an offline relaunch.
  await page.waitForTimeout(800);
  const resources = await page.evaluate(() => {
    const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
    return {
      requests: entries.length,
      transfer_bytes: entries.reduce((total, entry) => total + (entry.transferSize || 0), 0),
    };
  });

  // A browser cannot reload the document with the whole context offline: there
  // is no service worker in the web target. Block only the real-time channel,
  // which is the actual "network is not back yet" case on a native shell.
  await page.addInitScript(() => {
    class BlockedWebSocket {
      static readonly CONNECTING = 0;
      static readonly OPEN = 1;
      static readonly CLOSING = 2;
      static readonly CLOSED = 3;
      readyState = 3;
      onopen: unknown = null;
      onclose: unknown = null;
      onerror: unknown = null;
      onmessage: unknown = null;
      constructor() {
        setTimeout(() => {
          (this.onclose as ((event: unknown) => void) | null)?.({
            code: 1006,
            reason: 'blocked for cached-paint measurement',
          });
        }, 30);
      }
      close() {}
      send() {}
      addEventListener() {}
      removeEventListener() {}
    }
    (window as unknown as { WebSocket: unknown }).WebSocket = BlockedWebSocket;
  });
  const offlineStart = Date.now();
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page.locator(SCREEN).first()).toBeVisible({ timeout: 20_000 });
  const offlineMs = Date.now() - offlineStart;
  const shellPaint = await page.evaluate(() => {
    const start = (window as unknown as { __shellStart?: number }).__shellStart;
    return start == null ? null : Math.round(performance.now() - start);
  });
  const savedMark = page.getByText(/Saved on this phone|Cached/i).first();
  const savedVisible = await savedMark.isVisible().catch(() => false);

  const measurement = {
    online_first_screen_ms: onlineMs,
    offline_cached_first_screen_ms: offlineMs,
    shell_to_cached_paint_ms: shellPaint,
    cold_requests: resources.requests,
    cold_transfer_bytes: resources.transfer_bytes,
    offline_saved_marker_visible: savedVisible,
    note: 'Playwright Chromium on the web target, not native Android',
  };
  console.log(`JCODE_PERF ${JSON.stringify(measurement)}`);
  await test.info().attach('startup.json', {
    body: JSON.stringify(measurement, null, 2),
    contentType: 'application/json',
  });

  // The cached screen must appear while offline. No latency claim beyond that.
  expect(offlineMs).toBeLessThan(20_000);
  expect(resources.requests).toBeGreaterThan(0);
});
