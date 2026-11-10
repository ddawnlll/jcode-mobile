import { expect, test } from '@playwright/test';

import { createSession, expectConversation, expectSessions, screenshot, trackPageErrors } from './helpers';
import { seedCredentials } from './seed';

const ADAPTER = process.env.JCODE_E2E_ADAPTER_BASE ?? 'http://127.0.0.1:7645';

test.describe.configure({ mode: 'serial' });

test.describe('0.2.2 repair verification', () => {
  test.beforeEach(async ({ context }) => {
    await seedCredentials(context);
  });

  test('the deployed adapter reports its exact build and capability set', async ({ request }) => {
    const response = await request.get(`${ADAPTER}/info`);
    expect(response.ok()).toBeTruthy();
    const info = (await response.json()) as {
      adapter_version?: string;
      capabilities?: string[];
      daemon_version?: string | null;
    };
    expect(info.adapter_version).toBe('0.2.2');
    for (const capability of [
      'session_config',
      'context_snapshot',
      'directory_browse',
      'image_input',
      'changes',
    ]) {
      expect(info.capabilities).toContain(capability);
    }
  });

  test('model and context are supported, and Context keeps Close reachable at 320x560', async ({
    page,
  }) => {
    test.slow();
    const errors = trackPageErrors(page);
    await page.goto('/');
    await expectSessions(page);
    await createSession(page, 'Reply with exactly PANEL-OK. Do not use tools.');

    await expect(
      page.locator('[data-testid^="assistant-message-"]').filter({ hasText: 'PANEL-OK' }).first(),
    ).toBeVisible({ timeout: 120_000 });

    await page.getByTestId('model-button').click();
    await expect(page.getByTestId('configuration-sheet')).toBeVisible();
    await expect(
      page.getByText(/does not advertise session configuration/i),
    ).toHaveCount(0);
    await page.getByRole('button', { name: 'Cancel' }).first().click();
    await expect(page.getByTestId('configuration-sheet')).toHaveCount(0);

    await page.setViewportSize({ width: 320, height: 560 });
    await page.getByTestId('context-button').click();
    await expect(page.getByTestId('context-sheet')).toBeVisible();
    await expect(page.getByText(/does not advertise context snapshots/i)).toHaveCount(0);
    const close = page.getByTestId('context-sheet').getByText('Close', { exact: true });
    await close.scrollIntoViewIfNeeded();
    await expect(close).toBeVisible();
    await screenshot(page, 'context-320');
    expect(errors).toEqual([]);
  });

  test('two assistant steps around a tool stay separate', async ({ page }) => {
    test.slow();
    const errors = trackPageErrors(page);
    await page.goto('/');
    await expectSessions(page);
    await createSession(
      page,
      'Do exactly this and nothing else. First reply with the single line PART-ONE. Then run the shell tool with the command printf E2E-TOOL. Then reply with the single line PART-TWO.',
    );
    await expectConversation(page);

    const assistant = page.locator('[data-testid^="assistant-message-"]');
    const first = assistant.filter({ hasText: 'PART-ONE' }).first();
    const second = assistant.filter({ hasText: 'PART-TWO' }).first();
    await expect(first).toBeVisible({ timeout: 150_000 });
    await expect(second).toBeVisible({ timeout: 30_000 });
    // The earlier step must not be swallowed by the later Markdown block.
    await expect(first).not.toContainText('PART-TWO');
    await expect(second).not.toContainText('PART-ONE');
    await expect(page.locator('[data-testid^="user-message-"]').first()).toContainText(
      'PART-ONE',
    );
    await screenshot(page, 'two-steps');

    // Authoritative history must keep the same boundary after a reload, not
    // only while the live provisional blocks are in memory.
    await page.reload();
    await expectSessions(page);
    await page.locator('[data-testid^="session-"]').first().click();
    await expectConversation(page);
    await expect(first).toBeVisible({ timeout: 60_000 });
    await expect(second).toBeVisible({ timeout: 30_000 });
    await expect(first).not.toContainText('PART-TWO');
    await expect(second).not.toContainText('PART-ONE');
    expect(errors).toEqual([]);
  });

  test('Context creates and opens a session in this project directly', async ({ page }) => {
    test.slow();
    const errors = trackPageErrors(page);
    await page.goto('/');
    await expectSessions(page);
    await page.locator('[data-testid^="session-"]').first().click();
    await expectConversation(page);

    await page.getByTestId('context-button').click();
    await expect(page.getByTestId('context-sheet')).toBeVisible();
    await page.getByRole('button', { name: 'New session in this project' }).click();
    await expectConversation(page);
    await expect(page.getByTestId('new-session-folder')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('Projects can add a folder, create a subfolder, and open a session directly', async ({
    page,
  }) => {
    test.slow();
    const errors = trackPageErrors(page);
    await page.goto('/');
    await expectSessions(page);
    await page.getByRole('button', { name: 'App menu' }).click();
    await page.getByTestId('app-menu').getByRole('button', { name: 'Projects' }).click();
    await expect(page.getByRole('heading', { name: 'Projects' })).toBeVisible();
    await page.getByRole('button', { name: 'Add project' }).first().click();
    await expect(page.getByTestId('directory-browser')).toBeVisible();

    await page.getByTestId('directory-search').fill('zzz-no-match');
    await expect(page.getByText(/No folder matches/)).toBeVisible();
    await page.getByTestId('directory-search').fill('');

    const name = `e2e-project-${Date.now()}`;
    await page.getByRole('button', { name: 'New folder' }).click();
    await page.getByTestId('directory-new-name').fill(name);
    await page.getByRole('button', { name: 'Create', exact: true }).click();
    await expect(page.getByTestId('directory-use')).toBeEnabled({ timeout: 20_000 });
    await expect(page.getByText(name, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await page.getByTestId('directory-use').click();

    const row = page.getByTestId(`project-${name}`);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: 'New session here' }).last().click();
    await expectConversation(page);
    await expect(page.getByTestId('new-session-folder')).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test.describe('preview thinking animation', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      try {
        window.localStorage.removeItem('jcode.e2e.credentials');
      } catch {
        // Nothing to clear.
      }
    });
  });

  test('the Compact thinking mark actually animates', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: /Welcome to jcode/ })).toBeVisible();
    await page.getByTestId('welcome-preview').click();
    await expect(page.getByRole('heading', { name: 'Your sessions' })).toBeVisible({
      timeout: 30_000,
    });
    await page
      .locator('[data-testid^="session-"]')
      .filter({ hasText: 'Reconnect path review' })
      .first()
      .click();
    await expect(page.getByTestId('assistant-message-1')).toBeVisible({ timeout: 30_000 });

    const transform = () =>
      page.evaluate(() => {
        const root = document.querySelector('[data-testid="thinking-indicator"]');
        if (!root) return 'missing';
        for (const node of Array.from(root.querySelectorAll('*'))) {
          const value = getComputedStyle(node).transform;
          if (value && value !== 'none') return value;
        }
        return 'none';
      });

    const first = await transform();
    expect(first).not.toBe('none');
    await page.waitForTimeout(420);
    const second = await transform();
    expect(second).not.toBe('none');
    expect(second).not.toBe(first);
  });
});
