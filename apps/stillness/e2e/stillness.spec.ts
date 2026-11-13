import { test, expect, type Page } from '@playwright/test';

const suffix = `${Date.now().toString(36)}`;
test.beforeEach(async ({ page }, testInfo) => {
  // Both viewport projects run this file; keep created titles distinct.
  page.setDefaultTimeout(120_000);
  testInfo.setTimeout(120_000);
});

async function openDrawer(page: Page) {
  await page.getByRole('button', { name: 'Open sidebar' }).click();
  await expect(page.locator('.drawer')).toHaveClass(/open/);
}

test('real session, draft, plan, activity, files, and preferences', async ({ page }) => {
  test.skip(test.info().project.name !== 'mobile', 'drawer navigation is the mobile surface');
  const title = `Stillness e2e ${suffix} ${test.info().project.name}`;
  await page.goto('/');
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 45_000 });

  // Create a real session on the isolated daemon.
  await page.getByTestId('new-session-button').click();
  await expect(page.getByTestId('new-session-screen')).toBeVisible();
  await page.getByRole('button', { name: /Personal chat/ }).click();
  await page.getByLabel('Title (optional)').fill(title);
  await page.getByTestId('create-session-submit').click();
  await expect(page.getByTestId('session-screen')).toBeVisible({ timeout: 45_000 });
  await expect(page.getByTestId('session-title')).toContainText(title);

  // Draft is scoped to the session and survives navigation.
  const draft = 'Draft survives navigation and never stops a turn.';
  await page.getByTestId('composer-input').fill(draft);
  await page.getByRole('button', { name: 'Back to sessions' }).click();
  await expect(page.getByTestId('sessions-screen')).toBeVisible();
  await page.getByTestId('session-row').filter({ hasText: title }).click();
  await expect(page.getByTestId('session-screen')).toBeVisible();
  await expect(page.getByTestId('composer-input')).toHaveValue(draft);

  // Rename is explicit and verified by the server response.
  await page.getByRole('button', { name: 'Rename session' }).click();
  const renamed = `${title} renamed`;
  await page.locator('.overlay-body input').fill(renamed);
  await page.getByRole('button', { name: 'Save title' }).click();
  await expect(page.getByTestId('session-title')).toContainText(renamed);

  // Plan is honest when the daemon reports no plan.
  await openDrawer(page);
  await page.locator('.drawer').getByRole('button', { name: 'Plan' }).click();
  await expect(page.getByTestId('plan-screen')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Execution plan' })).toBeVisible();
  await expect(page.getByTestId('plan-screen')).toContainText(/No plan has been reported|completed/);

  await openDrawer(page);
  await page.locator('.drawer').getByRole('button', { name: 'Activity' }).click();
  await expect(page.getByTestId('activity-screen')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Activity' })).toBeVisible();

  await openDrawer(page);
  await page.locator('.drawer').getByRole('button', { name: 'Changes' }).click();
  await expect(page.getByTestId('changes-screen')).toBeVisible();
  await expect(page.getByText('File-level change reports are not available')).toBeVisible();

  // Project file browser is root-scoped and shows real entries.
  await openDrawer(page);
  await page.locator('.drawer').getByRole('button', { name: 'Projects' }).click();
  await expect(page.getByTestId('projects-screen')).toBeVisible();
  const project = page.getByTestId('project-row').first();
  await expect(project).toBeVisible();
  await project.click();
  await expect(page.getByTestId('project-detail')).toBeVisible();
  await page.getByTestId('browse-files').click();
  await expect(page.getByTestId('browser-screen')).toBeVisible();
  await expect(page.getByTestId('browser-entries')).toBeVisible();

  // Return through the project list so the mobile drawer is available again.
  await page.getByRole('button', { name: 'Back to project' }).click();
  await expect(page.getByTestId('project-detail')).toBeVisible();
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await expect(page.getByTestId('projects-screen')).toBeVisible();

  // Preferences are local, immediate, and do not touch execution.
  await openDrawer(page);
  await page.locator('.drawer').getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByTestId('settings-screen')).toBeVisible();
  await page.getByTestId('theme-dark').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByTestId('theme-light').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.getByText('localStorage (web preview)')).toBeVisible();
});

