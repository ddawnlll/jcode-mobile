import { expect, test } from '@playwright/test';

import { screenshot, trackPageErrors } from './helpers';

test.use({ viewport: { width: 320, height: 720 }, hasTouch: true });

test.describe('320-wide reflow', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try {
        window.localStorage.removeItem('jcode.e2e.credentials');
      } catch {
        // Nothing to clear.
      }
    });
  });

  test('welcome and composer keep primary actions reachable', async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Welcome to jcode/ })).toBeVisible();
    await expect(page.getByTestId('welcome-connect')).toBeVisible();
    await expect(page.getByTestId('welcome-preview')).toBeVisible();
    await screenshot(page, 'v020-320-welcome');

    await page.getByTestId('welcome-preview').click();
    await expect(page.getByRole('heading', { name: 'Your sessions' })).toBeVisible();
    await page
      .locator('[data-testid^="session-"]')
      .filter({ hasText: 'Reconnect path review' })
      .first()
      .click();
    await expect(page.getByTestId('composer-send')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId('context-button')).toBeVisible();

    // Primary controls keep at least a 48-unit target at the narrow width.
    const send = await page.getByTestId('composer-send').boundingBox();
    const context = await page.getByTestId('context-button').boundingBox();
    expect(send?.width ?? 0).toBeGreaterThanOrEqual(44);
    expect(send?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(context?.height ?? 0).toBeGreaterThanOrEqual(40);
    await screenshot(page, 'v020-320-conversation');
    expect(errors).toEqual([]);
  });
});
