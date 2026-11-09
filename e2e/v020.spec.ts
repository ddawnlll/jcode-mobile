import { expect, test } from '@playwright/test';

import { screenshot, trackPageErrors } from './helpers';

test.describe.configure({ mode: 'serial' });

async function enterPreview(page: import('@playwright/test').Page): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Welcome to jcode/ })).toBeVisible();
  await page.getByTestId('welcome-preview').click();
  await expect(page.getByRole('heading', { name: 'Your sessions' })).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.getByTestId('preview-banner')).toBeVisible();
}

async function openPreviewSession(page: import('@playwright/test').Page): Promise<void> {
  await page
    .locator('[data-testid^="session-"]')
    .filter({ hasText: 'Reconnect path review' })
    .first()
    .click();
  await expect(page.getByTestId('assistant-message-1')).toBeVisible({ timeout: 30_000 });
}

test.describe('Tidal Glass and rich content', () => {
  test.beforeEach(async ({ context }) => {
    // Fresh first-run storage for the demo and appearance flows.
    await context.addInitScript(() => {
      try {
        window.localStorage.removeItem('jcode.e2e.credentials');
      } catch {
        // Nothing to clear.
      }
    });
  });

  test('welcome theme preview, demo surfaces, copy, images, math and work', async ({ page, context }) => {
    test.slow();
    const errors = trackPageErrors(page);
    await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => undefined);
    await page.goto('/');

    await expect(page.getByRole('heading', { name: /Welcome to jcode/ })).toBeVisible();
    await expect(page.getByTestId('theme-tidal')).toBeVisible();
    await page.getByTestId('theme-gruvbox').click();
    await expect(page.getByTestId('theme-gruvbox')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('appearance-night').click();
    await screenshot(page, 'v020-welcome-night');

    await page.getByTestId('welcome-preview').click();
    await expect(page.getByRole('heading', { name: 'Your sessions' })).toBeVisible();
    await expect(page.getByTestId('preview-banner')).toBeVisible();
    await expect(page.getByTestId('project-scope')).toBeVisible();
    await screenshot(page, 'v020-sessions-preview');

    await openPreviewSession(page);

    await expect(page.getByText('What I checked')).toBeVisible();
    await expect(page.getByTestId('markdown-table')).toBeVisible();
    await expect(page.getByTestId('math-block').first()).toBeVisible();
    await expect(page.getByTestId('footnote-1')).toBeVisible();
    await expect(page.getByTestId('code-block').first()).toBeVisible();
    await expect(page.getByTestId('message-image').first()).toBeVisible();

    const actions = page.getByTestId('assistant-message-actions').first();
    await actions.getByRole('button', { name: 'Copy message Markdown' }).click();
    const clipboard = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboard).toContain('## What I checked');

    await expect(page.getByTestId('work-rail')).toBeVisible();
    await expect(page.locator('[data-testid^="work-row-"]').first()).toBeVisible();
    await page.getByRole('button', { name: /Open session work/ }).click();
    await expect(page.getByRole('heading', { name: 'Session work' })).toBeVisible();
    await page.getByRole('button', { name: 'Close session work' }).click();

    await page.getByTestId('context-button').click();
    await expect(page.getByTestId('context-sheet')).toBeVisible();
    await expect(page.getByTestId('context-sheet').getByText('48,600')).toBeVisible();
    await expect(page.getByTestId('context-sheet').getByText('128,000')).toBeVisible();
    await expect(page.getByTestId('context-sheet').getByText('38%')).toBeVisible();
    await page
      .getByTestId('context-sheet')
      .getByRole('button', { name: 'Close', exact: true })
      .click();

    await page.getByTestId('model-button').click();
    await expect(page.getByTestId('configuration-sheet')).toBeVisible();
    await page.getByRole('button', { name: 'Cancel' }).click();

    await page.getByRole('button', { name: 'Session menu' }).click();
    await page.getByRole('button', { name: 'Changes' }).click();
    await expect(page.getByTestId('changes-sheet')).toBeVisible();
    await expect(
      page.getByTestId('changes-sheet').getByText('src/core/app-controller.ts').first(),
    ).toBeVisible();
    await page
      .getByTestId('changes-sheet')
      .getByRole('button', { name: 'Close', exact: true })
      .click();

    await page.getByRole('button', { name: 'Session menu' }).click();
    await page.getByRole('button', { name: 'Find in conversation' }).click();
    await page.getByTestId('find-input').fill('reconnect');
    await expect(page.getByTestId('find-bar')).toContainText(/of \d+/);
    await page.getByTestId('find-next').click();
    await page.getByRole('button', { name: 'Close find' }).click();

    await page.getByTestId('composer-input').fill('Preview a new direction');
    await page.getByTestId('composer-send').click();
    await expect(page.getByText('This is the Preview surface')).toBeVisible({ timeout: 10_000 });
    await screenshot(page, 'v020-conversation');

    await page.getByRole('button', { name: 'Exit preview' }).click();
    await expect(page.getByRole('heading', { name: /Welcome to jcode/ })).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('thinking modes change presentation without leaving the turn', async ({ page }) => {
    await enterPreview(page);
    await openPreviewSession(page);

    await page.getByRole('button', { name: 'Session menu' }).click();
    await page.getByRole('button', { name: 'Appearance' }).click();
    await expect(page.getByTestId('appearance-screen')).toBeVisible();
    await page.getByTestId('reasoning-hidden').click();
    await page.getByRole('button', { name: 'Back' }).click();

    await expect(page.getByTestId('thinking-indicator')).toContainText('Model is thinking');
    await expect(page.getByTestId('reasoning-text')).toHaveCount(0);

    await page.getByRole('button', { name: 'Session menu' }).click();
    await page.getByRole('button', { name: 'Appearance' }).click();
    await page.getByTestId('reasoning-compact').click();
    await page.getByRole('button', { name: 'Back' }).click();
    await page.getByRole('button', { name: 'Show thinking' }).click();
    await expect(page.getByTestId('reasoning-text')).toBeVisible();
  });

  test('all eleven families and both modes are selectable and persist', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Welcome to jcode/ })).toBeVisible();
    await page.getByTestId('welcome-preview').click();
    await expect(page.getByRole('heading', { name: 'Your sessions' })).toBeVisible();

    await page.getByRole('button', { name: 'App menu' }).click();
    await page.getByRole('button', { name: 'Appearance' }).click();
    await expect(page.getByTestId('appearance-screen')).toBeVisible();
    await expect(page.locator('[data-testid^="palette-"]')).toHaveCount(22);

    for (const family of [
      'tidal',
      'gruvbox',
      'catppuccin',
      'dracula',
      'nord',
      'tokyo-night',
      'solarized',
      'one',
      'github',
      'rose-pine',
      'monokai',
    ]) {
      await page.getByTestId(`appearance-family-${family}`).click();
      await expect(page.getByTestId(`appearance-family-${family}`)).toHaveAttribute(
        'aria-checked',
        'true',
      );
    }

    await page.getByTestId('appearance-mode-night').click();
    await expect(page.getByTestId('appearance-mode-night')).toHaveAttribute('aria-checked', 'true');
    // setAppearance updates the store synchronously and then awaits the SQLite
    // preference write. The trace showed reload starting ~31ms after the click,
    // which can beat that write; let the write settle before reloading.
    await page.waitForTimeout(500);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: /Welcome to jcode/ })).toBeVisible();
    await expect(page.getByTestId('theme-monokai')).toHaveAttribute('aria-checked', 'true');
    await expect(page.getByTestId('appearance-night')).toHaveAttribute('aria-checked', 'true');
    await screenshot(page, 'v020-appearance-night');
  });

  test('composer stays reachable at a short viewport and preserves draft', async ({ page }) => {
    await enterPreview(page);
    await openPreviewSession(page);
    await page.getByTestId('composer-input').fill('Draft survives layout changes');
    await page.setViewportSize({ width: 390, height: 500 });
    await expect(page.getByTestId('composer-send')).toBeVisible();
    await expect(page.getByTestId('composer-input')).toHaveValue('Draft survives layout changes');
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByTestId('composer-input')).toHaveValue('Draft survives layout changes');
    await screenshot(page, 'v020-short-viewport');
  });
});
