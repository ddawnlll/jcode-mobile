import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page } from '@playwright/test';

const SCREENS = join(process.cwd(), '.staging/e2e/screens');

export async function screenshot(page: Page, name: string): Promise<void> {
  mkdirSync(SCREENS, { recursive: true });
  await page.screenshot({ path: join(SCREENS, `${name}.png`), fullPage: false });
}

/** Collect uncaught browser errors and assert none happened at the end of a test. */
export function trackPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

export async function expectSessions(page: Page): Promise<void> {
  await expect(page.getByRole('heading', { name: 'Your sessions' })).toBeVisible({
    timeout: 30_000,
  });
}

export async function openNewSessionSheet(page: Page): Promise<void> {
  await page.getByTestId('sessions-new').click();
  await expect(page.getByRole('heading', { name: 'New session' })).toBeVisible();
}

export async function expectConversation(page: Page): Promise<void> {
  await expect(
    page.getByRole('textbox', { name: /^(Message|Add an instruction)$/ }),
  ).toBeVisible({ timeout: 45_000 });
}

export async function createSession(
  page: Page,
  instruction: string,
  folder = '/home/quant/jcode-mobile',
): Promise<void> {
  await openNewSessionSheet(page);

  // The form refuses a relative folder before it touches the server.
  await page.getByRole('button', { name: 'Start session' }).click();
  await expect(
    page.getByText('Enter an absolute folder path on the server, starting with /.'),
  ).toBeVisible();

  await page.getByRole('textbox', { name: 'Folder on server' }).fill(folder);
  await page.getByRole('textbox', { name: 'Instruction' }).fill(instruction);
  await page.getByRole('button', { name: 'Start session' }).click();
  await expectConversation(page);
}
