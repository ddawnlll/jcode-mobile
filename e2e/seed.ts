import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BrowserContext } from '@playwright/test';

const stage = process.env.JCODE_E2E_DIR ?? join(process.cwd(), '.staging/e2e');

/** Credentials written by e2e/global-setup.ts for the isolated staging adapter. */
export function credentialSeed(): string {
  return readFileSync(join(stage, 'credentials.json'), 'utf8');
}

/**
 * Put the seed in localStorage before the app boots. Each Playwright context is
 * empty, so every test starts from a known paired state without touching the
 * pairing form or any production device registry.
 */
export async function seedCredentials(context: BrowserContext): Promise<void> {
  const seed = credentialSeed();
  await context.addInitScript((value) => {
    try {
      window.localStorage.setItem('jcode.e2e.credentials', value as string);
    } catch {
      // The app will simply show Connect if storage is unavailable.
    }
  }, seed);
}
