import { expect, test } from '@playwright/test';

import { seedCredentials } from './seed';

test.describe('forget navigation', () => {
  test.beforeEach(async ({ context }) => {
    await seedCredentials(context);
  });

  test('forgetting the last server resets to Connect and Back cannot reopen Sessions', async ({
    page,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your sessions' })).toBeVisible({
      timeout: 30_000,
    });

    await page.getByRole('button', { name: /Open server details/ }).click();
    await expect(page.getByText('Server details')).toBeVisible();

    await page.getByRole('button', { name: 'Forget this server' }).click();
    await expect(page.getByRole('heading', { name: 'Forget this server?' })).toBeVisible();
    await page.getByRole('button', { name: 'Forget server' }).click();

    await expect(page.getByRole('heading', { name: 'Bring your server.' })).toBeVisible({
      timeout: 15_000,
    });

    await page.goBack();
    await page.waitForTimeout(800);
    // Browser back may leave the SPA; the forbidden outcome is reopening the
    // forgotten paired stack, not where the browser lands outside it.
    await expect(page.getByRole('heading', { name: 'Your sessions' })).toHaveCount(0);
  });
});
