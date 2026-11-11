import { invoke } from '@tauri-apps/api/core';
import type { PairedCredential } from './adapter';

const STORE_KEY = 'jcode.mobile.v3.credentials';
const ACTIVE_KEY = 'jcode.mobile.v3.activeServer';

type CredentialMap = Record<string, PairedCredential>;

const native = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
let nativeMap: CredentialMap | null = null;
let nativeActive: string | null = null;
let nativeFailure: string | null = null;
let initialization: Promise<void> | null = null;

function readWeb(): CredentialMap {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as CredentialMap;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writeWeb(map: CredentialMap) {
  localStorage.setItem(STORE_KEY, JSON.stringify(map));
}

function read(): CredentialMap {
  return native ? (nativeMap ?? {}) : readWeb();
}

/**
 * Load native credentials before the controller reads them. Web storage is
 * already synchronous. In a Tauri build the secret lives in the OS credential
 * store; only account names and the active server are kept in app config.
 */
export function initCredentialStorage(): Promise<void> {
  if (!native) return Promise.resolve();
  if (initialization) return initialization;
  initialization = (async () => {
    try {
      const snapshot = await invoke<{
        credentials: Record<string, string>;
        active_base_url: string | null;
      }>('credential_load_all');
      const map: CredentialMap = {};
      for (const [baseUrl, secret] of Object.entries(snapshot.credentials)) {
        try {
          const parsed = JSON.parse(secret) as PairedCredential;
          if (parsed?.baseUrl && parsed?.token) map[baseUrl] = parsed;
        } catch {
          // A malformed native entry is ignored rather than trusted.
        }
      }
      nativeMap = map;
      nativeActive = snapshot.active_base_url;
    } catch (error) {
      nativeFailure = error instanceof Error ? error.message : String(error);
      nativeMap = {};
    }
  })();
  return initialization;
}

export function credentialStorageProblem(): string | null {
  return native ? nativeFailure : null;
}

export function listCredentials(): PairedCredential[] {
  return Object.values(read()).sort((a, b) => b.savedAt - a.savedAt);
}

export function activeBaseUrl(): string | null {
  if (native) {
    if (nativeActive && read()[nativeActive]) return nativeActive;
    return listCredentials()[0]?.baseUrl ?? null;
  }
  try {
    return localStorage.getItem(ACTIVE_KEY);
  } catch {
    return null;
  }
}

export function loadCredential(baseUrl?: string | null): PairedCredential | null {
  const map = read();
  const key = baseUrl ?? activeBaseUrl();
  if (!key) return listCredentials()[0] ?? null;
  return map[key] ?? null;
}

export async function saveCredential(credential: PairedCredential): Promise<void> {
  if (native) {
    await invoke('credential_set', {
      baseUrl: credential.baseUrl,
      secret: JSON.stringify(credential),
    });
    nativeMap = { ...(nativeMap ?? {}), [credential.baseUrl]: credential };
    nativeActive = credential.baseUrl;
    nativeFailure = null;
    return;
  }
  const map = readWeb();
  map[credential.baseUrl] = credential;
  writeWeb(map);
  localStorage.setItem(ACTIVE_KEY, credential.baseUrl);
}

export async function clearCredential(baseUrl: string): Promise<void> {
  if (native) {
    await invoke('credential_delete', { baseUrl });
    const next = { ...(nativeMap ?? {}) };
    delete next[baseUrl];
    nativeMap = next;
    if (nativeActive === baseUrl) nativeActive = Object.values(next).sort((a, b) => b.savedAt - a.savedAt)[0]?.baseUrl ?? null;
    return;
  }
  const map = readWeb();
  delete map[baseUrl];
  writeWeb(map);
  if (localStorage.getItem(ACTIVE_KEY) === baseUrl) {
    const remaining = Object.values(map).sort((a, b) => b.savedAt - a.savedAt)[0];
    if (remaining) localStorage.setItem(ACTIVE_KEY, remaining.baseUrl);
    else localStorage.removeItem(ACTIVE_KEY);
  }
}

/**
 * The browser preview is plainly labelled. A Tauri build uses the native
 * command in src-tauri, which writes secrets to the OS credential store.
 */
export const credentialStorageKind = native
  ? 'OS credential store (desktop secret service)'
  : 'localStorage (web preview)';
