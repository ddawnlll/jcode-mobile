import { readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { buildMarketingSite } from './build.mjs';
import { createMarketingServer } from './serve.mjs';
import { createSiteFixture } from './test-helpers.mjs';

const BASE_PATH = '/jcode-mobile';

let fixture;
let server;
let origin;
let manifest;

beforeAll(async () => {
  fixture = await createSiteFixture();
  await buildMarketingSite({
    sourceDir: fixture.source,
    outDir: fixture.out,
    repoRoot: fixture.root,
    quiet: true,
  });
  manifest = JSON.parse(await readFile(join(fixture.out, 'build-manifest.json'), 'utf8'));

  server = createMarketingServer({ rootDir: fixture.out, basePath: BASE_PATH });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(async () => {
  if (server) {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
  if (fixture) await rm(fixture.root, { recursive: true, force: true });
});

function url(path, query = '') {
  return `${origin}${path}${query}`;
}

describe('marketing static server', () => {
  test('redirects the project path and serves the index', async () => {
    const redirect = await fetch(url(BASE_PATH), { redirect: 'manual' });
    expect(redirect.status).toBe(308);
    expect(redirect.headers.get('location')).toBe(`${BASE_PATH}/`);

    const response = await fetch(url(`${BASE_PATH}/`));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/html');
    expect(response.headers.get('cache-control')).toBe('no-cache');
    expect(await response.text()).toContain('Fixture mobile');
  });

  test('sets security, cache, and MIME headers', async () => {
    const response = await fetch(url(`${BASE_PATH}/`));
    expect(response.status).toBe(200);
    expect(response.headers.get('x-content-type-options')).toBe('nosniff');
    expect(response.headers.get('x-frame-options')).toBe('DENY');
    expect(response.headers.get('referrer-policy')).toBe('strict-origin-when-cross-origin');
    expect(response.headers.get('cross-origin-resource-policy')).toBe('same-origin');
    expect(response.headers.get('permissions-policy')).toContain('camera=()');
    expect(response.headers.get('content-security-policy')).toContain("default-src 'self'");
    expect(response.headers.get('content-security-policy')).toContain("frame-ancestors 'none'");
    expect(response.headers.get('etag')).toMatch(/^W\//);
    expect(response.headers.get('last-modified')).toBeTruthy();
  });

  test('serves assets with explicit types and bounded caching', async () => {
    const expected = new Map([
      ['styles.css', 'text/css'],
      ['main.js', 'text/javascript'],
      ['assets/font.ttf', 'font/ttf'],
      ['assets/pixel.png', 'image/png'],
      ['build-manifest.json', 'application/json'],
    ]);
    for (const [path, type] of expected) {
      expect(manifest.files.some((file) => file.path === path) || path === 'build-manifest.json').toBe(true);
      const response = await fetch(url(`${BASE_PATH}/${path}`));
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toContain(type);
      expect(response.headers.get('cache-control')).toBe('public, max-age=3600');
    }
  });

  test('serves APK downloads with the Android package MIME type', async () => {
    await writeFile(join(fixture.out, 'app.apk'), 'fixture apk', 'utf8');
    const response = await fetch(url(`${BASE_PATH}/app.apk`));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/vnd.android.package-archive');
  });

  test('supports HEAD with no response body', async () => {
    const response = await fetch(url(`${BASE_PATH}/`), { method: 'HEAD' });
    expect(response.status).toBe(200);
    expect(response.headers.get('content-length')).toBeTruthy();
    expect(await response.text()).toBe('');
  });

  test('honors conditional requests', async () => {
    const first = await fetch(url(`${BASE_PATH}/`));
    const etag = first.headers.get('etag');
    const second = await fetch(url(`${BASE_PATH}/`), { headers: { 'if-none-match': etag } });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
  });

  test('rejects non-read methods', async () => {
    const response = await fetch(url(`${BASE_PATH}/`), { method: 'OPTIONS' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET, HEAD');
  });

  test('returns honest 404s without an SPA fallback or directory listing', async () => {
    for (const path of [`${BASE_PATH}/missing.html`, `${BASE_PATH}/assets/`, `${BASE_PATH}/assets`]) {
      const response = await fetch(url(path), { redirect: 'manual' });
      if (path === `${BASE_PATH}/assets`) {
        expect(response.status).toBe(308);
        expect(response.headers.get('location')).toBe(`${BASE_PATH}/assets/`);
        continue;
      }
      expect(response.status).toBe(404);
      expect(await response.text()).toBe('Not found\n');
    }
  });

  test('refuses traversal, dotfiles, and paths outside the project mount', async () => {
    const attempts = [
      `/package.json`,
      `/.git/config`,
      `${BASE_PATH}/.env`,
      `${BASE_PATH}/%2e%2e/package.json`,
      `${BASE_PATH}/%2e%2e%2f%2e%2e%2fetc/passwd`,
      `${BASE_PATH}/..%5cpackage.json`,
      `${BASE_PATH}/%00`,
    ];
    for (const path of attempts) {
      const response = await fetch(url(path), { redirect: 'manual' });
      expect([400, 403, 404]).toContain(response.status);
      const body = await response.text();
      expect(body).not.toContain('marketing-fixture');
      expect(body).not.toContain('root:');
    }
  });

  test('refuses a symlink that escapes the served root', async () => {
    try {
      await symlink('/etc/passwd', join(fixture.out, 'escape.txt'));
    } catch (error) {
      if (error instanceof Error && /EPERM|EACCES|ENOTSUP/.test(error.message)) return;
      throw error;
    }
    const response = await fetch(url(`${BASE_PATH}/escape.txt`), { redirect: 'manual' });
    expect(response.status).toBe(403);
    expect(await response.text()).toBe('Forbidden\n');
  });
});
