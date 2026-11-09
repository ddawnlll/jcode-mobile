import { expect, test } from '@playwright/test';

import { setE2EAdapter } from './adapter';
import { seedCredentials } from './seed';

test.describe('visible recovery', () => {
  test.beforeEach(async ({ context }) => {
    await seedCredentials(context);
  });

  test.afterAll(() => {
    setE2EAdapter(true);
  });

  test('the Sessions screen recovers after the adapter returns', async ({ page }) => {
    test.slow();
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Your sessions' })).toBeVisible({
      timeout: 30_000,
    });

    setE2EAdapter(false);
    await expect(page.getByText(/^Offline\./)).toBeVisible({ timeout: 45_000 });

    setE2EAdapter(true);
    // The scheduled retry is allowed to win the race; the point is that the
    // foreground screen leaves Offline and publishes a live server again.
    await expect(page.getByText(/^Offline\./)).toHaveCount(0, { timeout: 90_000 });
    await expect(
      page.getByRole('button', { name: /Server: E2E staging server\. Open server details/ }),
    ).toBeVisible({ timeout: 30_000 });
  });
});
