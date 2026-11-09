/**
 * Web e2e credential seed.
 *
 * Playwright cannot carry the app's SQLite/OPFS state between isolated browser
 * contexts, so the test bundle reads one credential record from localStorage
 * before bootstrap and writes it through the same persistence functions the
 * pairing flow uses. The entry point is gated by the build-time
 * `EXPO_PUBLIC_E2E=1` constant, so a normal export is inert.
 *
 * The host must be loopback. A test token is still a bearer token for the local
 * staging adapter, so it is never accepted for a remote host.
 */
import { saveServer, setPref, type ServerProfileRow } from '../persistence/db';
import { saveToken } from '../persistence/credentials';

const SEED_KEY = 'jcode.e2e.credentials';

interface Seed {
  label?: string;
  host?: string;
  port?: number;
  tls?: boolean;
  token?: string;
  deviceId?: string;
}

export async function importE2ECredentials(): Promise<boolean> {
  if (process.env.EXPO_PUBLIC_E2E !== '1') return false;
  let raw: string | null = null;
  try {
    raw = globalThis.localStorage?.getItem(SEED_KEY) ?? null;
  } catch {
    return false;
  }
  if (!raw) return false;

  let parsed: Seed;
  try {
    parsed = JSON.parse(raw) as Seed;
  } catch {
    return false;
  }

  const host = typeof parsed.host === 'string' ? parsed.host : '';
  const loopback = host === '127.0.0.1' || host === 'localhost' || host === '::1';
  if (
    !loopback ||
    typeof parsed.token !== 'string' ||
    !/^[0-9a-f]{64}$/.test(parsed.token) ||
    typeof parsed.port !== 'number' ||
    !Number.isInteger(parsed.port) ||
    typeof parsed.deviceId !== 'string' ||
    parsed.deviceId.length < 8
  ) {
    return false;
  }

  const profileId = `srv_e2e_${parsed.port}`;
  const profile: ServerProfileRow = {
    id: profileId,
    label: typeof parsed.label === 'string' && parsed.label ? parsed.label : 'E2E staging server',
    host,
    port: parsed.port,
    tls: parsed.tls ? 1 : 0,
    device_id: parsed.deviceId,
    created_at: Date.now(),
    last_connected_at: Date.now(),
    daemon_version: null,
    capabilities_json: null,
  };
  await saveToken(profileId, parsed.token);
  await saveServer(profile);
  await setPref('lastServerId', profileId);
  await setPref('lastSessionId', '');
  try {
    globalThis.localStorage?.removeItem(SEED_KEY);
  } catch {
    // The seed is idempotent; leaving it would only repeat the same writes.
  }
  return true;
}
