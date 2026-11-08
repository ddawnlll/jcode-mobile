import { File, Paths } from 'expo-file-system';

import { setPref, saveServer, type ServerProfileRow } from '../persistence/db';
import { saveToken } from '../persistence/credentials';

const FILE_NAME = 'dev-pair.json';

interface DevPairing {
  label: string;
  host: string;
  port: number;
  tls: boolean;
  token: string;
  deviceId: string;
}

/**
 * Development-only import for simulator automation. The file is written by
 * `scripts/dev-seed-ios-pairing.sh` into the app's Documents directory and is
 * deleted immediately after import. Loopback hosts only, so this can never be
 * used to inject a remote credential. `__DEV__` is false in release bundles.
 */
export async function importDevPairingFile(): Promise<boolean> {
  if (!__DEV__) return false;
  const file = new File(Paths.document, FILE_NAME);
  if (!file.exists) return false;
  try {
    const parsed = JSON.parse(await file.text()) as Partial<DevPairing>;
    const host = typeof parsed.host === 'string' ? parsed.host : '';
    const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
    if (
      !loopback ||
      typeof parsed.token !== 'string' ||
      !/^[0-9a-f]{64}$/.test(parsed.token) ||
      typeof parsed.port !== 'number' ||
      typeof parsed.deviceId !== 'string'
    ) {
      return false;
    }
    const profile: ServerProfileRow = {
      id: `srv_dev_${parsed.port}`,
      label: typeof parsed.label === 'string' && parsed.label ? parsed.label : 'Local staging server',
      host,
      port: parsed.port,
      tls: parsed.tls ? 1 : 0,
      device_id: parsed.deviceId,
      created_at: Date.now(),
      last_connected_at: Date.now(),
      daemon_version: null,
      capabilities_json: null,
    };
    await saveToken(profile.id, parsed.token);
    await saveServer(profile);
    await setPref('lastServerId', profile.id);
    await setPref('lastSessionId', '');
    return true;
  } catch (error) {
    if (__DEV__) {
      console.warn(
        '[dev-pair] import failed:',
        error instanceof Error ? error.message : String(error),
      );
    }
    return false;
  } finally {
    try {
      file.delete();
    } catch {
      // best effort; the import is already complete
    }
  }
}
