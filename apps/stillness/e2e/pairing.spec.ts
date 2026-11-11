import { test, expect } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const configDir = path.dirname(fileURLToPath(import.meta.url));

const authFile = path.join(configDir, '..', '.e2e-auth.json');
const adapter = process.env.STILLNESS_E2E_BASE_URL ?? 'http://127.0.0.1:7650';
const code = process.env.STILLNESS_E2E_PAIR_CODE ?? '000000';

test('pairs through the real adapter and persists the exact server', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('welcome-screen')).toBeVisible();
  await page.getByTestId('start-pairing').click();
  await expect(page.getByTestId('pair-screen')).toBeVisible();
  await page.getByTestId('pair-server').fill(adapter);
  await page.getByTestId('pair-code').fill(code);
  await page.getByTestId('pair-device').fill('Playwright Chromium');
  await page.getByTestId('pair-submit').click();

  await expect(page.getByTestId('ready-screen')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByText('DEVICE TOKEN ACCEPTED')).toBeVisible();
  await expect(page.getByText(/Adapter 0\.3\.0/)).toBeVisible();

  await page.getByTestId('enter-app').click();
  await expect(page.getByTestId('home-screen')).toBeVisible();
  await expect(page.getByTestId('home-screen')).toContainText('Your work.');
  await expect(page.getByTestId('home-screen')).toContainText('Harness online');

  await page.context().storageState({ path: authFile });

  // A reload must restore the exact server and session rather than showing
  // onboarding or silently creating a replacement.
  await page.reload();
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId('welcome-screen')).toHaveCount(0);
  const saved = await page.evaluate(() => localStorage.getItem('jcode.mobile.v3.credentials'));
  expect(saved).toContain(adapter);
});