test('desktop shell exposes the three-pane layout', async ({ page }) => {
  test.skip(test.info().project.name !== 'desktop', 'three-pane layout is a desktop assertion');
  await page.goto('/');
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.rail')).toBeVisible();
  await page.getByTestId('session-row').first().click();
  await expect(page.getByTestId('session-screen')).toBeVisible();
  await expect(page.locator('.inspector')).toBeVisible();
  await expect(page.locator('.rail')).toBeVisible();
  await expect(page.getByTestId('composer-input')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open sidebar' })).toBeHidden();
});

test('send reports acceptance honestly and stop is the only cancellation', async ({ page }) => {
  test.skip(test.info().project.name !== 'mobile', 'delivery is exercised once on the mobile project');
  test.setTimeout(180_000);
  await page.goto('/');
  await expect(page.getByTestId('home-screen')).toBeVisible({ timeout: 45_000 });
  await page.getByTestId('session-row').first().click();
  await expect(page.getByTestId('session-screen')).toBeVisible();

  // Model routes come from the daemon, and Command Code is identified by the
  // normalized provider label rather than one exact spelling.
  await page.getByTestId('model-button').click();
  await expect(page.getByTestId('model-sheet')).toBeVisible();
  await expect(page.getByTestId('command-code-section')).toContainText('deepseek/deepseek-v4-flash');
  await page.getByTestId('model-sheet').getByRole('button', { name: 'Close' }).click();
  await expect(page.getByTestId('model-sheet')).toBeHidden();

  const composer = page.getByTestId('composer-input');
  // A unique token prevents an older assistant message from satisfying the
  // generation assertion after repeated local runs.
  const token = `stillness-${suffix}-ok`;
  await composer.fill(`Reply with exactly: ${token}`);
  await page.getByTestId('send-button').click();

  const failure = page.locator('.inline-error');
  const stop = page.getByTestId('stop-button');
  await expect(page.getByTestId('delivery-state')).toContainText(/Sending to server|Sent to server|Accepted by agent/, {
    timeout: 20_000,
  });

  // The isolated daemon has a real Command Code key. A generated answer is
  // required evidence; a failure is reported as a failure, never as content.
  const assistant = page.locator('[data-testid="assistant-message"], [data-testid="live-assistant-message"]').last();
  await expect(assistant).toContainText(token, { timeout: 120_000 });
  await expect(failure).toBeHidden();
  await expect(page.getByTestId('delivery-state')).not.toContainText(
    /Unconfirmed|Unknown|Sending to server/,
    { timeout: 30_000 },
  );
  await expect(page.getByTestId('pending-message')).toHaveCount(0, { timeout: 30_000 });
  await page.screenshot({ path: 'docs/evidence/v0.3.1/stillness-mobile-accepted.png' });
  // The pending card clears only after an authoritative snapshot shows the
  // message in history. That is when a second delivery becomes safe.
  await composer.fill('Write a 300 word description of a quiet library. Do not use any tools.');
  await expect(page.getByTestId('send-button')).toBeEnabled({ timeout: 30_000 });

  // Navigation never cancels. Run one longer turn and stop it explicitly.
  await page.getByTestId('send-button').click();
  await expect(stop).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'Back to sessions' }).click();
  await expect(page.getByTestId('sessions-screen')).toBeVisible();
  await page.getByTestId('session-row').first().click();
  await expect(page.getByTestId('session-screen')).toBeVisible();
  // Reopening restored the active turn instead of inventing completion.
  await expect(stop).toBeVisible({ timeout: 20_000 });
  await stop.click();
  await expect(stop).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('.toast')).toContainText(/Stop sent|no active turn/i, { timeout: 20_000 });
});
