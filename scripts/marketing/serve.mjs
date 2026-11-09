#!/usr/bin/env bun
/**
 * Local static server for the marketing build.
 *
 * This is a correctness harness, not a production web server. It exists so the
 * Playwright suite can exercise the exact tree produced by
 * `scripts/marketing/build.mjs`, including a GitHub Pages-style base path.
 *
 * Safety properties:
 * - only GET and HEAD
 * - no SPA fallback (a missing file is a 404, never index.html)
 * - no dotfiles, no directory listings, no traversal, no symlink escape
 * - explicit MIME types, HTML revalidation, bounded asset caching
 * - security headers, including a same-origin CSP
 */
import { createReadStream, realpathSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, '../..');

const MIME_TYPES = new Map(Object.entries({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.pdf': 'application/pdf',
  '.apk': 'application/vnd.android.package-archive',
  '.zip': 'application/zip',
  '.wasm': 'application/wasm',
}));

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}

function normalizeBasePath(input) {
  if (!input || input === '/') return '';
  let value = input.trim();
  if (!value.startsWith('/')) value = `/${value}`;
  value = value.replace(/\/+$/, '');
  if (value.includes('..') || value.includes('\\') || value.includes('\0')) {
    throw new Error(`invalid base path: ${input}`);
  }
  return value;
}

function securityHeaders({ hsts }) {
  const headers = {
    'Content-Security-Policy': [
      "default-src 'self'",
      "base-uri 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "form-action 'none'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self'",
      "media-src 'self'",
      "connect-src 'self'",
      "manifest-src 'self'",
      "worker-src 'none'",
    ].join('; '),
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };
  if (hsts) headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains';
  return headers;
}

function contentTypeFor(filePath) {
  return MIME_TYPES.get(extname(filePath).toLowerCase()) ?? 'application/octet-stream';
}

function shouldRevalidate(filePath, contentType) {
  return contentType.startsWith('text/html') || filePath.endsWith(`${sep}sw.js`) || filePath.endsWith('/sw.js');
}

function sendText(res, status, body, extraHeaders = {}) {
  const headers = {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders,
  };
  res.writeHead(status, headers);
  res.end(body);
}

function etagFor(info) {
  return `W/"${info.size.toString(16)}-${Math.floor(info.mtimeMs).toString(16)}"`;
}

