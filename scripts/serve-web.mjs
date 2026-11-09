#!/usr/bin/env bun
/**
 * Static server for the exported web build.
 *
 * expo-sqlite's web driver uses SharedArrayBuffer, so the document must be
 * cross-origin isolated. A plain static host does not send these headers;
 * `expo start --web` does, and this server keeps the exported build equivalent.
 */
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'dist/web');
const port = Number(process.env.PORT ?? 8081);
const host = process.env.HOST ?? '127.0.0.1';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ttf': 'font/ttf',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.map': 'application/json; charset=utf-8',
};

const server = createServer((req, res) => {
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
  res.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  res.setHeader('Cache-Control', 'no-store');

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? host}`);
  const pathname = decodeURIComponent(url.pathname);
  let filePath = join(root, normalize(pathname).replace(/^(\.\.[/\\])+/, ''));

  if (!filePath.startsWith(root)) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (existsSync(filePath) && statSync(filePath).isDirectory()) {
    filePath = join(filePath, 'index.html');
  }
  if (!existsSync(filePath)) {
    // Single-page app fallback.
    filePath = join(root, 'index.html');
  }

  res.setHeader('Content-Type', TYPES[extname(filePath)] ?? 'application/octet-stream');
  createReadStream(filePath)
    .on('error', () => res.writeHead(500).end('Read error'))
    .pipe(res);
});

server.listen(port, host, () => {
  console.log(`serving ${root} at http://${host}:${port}`);
});
