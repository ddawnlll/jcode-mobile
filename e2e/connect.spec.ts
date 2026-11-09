import { expect, test } from '@playwright/test';

import { screenshot, trackPageErrors } from './helpers';

test.describe('connect screen', () => {
  test.beforeEach(async ({ context }) => {
    // No seed: this spec verifies the unpaired first-run surface.
    await context.addInitScript(() => {
      try {
        window.localStorage.removeItem('jcode.e2e.credentials');
      } catch {
        // Nothing to clear.
      }
    });
  });

  test('renders readable fields and refuses to pair without an address', async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto('/');

    await expect(page.getByRole('heading', { name: 'Bring your server.' })).toBeVisible();
    for (const label of ['Server address', 'Pairing code', 'Server label', 'Device name']) {
      await expect(page.getByRole('textbox', { name: label })).toBeVisible();
    }

    const pair = page.getByRole('button', { name: 'Pair this phone' });
    await expect(pair).toBeDisabled();
    await expect(page.getByText('Enter a valid server address first.')).toBeVisible();

    await page.getByRole('textbox', { name: 'Server address' }).fill('wss://studio.example.net:7643');
    await page.getByRole('textbox', { name: 'Pairing code' }).fill('123456');
    await expect(
      page.getByText('This phone will contact wss://studio.example.net:7643/ws over TLS'),
    ).toBeVisible();
    await expect(pair).toBeEnabled();

    // Regression: the first web build rendered HankenGrotesk-Medium runs with
    // zero height because the bootstrap surface requested the font early.
    const collapsed = await page.evaluate(() =>
      [...document.querySelectorAll('div, h1, h2, h3, span')]
        .filter((element) => {
          const text = element.textContent?.trim() ?? '';
          if (!text || element.children.length > 0 || text.length > 100) return false;
          const rect = element.getBoundingClientRect();
          return rect.width > 0 && rect.height === 0;
        })
        .map((element) => element.textContent?.trim().slice(0, 60)),
    );
    expect(collapsed).toEqual([]);

    await screenshot(page, 'connect');
    expect(errors).toEqual([]);
  });

  test('shows the setup command only when asked', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText('jcode pair')).toHaveCount(0);
    await page.getByRole('button', { name: 'View setup details' }).click();
    await expect(page.getByText('jcode pair', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Hide setup details' }).click();
    await expect(page.getByText('jcode pair', { exact: true })).toHaveCount(0);
  });
});
