import { expect, test } from '@playwright/test';

import {
  createSession,
  expectConversation,
  expectSessions,
  screenshot,
  trackPageErrors,
} from './helpers';
import { seedCredentials } from './seed';

test.describe.configure({ mode: 'serial' });

test.describe('paired mobile app', () => {
  test.beforeEach(async ({ context }) => {
    await seedCredentials(context);
  });

  test('creates a session, sends the first instruction, and receives a reply', async ({ page }) => {
    test.slow();
    const errors = trackPageErrors(page);
    await page.goto('/');
    await expectSessions(page);
    await screenshot(page, 'sessions');

    await createSession(page, 'Reply with exactly E2E-OK. Do not use tools.');

    // The reply is a real provider turn against the isolated staging daemon.
    await expect(
      page.locator('[data-testid^="assistant-message-"]').filter({ hasText: 'E2E-OK' }).first(),
    ).toBeVisible({ timeout: 120_000 });

    // The user instruction is committed to authoritative history with the turn.
    await expect(
      page
        .locator('[data-testid^="user-message-"]')
        .first()
        .getByText('Reply with exactly E2E-OK', { exact: false }),
    ).toBeVisible({ timeout: 30_000 });

    await screenshot(page, 'conversation');
    expect(errors).toEqual([]);
  });

  test('shows the Plan tab only after the agent reports a plan', async ({ page }) => {
    test.slow();
    const errors = trackPageErrors(page);
    await page.goto('/');
    await expectSessions(page);

    await createSession(
      page,
      'Use the todo tool to create exactly two todos: "E2E one" with status in_progress and "E2E two" with status pending. Do not do anything else. Then reply exactly PLAN-DONE.',
    );

    const dock = page.getByRole('button', { name: /Open session work/ });
    await expect(dock).toBeVisible({ timeout: 60_000 });
    await dock.click();
    await expect(page.getByRole('heading', { name: 'Session work' })).toBeVisible();

    const planTab = page.getByRole('tab', { name: 'Plan' });
    await expect(planTab).toBeVisible({ timeout: 150_000 });
    await planTab.click();
    await expect(page.getByText(/reported steps complete/)).toBeVisible();
    await expect(page.getByText('E2E two', { exact: true })).toBeVisible();
    await screenshot(page, 'plan');
    expect(errors).toEqual([]);
  });

  test('opens the exact session work for a session with recorded tools', async ({ page }) => {
    const errors = trackPageErrors(page);
    await page.goto('/');
    await expectSessions(page);

    // The app restores the last exact session on launch. Give that restore a
    // moment to win; only click the row if the list is still showing.
    await page.waitForTimeout(2_000);
    if (
      await page
        .getByRole('heading', { name: 'Your sessions' })
        .isVisible()
        .catch(() => false)
    ) {
      const firstSession = page.locator('[data-testid^="session-"]').first();
      await expect(firstSession).toBeVisible();
      await firstSession.click();
    }
    await expectConversation(page);

    const dock = page.getByRole('button', { name: /Open session work/ });
    await expect(dock).toBeVisible({ timeout: 30_000 });
    await dock.click();

    await expect(page.getByRole('heading', { name: 'Session work' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Activity' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Plan' })).toBeVisible();
    await screenshot(page, 'work');

    await page.getByRole('button', { name: 'Close session work' }).click();
    await expect(page.getByRole('heading', { name: 'Session work' })).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});
