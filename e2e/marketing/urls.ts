import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const MARKETING_OUT_DIR = process.env.MARKETING_OUT_DIR ?? resolve(REPO_ROOT, 'dist/marketing');

export const E2E_HOST = process.env.MARKETING_E2E_HOST ?? '127.0.0.1';
export const E2E_PORT = Number(process.env.MARKETING_E2E_PORT ?? 8093);
export const BASE_PATH = '/jcode-mobile';
export const BASE_URL = `http://${E2E_HOST}:${E2E_PORT}${BASE_PATH}/`;
export const ORIGIN = `http://${E2E_HOST}:${E2E_PORT}`;

export const APK_URL =
  'https://github.com/ddawnlll/jcode-mobile/releases/download/v0.3.1/jcode-mobile-0.3.1-android-release.apk';
export const REPO_URL = 'https://github.com/ddawnlll/jcode-mobile';
