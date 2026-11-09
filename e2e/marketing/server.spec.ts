import { readFileSync } from 'node:fs';
import { extname, join } from 'node:path';
import { expect, test } from '@playwright/test';
import { BASE_PATH, MARKETING_OUT_DIR, ORIGIN } from './urls';

let manifest: { files: Array<{ path: string }> };

test.beforeAll(() => {
  manifest = JSON.parse(
    readFileSync(join(MARKETING_OUT_DIR, 'build-manifest.json'), 'utf8'),
  ) as { files: Array<{ path: string }> };
});

function marketUrl(path: string): string {
  return `${ORIGIN}${BASE_PATH}${path}`;
}

function expectedContentType(filePath: string): RegExp {
  switch (extname(filePath).toLowerCase()) {
    case '.html':
      return /^text\/html/;
    case '.css':
      return /^text\/css/;
    case '.js':
      return /^text\/javascript/;
    case '.json':
      return /^application\/json/;
    case '.svg':
      return /^image\/svg\+xml/;
    case '.png':
      return /^image\/png/;
    case '.gif':
      return /^image\/gif/;
    case '.jpg':
    case '.jpeg':
      return /^image\/jpeg/;
    case '.webp':
      return /^image\/webp/;
    case '.ttf':
      return /^font\/ttf/;
    case '.woff2':
      return /^font\/woff2/;
    case '.txt':
      return /^text\/plain/;
    case '.webmanifest':
      return /^application\/manifest\+json/;
    default:
      return /^application\/octet-stream/;
  }
}

test.describe('marketing static server contract', () => {
  test('serves the project root with security and revalidation headers', async ({ request }) => {
    const response = await request.get(marketUrl('/'));
    expect(response.status()).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^text\/html/);
    expect(response.headers()['cache-control']).toBe('no-cache');
    expect(response.headers()['x-content-type-options']).toBe('nosniff');
    expect(response.headers()['x-frame-options']).toBe('DENY');
    expect(response.headers()['referrer-policy']).toBe('strict-origin-when-cross-origin');
    expect(response.headers()['cross-origin-resource-policy']).toBe('same-origin');
    expect(response.headers()['permissions-policy']).toContain('camera=()');
    expect(response.headers()['content-security-policy']).toContain("default-src 'self'");
    expect(response.headers()['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(response.headers()['content-security-policy']).not.toContain('unsafe-eval');
    expect(response.headers()['etag']).toMatch(/^W\//);
  });

  test('redirects the project root without a trailing slash', async ({ request }) => {
    const response = await request.get(`${ORIGIN}${BASE_PATH}`, { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers()['location']).toBe(`${BASE_PATH}/`);
  });

  test('serves all build files with explicit MIME and cache policy', async ({ request }) => {
    const files = [...manifest.files.map((file) => file.path), 'build-manifest.json'];
    expect(files).toContain('index.html');
    for (const file of files) {
      const response = await request.get(marketUrl(`/${file}`));
      expect(response.status(), file).toBe(200);
      expect(response.headers()['content-type'], file).toMatch(expectedContentType(file));
      const cache = response.headers()['cache-control'] ?? '';
      if (file.endsWith('.html')) {
        expect(cache, file).toBe('no-cache');
      } else {
        expect(cache, file).toMatch(/public, max-age=3600/);
      }
    }
  });

  test('returns honest 404s without an SPA fallback or directory listing', async ({ request }) => {
    for (const path of ['/missing.html', '/assets/', '/assets']) {
      const response = await request.get(marketUrl(path), { maxRedirects: 0, failOnStatusCode: false });
      if (path === '/assets') {
        expect(response.status()).toBe(308);
        expect(response.headers()['location']).toBe(`${BASE_PATH}/assets/`);
        continue;
      }
      expect(response.status(), path).toBe(404);
      expect(await response.text()).toBe('Not found\n');
    }
  });

  test('refuses traversal, dotfiles, and paths outside the project mount', async ({ request }) => {
    const attempts = [
      '/package.json',
      '/.git/config',
      `${BASE_PATH}/.env`,
      `${BASE_PATH}/%2e%2e/package.json`,
      `${BASE_PATH}/%2e%2e%2f%2e%2e%2fetc/passwd`,
      `${BASE_PATH}/..%5cpackage.json`,
      `${BASE_PATH}/%00`,
    ];
    for (const path of attempts) {
      const response = await request.get(`${ORIGIN}${path}`, { maxRedirects: 0, failOnStatusCode: false });
      expect([400, 403, 404], path).toContain(response.status());
      const body = await response.text();
      expect(body, path).not.toContain('"name": "jcode-mobile"');
      expect(body, path).not.toContain('root:');
    }
  });

  test('supports HEAD, conditional GET, and read-only methods', async ({ request }) => {
    const head = await request.head(marketUrl('/'));
    expect(head.status()).toBe(200);
    expect(head.headers()['content-length']).toBeTruthy();
    expect(await head.text()).toBe('');

    const first = await request.get(marketUrl('/'));
    const etag = first.headers()['etag'];
    const second = await request.get(marketUrl('/'), { headers: { 'if-none-match': etag } });
    expect(second.status()).toBe(304);
    expect(await second.text()).toBe('');

    const options = await request.fetch(marketUrl('/'), { method: 'OPTIONS', failOnStatusCode: false });
    expect(options.status()).toBe(405);
    expect(options.headers()['allow']).toBe('GET, HEAD');
  });
});
