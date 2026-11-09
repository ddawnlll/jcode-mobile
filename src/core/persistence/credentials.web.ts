/**
 * Web credential storage.
 *
 * The native app stores bearer tokens in Keychain/Keystore. Browsers have no
 * equivalent, so the web target keeps tokens in origin-scoped localStorage.
 * That is weaker than a platform keystore: any script on this origin can read
 * it. The web target exists for UI development and Playwright verification of
 * the real adapter; it is not the distribution build. Do not pair a
 * long-lived production server from a publicly hosted web build.
 */
const KEY_PREFIX = 'jcode.token.';

function storage(): Storage | null {
  try {
    return typeof globalThis.localStorage === 'undefined' ? null : globalThis.localStorage;
  } catch {
    return null;
  }
}

function key(profileId: string): string {
  return `${KEY_PREFIX}${profileId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

export async function saveToken(profileId: string, token: string): Promise<void> {
  const store = storage();
  if (!store) throw new Error('Browser storage is unavailable.');
  store.setItem(key(profileId), token);
}

export async function loadToken(profileId: string): Promise<string | null> {
  return storage()?.getItem(key(profileId)) ?? null;
}

export async function deleteToken(profileId: string): Promise<void> {
  storage()?.removeItem(key(profileId));
}