function matchesEtag(header, etag) {
  if (!header) return false;
  return header
    .split(',')
    .map((value) => value.trim())
    .some((value) => value === '*' || value === etag || value === etag.replace(/^W\//, ''));
}

function notModifiedSince(header, mtimeMs) {
  if (!header) return false;
  const parsed = Date.parse(header);
  if (Number.isNaN(parsed)) return false;
  // HTTP dates have one-second precision.
  return Math.floor(mtimeMs / 1000) <= Math.floor(parsed / 1000);
}

export function createMarketingServer({
  rootDir = join(REPO_ROOT, 'dist/marketing'),
  basePath = '',
  hsts = false,
  assetCacheSeconds = 3600,
  csp,
} = {}) {
  const rootInput = resolve(rootDir);
  let rootReal;
  try {
    rootReal = realpathSync(rootInput);
  } catch {
    throw new Error(`marketing root does not exist: ${rootInput}`);
  }
  const normalizedBase = normalizeBasePath(basePath);
  const headers = securityHeaders({ hsts });
  if (csp) headers['Content-Security-Policy'] = csp;

  return createServer(async (req, res) => {
    for (const [name, value] of Object.entries(headers)) res.setHeader(name, value);

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      sendText(res, 405, 'Method not allowed\n', { Allow: 'GET, HEAD' });
      return;
    }

    let url;
    try {
      url = new URL(req.url ?? '/', 'http://localhost');
    } catch {
      sendText(res, 400, 'Bad request\n');
      return;
    }

    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      sendText(res, 400, 'Bad request\n');
      return;
    }

    if (pathname.includes('\0') || pathname.includes('\\')) {
      sendText(res, 400, 'Bad request\n');
      return;
    }

    if (normalizedBase) {
      if (pathname === normalizedBase) {
        res.writeHead(308, { Location: `${normalizedBase}/${url.search ?? ''}`, 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      if (!pathname.startsWith(`${normalizedBase}/`)) {
        sendText(res, 404, 'Not found\n');
        return;
      }
      pathname = pathname.slice(normalizedBase.length) || '/';
    }

    if (!pathname.startsWith('/')) {
      sendText(res, 404, 'Not found\n');
      return;
    }

    const segments = pathname.split('/').filter(Boolean);
    if (segments.some((segment) => segment === '.' || segment === '..' || segment.startsWith('.'))) {
      sendText(res, 404, 'Not found\n');
      return;
    }

    let filePath = resolve(rootReal, ...segments);
    if (!isInside(rootReal, filePath)) {
      sendText(res, 403, 'Forbidden\n');
      return;
    }

    let info;
    try {
      info = await stat(filePath);
    } catch {
      sendText(res, 404, 'Not found\n');
      return;
    }

    let servedDirectoryIndex = false;
    if (info.isDirectory()) {
      if (!pathname.endsWith('/')) {
        const location = `${normalizedBase}${pathname}/${url.search ?? ''}`;
        res.writeHead(308, { Location: location, 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      filePath = join(filePath, 'index.html');
      try {
        info = await stat(filePath);
      } catch {
        sendText(res, 404, 'Not found\n');
        return;
      }
      servedDirectoryIndex = true;
    }

    if (!info.isFile()) {
      sendText(res, 404, 'Not found\n');
      return;
    }
    if (pathname.endsWith('/') && !servedDirectoryIndex) {
      sendText(res, 404, 'Not found\n');
      return;
    }

    try {
      const realFile = realpathSync(filePath);
      if (!isInside(rootReal, realFile)) {
        sendText(res, 403, 'Forbidden\n');
        return;
      }
    } catch {
      sendText(res, 404, 'Not found\n');
      return;
    }

    const contentType = contentTypeFor(filePath);
    const revalidate = shouldRevalidate(filePath, contentType);
    const cacheControl = revalidate ? 'no-cache' : `public, max-age=${assetCacheSeconds}`;
    const etag = etagFor(info);
    const lastModified = new Date(info.mtimeMs).toUTCString();

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Length', String(info.size));
    res.setHeader('Cache-Control', cacheControl);
    res.setHeader('ETag', etag);
    res.setHeader('Last-Modified', lastModified);

    if (matchesEtag(req.headers['if-none-match'], etag) || notModifiedSince(req.headers['if-modified-since'], info.mtimeMs)) {
      res.statusCode = 304;
      res.removeHeader('Content-Length');
      res.end();
      return;
    }

    if (req.method === 'HEAD') {
      res.statusCode = 200;
      res.end();
      return;
    }

    res.statusCode = 200;
    const stream = createReadStream(filePath);
    stream.on('error', () => {
      if (!res.headersSent) sendText(res, 500, 'Internal server error\n');
      else res.destroy();
    });
    stream.pipe(res);
  });
}

function parseArgs(argv) {
  const options = {
    rootDir: process.env.MARKETING_DIR ?? join(REPO_ROOT, 'dist/marketing'),
    port: Number(process.env.MARKETING_PORT ?? process.env.PORT ?? 8092),
    host: process.env.MARKETING_HOST ?? process.env.HOST ?? '127.0.0.1',
    basePath: process.env.MARKETING_BASE_PATH ?? '',
    hsts: process.env.MARKETING_HSTS === '1',
    assetCacheSeconds: Number(process.env.MARKETING_ASSET_CACHE_SECONDS ?? 3600),
  };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dir' || arg === '--root') options.rootDir = argv[++index];
    else if (arg === '--port') options.port = Number(argv[++index]);
    else if (arg === '--host') options.host = argv[++index];
    else if (arg === '--base-path') options.basePath = argv[++index];
    else if (arg === '--hsts') options.hsts = true;
    else if (arg === '--asset-cache-seconds') options.assetCacheSeconds = Number(argv[++index]);
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('-')) throw new Error(`unknown argument: ${arg}`);
    else positional.push(arg);
  }
  if (positional.length > 0) options.rootDir = positional[0];
  if (positional.length > 1) options.port = Number(positional[1]);
  return options;
}

function printHelp() {
  console.log(`Usage: bun scripts/marketing/serve.mjs [dir] [options]

Serves a built marketing tree with a strict static-file policy. Defaults:
dir=dist/marketing, host=127.0.0.1, port=8092.

Options:
  --dir <dir>                 Directory to serve
  --port <port>               Port (0 picks a free port)
  --host <host>               Bind address (default: 127.0.0.1)
  --base-path <path>          Mount under a project path, e.g. /jcode-mobile
  --hsts                      Send Strict-Transport-Security (HTTPS only)
  --asset-cache-seconds <n>   Cache lifetime for non-HTML files (default: 3600)
  -h, --help                  Show this help

Environment:
  MARKETING_DIR, MARKETING_PORT, PORT, MARKETING_HOST, HOST,
  MARKETING_BASE_PATH, MARKETING_HSTS, MARKETING_ASSET_CACHE_SECONDS`);
}

const isMain = import.meta.main ?? (process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false);
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      const server = createMarketingServer(options);
      server.listen(options.port, options.host, () => {
        const address = server.address();
        const port = typeof address === 'object' && address ? address.port : options.port;
        console.log(`marketing: serving ${resolve(options.rootDir)} at http://${options.host}:${port}${normalizeBasePath(options.basePath)}/`);
      });
      const close = () => {
        server.close(() => process.exit(0));
      };
      process.on('SIGINT', close);
      process.on('SIGTERM', close);
    }
  } catch (error) {
    console.error(`marketing: serve failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
