import * as SecureStore from 'expo-secure-store';

const KEY_PREFIX = 'jcode.token.';

function key(profileId: string): string {
  return `${KEY_PREFIX}${profileId.replace(/[^A-Za-z0-9._-]/g, '_')}`;
}

/** Bearer tokens live in Keychain/Keystore only, never in SQLite or logs. */
export async function saveToken(profileId: string, token: string): Promise<void> {
  await SecureStore.setItemAsync(key(profileId), token, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
}

export async function loadToken(profileId: string): Promise<string | null> {
  return SecureStore.getItemAsync(key(profileId));
}

export async function deleteToken(profileId: string): Promise<void> {
  await SecureStore.deleteItemAsync(key(profileId));
}
