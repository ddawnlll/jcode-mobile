import { expect, test } from '@playwright/test';

import { setE2EAdapter } from './adapter';
import { seedCredentials } from './seed';

test.describe('confirmed title persistence', () => {
  test.beforeEach(async ({ context }) => {
    await seedCredentials(context);
  });

  test.afterAll(() => {
    setE2EAdapter(true);
  });

  test('a confirmed rename survives an offline reopen', async ({ page }) => {
    test.slow();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your sessions' })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByTestId('sessions-new').click();
    await expect(page.getByRole('heading', { name: 'New session' })).toBeVisible();
    await page.getByRole('textbox', { name: 'Folder on server' }).fill('/home/quant/jcode-mobile');
    await page.getByRole('button', { name: 'Start session' }).click();
    await expect(
      page.getByRole('textbox', { name: /^(Message|Add an instruction)$/ }),
    ).toBeVisible({ timeout: 45_000 });

    await page.getByRole('button', { name: 'Session menu' }).click();
    await page.getByRole('button', { name: 'Rename' }).click();
    await page.getByRole('textbox', { name: 'Title' }).fill('E2E Persisted Title');
    await page.getByRole('button', { name: 'Save title' }).click();

    // The sheet closes only after the adapter receives the daemon's event.
    await expect(page.getByText('Rename session')).toHaveCount(0, { timeout: 20_000 });
    await expect(page.getByRole('heading', { name: 'E2E Persisted Title' })).toBeVisible();

    await page.getByRole('button', { name: 'Back to sessions' }).click();
    const row = page
      .locator('[data-testid^="session-"]')
      .filter({ hasText: 'E2E Persisted Title' })
      .first();
    await expect(row).toBeVisible();

    setE2EAdapter(false);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Your sessions' })).toBeVisible({
      timeout: 30_000,
    });

    const cachedRow = page
      .locator('[data-testid^="session-"]')
      .filter({ hasText: 'E2E Persisted Title' })
      .first();
    await expect(cachedRow).toBeVisible();
    await cachedRow.click();
    await expect(page.getByRole('heading', { name: 'E2E Persisted Title' })).toBeVisible({
      timeout: 30_000,
    });
  });
});
