#!/usr/bin/env bun
/**
 * Build the static JCode Mobile marketing site.
 *
 * The build is intentionally boring: it copies `website/**` verbatim into an
 * output directory and refuses to publish a tree that depends on a server
 * rewrite, a CDN, or a root-absolute URL. That keeps the result portable to any
 * static host, including a GitHub Pages project path such as
 * `/jcode-mobile/`.
 *
 * Export `buildMarketingSite` for tests; run the file directly from Bun for the
 * CLI.
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(SCRIPT_DIR, '../..');
export const DEFAULT_SOURCE_DIR = join(REPO_ROOT, 'website');
export const DEFAULT_OUT_DIR = join(REPO_ROOT, 'dist/marketing');
export const MANIFEST_NAME = 'build-manifest.json';
export const MOTION_SOURCE_DIR = 'motion';
export const MOTION_BOOT_ENTRY = 'motion/boot.js';
export const MOTION_ENTRY_OUTPUT = 'assets/motion.js';

/** External navigations the marketing site is allowed to contain. Assets may
 * never be remote. Extend with MARKETING_ALLOWED_EXTERNAL_PREFIXES when a real
 * product URL is added deliberately. */
export const DEFAULT_ALLOWED_EXTERNAL_PREFIXES = Object.freeze([
  'https://github.com/ddawnlll/jcode-mobile',
  'https://github.com/1jehuang/jcode',
]);

const TEXT_EXTENSIONS = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg', '.xml', '.txt', '.webmanifest']);
const FONT_EXTENSIONS = new Set(['.ttf', '.otf', '.woff', '.woff2']);
const IGNORED_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'node_modules', '.git']);

const LOCAL_SCHEMES = new Set(['mailto', 'tel']);
const IMAGE_DATA_PREFIX = 'data:image/';

function isMotionSource(relativePath) {
  return relativePath === MOTION_SOURCE_DIR || relativePath.startsWith(`${MOTION_SOURCE_DIR}/`);
}

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel));
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&#x0*27;/gi, "'")
    .replace(/&#x0*2f;/gi, '/')
    .replace(/&#0*47;/g, '/')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

function stripCssComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '');
}

function stripInlineCode(html) {
  return html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
}

function collectMarkupIds(html) {
  return collectHtmlIds(stripInlineCode(stripHtmlComments(html)));
}

function getAllowedExternalPrefixes(extra) {
  const fromEnv = (process.env.MARKETING_ALLOWED_EXTERNAL_PREFIXES ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  return [...new Set([...DEFAULT_ALLOWED_EXTERNAL_PREFIXES, ...fromEnv, ...(extra ?? [])])];
}

function isAllowedExternalUrl(raw, prefixes) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:') return false;
  return prefixes.some((prefix) => {
    const normalized = prefix.replace(/\/+$/, '');
    return raw === normalized || raw.startsWith(`${normalized}/`) || raw.startsWith(`${normalized}?`) || raw.startsWith(`${normalized}#`);
  });
}

function splitUrl(raw) {
  const hashIndex = raw.indexOf('#');
  const hash = hashIndex >= 0 ? raw.slice(hashIndex + 1) : '';
  const withoutHash = hashIndex >= 0 ? raw.slice(0, hashIndex) : raw;
  const queryIndex = withoutHash.indexOf('?');
  const path = queryIndex >= 0 ? withoutHash.slice(0, queryIndex) : withoutHash;
  return { path, hash };
}

function parseAttributes(source) {
  const attributes = new Map();
  const attributePattern = /([:\w-]+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+))?/g;
  let match;
  while ((match = attributePattern.exec(source)) !== null) {
    const name = match[1].toLowerCase();
    const raw = match[2] ?? '';
    const value = raw.startsWith('"') || raw.startsWith("'") ? raw.slice(1, -1) : raw;
    attributes.set(name, decodeHtmlEntities(value));
  }
  return attributes;
}

function walkSourceFiles(root, repoRoot) {
  return (async () => {
    const files = [];
    const visitedDirectories = new Set();

    async function walk(directory, relativeDirectory) {
      let realDirectory;
      try {
        realDirectory = await realpath(directory);
      } catch {
        throw new Error(`cannot resolve directory: ${directory}`);
      }
      if (visitedDirectories.has(realDirectory)) return;
      visitedDirectories.add(realDirectory);

      const entries = await readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (IGNORED_NAMES.has(entry.name)) continue;
        const absolute = join(directory, entry.name);
        const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
        const linkInfo = await lstat(absolute);

        if (linkInfo.isSymbolicLink()) {
          const target = await realpath(absolute);
          if (!isInside(repoRoot, target)) {
            throw new Error(`symlink escapes the repository: ${relativePath} -> ${target}`);
          }
          const targetInfo = await stat(target);
          if (targetInfo.isDirectory()) {
            await walk(absolute, relativePath);
          } else if (targetInfo.isFile()) {
            files.push({ relativePath, absolute, realPath: target, size: targetInfo.size });
          } else {
            throw new Error(`unsupported symlink target: ${relativePath}`);
          }
          continue;
        }

        if (linkInfo.isDirectory()) {
          await walk(absolute, relativePath);
        } else if (linkInfo.isFile()) {
          files.push({ relativePath, absolute, realPath: absolute, size: linkInfo.size });
        } else {
          throw new Error(`unsupported file type: ${relativePath}`);
        }
      }
    }

    await walk(root, '');
    return files;
  })();
}

function collectHtmlIds(html) {
  const ids = new Set();
  const pattern = /\bid\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+)/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const raw = match[1].startsWith('"') || match[1].startsWith("'") ? match[1].slice(1, -1) : match[1];
    if (raw) ids.add(decodeHtmlEntities(raw));
  }
  return ids;
}

function findDuplicateIds(html) {
  const counts = new Map();
  const pattern = /\bid\s*=\s*("[^"]*"|'[^']*'|[^\s"'=<>`]+)/g;
  let match;
  while ((match = pattern.exec(html)) !== null) {
    const raw = match[1].startsWith('"') || match[1].startsWith("'") ? match[1].slice(1, -1) : match[1];
    if (!raw) continue;
    const id = decodeHtmlEntities(raw);
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
}

function countElements(html, tagName) {
  const pattern = new RegExp(`<${tagName}(?:\\s|>)`, 'gi');
  return (html.match(pattern) ?? []).length;
}

function makeReferenceContext({ sourceFiles, htmlIds, allowedExternalPrefixes, htmlPath = null, ids = null }) {
  const sourceSet = new Set(sourceFiles.map((file) => file.relativePath));

  function resolveLocalPath(rawPath, fromPath) {
    let decoded;
    try {
      decoded = decodeURIComponent(rawPath);
    } catch {
      throw new Error(`invalid percent-encoding in "${rawPath}" (from ${fromPath})`);
    }
    if (decoded.includes('\0') || decoded.includes('\\')) {
      throw new Error(`unsafe path "${rawPath}" (from ${fromPath})`);
    }
    if (decoded.startsWith('/')) {
      throw new Error(`root-absolute URL "${rawPath}" in ${fromPath}; use a relative path for GitHub Pages project hosting`);
    }
    const resolved = posix.normalize(posix.join(posix.dirname(fromPath), decoded));
    if (resolved === '..' || resolved.startsWith('../')) {
      throw new Error(`path escapes the site root: "${rawPath}" (from ${fromPath})`);
    }
    return resolved === '.' ? '' : resolved;
  }

  function checkAnchor(targetPath, hash, fromPath, anchorIds) {
    if (!hash) return;
    let fragment;
    try {
      fragment = decodeURIComponent(hash);
    } catch {
      throw new Error(`invalid anchor encoding in ${fromPath}`);
    }
    if (!fragment) return;
    const targetIds = targetPath === fromPath ? anchorIds : htmlIds.get(targetPath);
    if (!targetIds) return;
    if (!targetIds.has(fragment)) {
      throw new Error(`anchor "#${fragment}" has no matching id in ${targetPath || fromPath}`);
    }
  }

  function validateReference(rawValue, fromPath, kind, anchorIds) {
    const raw = rawValue.trim();
    if (!raw || raw === '#') return;
    if (raw.startsWith('#')) {
      checkAnchor(fromPath, raw.slice(1), fromPath, anchorIds);
      return;
    }

    const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(raw);
    if (schemeMatch) {
      const scheme = schemeMatch[1].toLowerCase();
      if (kind === 'anchor' && LOCAL_SCHEMES.has(scheme)) return;
      if (scheme === 'data') {
        if (kind === 'image' && raw.toLowerCase().startsWith(IMAGE_DATA_PREFIX)) return;
        if (kind === 'font') return;
        throw new Error(`unsupported data: URL for ${kind} in ${fromPath}`);
      }
      if (scheme === 'blob') {
        if (kind === 'image' || kind === 'media') return;
        throw new Error(`unsupported blob: URL for ${kind} in ${fromPath}`);
      }
      if (scheme === 'http' || scheme === 'https') {
        if (kind === 'anchor' && isAllowedExternalUrl(raw, allowedExternalPrefixes)) return;
        throw new Error(
          `remote ${kind} "${raw}" in ${fromPath}; runtime assets must be local. ` +
            'Only product links may be external.',
        );
      }
      throw new Error(`unsupported URL scheme "${scheme}:" in ${fromPath}`);
    }

    if (raw.startsWith('//')) {
      throw new Error(`protocol-relative ${kind} "${raw}" in ${fromPath}; runtime assets must be local`);
    }

    const { path: rawPath, hash } = splitUrl(raw);
    const targetPath = resolveLocalPath(rawPath, fromPath);
    if (targetPath && !sourceSet.has(targetPath) && !sourceSet.has(`${targetPath}/index.html`)) {
      throw new Error(`missing ${kind} "${rawPath}" referenced by ${fromPath}`);
    }
    if (targetPath && targetPath.endsWith('.html')) {
      checkAnchor(targetPath, hash, fromPath, anchorIds);
    }
  }

  return { validateReference, resolveLocalPath };
}

function validateCss(cssText, fromPath, validateReference, context) {
  const css = stripCssComments(cssText);
  const importPattern = /@import\s+(?:url\(\s*)?(?:'([^']*)'|"([^"]*)"|([^'")]+))/gi;
  let match;
  while ((match = importPattern.exec(css)) !== null) {
    validateReference(match[1] ?? match[2] ?? match[3], fromPath, 'stylesheet', context.anchorIds);
  }

  const urlPattern = /url\(\s*(?:'([^']*)'|"([^"]*)"|([^)'"]*))\s*\)/gi;
  while ((match = urlPattern.exec(css)) !== null) {
    const raw = (match[1] ?? match[2] ?? match[3] ?? '').trim();
    if (raw.startsWith('#')) continue;
    let kind = 'asset';
    if (raw.toLowerCase().startsWith(IMAGE_DATA_PREFIX)) kind = 'image';
    else if (raw.toLowerCase().startsWith('data:font/')) kind = 'font';
    else if (FONT_EXTENSIONS.has(extname(splitUrl(raw).path).toLowerCase())) kind = 'font';
    else if (/\.(png|jpe?g|gif|webp|avif|svg|ico)$/i.test(splitUrl(raw).path)) kind = 'image';
    else if (/\.(mp4|webm|mov|m4v)$/i.test(splitUrl(raw).path)) kind = 'media';
    validateReference(raw, fromPath, kind, context.anchorIds);
  }
}

function validateJavaScript(script, fromPath, context) {
  if (context.generated) {
    // Bundled vendor output (GSAP, React, Framer Motion) contains documentation
    // URLs and namespace strings. It must still ship no source map and no
    // remote runtime load. The CSP and the request-log e2e test enforce the
    // network boundary at runtime.
    if (/\/\/[#@]\s*sourceMappingURL=/.test(script)) {
      throw new Error(`generated bundle ${fromPath} must not reference a source map`);
    }
    const remoteLoad =
      /\b(?:import|importScripts)\s*\(\s*['"`](?:https?:)?\/\//.test(script) ||
      /\.src\s*=\s*['"`](?:https?:)?\/\//.test(script);
    if (remoteLoad) {
      throw new Error(`generated bundle ${fromPath} loads a remote runtime asset`);
    }
    return;
  }

  const rootAbsolutePatterns = [
    /\b(?:src|href|poster)\s*=\s*['"`]\/(?!\/)/g,
    /\b(?:fetch|import|importScripts|open)\s*\(\s*['"`]\/(?!\/)/g,
    /\bnew\s+URL\s*\(\s*['"`]\/(?!\/)/g,
  ];
  for (const pattern of rootAbsolutePatterns) {
    if (pattern.test(script)) {
      throw new Error(`root-absolute URL in JavaScript ${fromPath}; use a relative path`);
    }
  }

  const remoteRuntimePatterns = [
    /\b(?:fetch|import|importScripts)\s*\(\s*['"`](https?:\/\/[^'"`]+)/g,
    /\.src\s*=\s*['"`](https?:\/\/[^'"`]+)/g,
  ];
  for (const pattern of remoteRuntimePatterns) {
    let match;
    while ((match = pattern.exec(script)) !== null) {
      throw new Error(`remote runtime request "${match[1]}" in ${fromPath}; runtime assets must be local`);
    }
  }

  // A static HTML page should not need runtime navigation built in strings, but
  // permit explicitly allowed product links so a small enhancement may update
  // the CTA without a build rewrite.
  const remoteStrings = /['"`](https?:\/\/[^'"`]+)['"`]/g;
  let match;
  while ((match = remoteStrings.exec(script)) !== null) {
    if (!isAllowedExternalUrl(match[1], context.allowedExternalPrefixes)) {
      throw new Error(`external URL "${match[1]}" in JavaScript ${fromPath} is not an approved product link`);
    }
  }
}

function validateHtml(html, htmlPath, sourceFiles, htmlIds, allowedExternalPrefixes) {
  const clean = stripHtmlComments(html);
  const markup = stripInlineCode(clean);
  const duplicateIds = findDuplicateIds(markup);
  if (duplicateIds.length > 0) {
    throw new Error(`${htmlPath} has duplicate ids: ${duplicateIds.join(', ')}`);
  }
  const ids = collectHtmlIds(markup);
  const context = { sourceFiles, htmlIds, allowedExternalPrefixes, htmlPath, ids: ids };
  const { validateReference } = makeReferenceContext(context);

  const langMatch = /<html\b[^>]*\blang\s*=\s*["']([^"']+)["']/i.exec(clean);
  if (!langMatch || !langMatch[1].trim()) throw new Error(`${htmlPath} must declare <html lang="...">`);

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(clean);
  if (!titleMatch || !titleMatch[1].replace(/<[^>]*>/g, '').trim()) {
    throw new Error(`${htmlPath} must have a non-empty <title>`);
  }

  const descriptionMatch = /<meta\b[^>]*\bname\s*=\s*["']description["'][^>]*\bcontent\s*=\s*["']([^"']*)["']/i.exec(clean) ??
    /<meta\b[^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*\bname\s*=\s*["']description["']/i.exec(clean);
  if (!descriptionMatch || !descriptionMatch[1].trim()) {
    throw new Error(`${htmlPath} must have a meta description`);
  }

  const viewportMatch = /<meta\b[^>]*\bname\s*=\s*["']viewport["']/i.exec(clean);
  if (!viewportMatch) throw new Error(`${htmlPath} must declare a viewport meta tag`);

  if (countElements(markup, 'h1') !== 1) {
    throw new Error(`${htmlPath} must contain exactly one <h1>`);
  }
  if (countElements(markup, 'main') !== 1) {
    throw new Error(`${htmlPath} must contain exactly one <main> landmark`);
  }
  if (/<base\b/i.test(markup)) {
    throw new Error(`${htmlPath} must not use <base>; relative URLs are required for project hosting`);
  }

  const tagPattern = /<([a-zA-Z][\w:-]*)((?:\s+[:\w-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
  let tag;
  while ((tag = tagPattern.exec(clean)) !== null) {
    const tagName = tag[1].toLowerCase();
    if (tagName === 'style') continue;
    const attributes = parseAttributes(tag[2]);

    if (attributes.has('style')) {
      validateCss(attributes.get('style'), htmlPath, validateReference, context);
    }

    for (const attributeName of ['src', 'poster', 'data']) {
      if (!attributes.has(attributeName)) continue;
      let kind = 'asset';
      if (tagName === 'img' || tagName === 'image') kind = 'image';
      else if (tagName === 'script') kind = 'script';
      else if (tagName === 'video' || tagName === 'audio' || tagName === 'track') kind = 'media';
      validateReference(attributes.get(attributeName), htmlPath, kind, context.ids);
    }

    if (attributes.has('srcset')) {
      const srcset = attributes.get('srcset');
      for (const candidate of srcset.split(',')) {
        const value = candidate.trim().split(/\s+/)[0];
        if (!value) continue;
        validateReference(value, htmlPath, 'image', context.ids);
      }
    }
    if (attributes.has('imagesrcset')) {
      for (const candidate of attributes.get('imagesrcset').split(',')) {
        const value = candidate.trim().split(/\s+/)[0];
        if (value) validateReference(value, htmlPath, 'image', context.ids);
      }
    }

    if (tagName === 'a' && attributes.has('href')) {
      validateReference(attributes.get('href'), htmlPath, 'anchor', context.ids);
    } else if (attributes.has('href')) {
      const rel = (attributes.get('rel') ?? '').toLowerCase();
      if (rel === 'canonical') {
        const href = attributes.get('href').trim();
        if (/^https?:/i.test(href)) {
          throw new Error(
            `${htmlPath} has an absolute canonical URL (${href}); deployment origin is not part of this static build`,
          );
        }
        validateReference(href, htmlPath, 'canonical', context.ids);
      } else if (rel === 'stylesheet' || rel === 'preload' || rel === 'modulepreload' || rel === 'manifest' || rel === 'icon' || rel === 'apple-touch-icon' || rel === 'mask-icon') {
        validateReference(attributes.get('href'), htmlPath, rel === 'stylesheet' ? 'stylesheet' : 'asset', context.ids);
      } else if (attributes.get('href').trim()) {
        validateReference(attributes.get('href'), htmlPath, 'asset', context.ids);
      }
    }

    for (const attributeName of ['action', 'formaction']) {
      if (attributes.has(attributeName)) {
        throw new Error(`<${tagName} ${attributeName}> is not supported in a static marketing page`);
      }
    }

    if (tagName === 'meta') {
      const property = (attributes.get('property') ?? attributes.get('name') ?? '').toLowerCase();
      if (['og:image', 'og:url', 'twitter:image'].includes(property) && attributes.has('content')) {
        const value = attributes.get('content').trim();
        if (/^https?:/i.test(value)) {
          throw new Error(
            `${htmlPath} has an absolute ${property} URL (${value}); inject a deployment origin instead`,
          );
        }
        validateReference(value, htmlPath, 'image', context.ids);
      }
    }
  }

  const stylePattern = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let styleMatch;
  while ((styleMatch = stylePattern.exec(clean)) !== null) {
    validateCss(styleMatch[1], htmlPath, validateReference, context);
  }

  const scriptPattern = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
  let scriptMatch;
  while ((scriptMatch = scriptPattern.exec(clean)) !== null) {
    const attributes = parseAttributes(scriptMatch[1]);
    const type = (attributes.get('type') ?? '').toLowerCase();
    if (type.includes('json')) continue;
    if (!attributes.has('src') && scriptMatch[2].trim()) {
      validateJavaScript(scriptMatch[2], htmlPath, {
        ...context,
        allowedExternalPrefixes,
      });
    }
  }

  return { ids, title: titleMatch[1].replace(/<[^>]*>/g, '').trim(), description: descriptionMatch[1].trim() };
}

async function validateSite({ sourceFiles, allowedExternalPrefixes }) {
  const htmlFiles = sourceFiles.filter((file) => /\.html?$/i.test(file.relativePath));
  if (htmlFiles.length === 0) throw new Error('website has no HTML entry point');

  const htmlIds = new Map();
  const texts = new Map();
  for (const file of sourceFiles) {
    if (!TEXT_EXTENSIONS.has(extname(file.relativePath).toLowerCase())) continue;
    const content = await readFile(file.realPath, 'utf8');
    texts.set(file.relativePath, content);
    if (/\.html?$/i.test(file.relativePath)) {
      htmlIds.set(file.relativePath, collectMarkupIds(content));
    }
  }

  const entryPath = 'index.html';
  if (!htmlIds.has(entryPath)) throw new Error('website/index.html is required');

  for (const file of sourceFiles) {
    const extension = extname(file.relativePath).toLowerCase();
    if (extension === '.html' || extension === '.htm') {
      validateHtml(texts.get(file.relativePath), file.relativePath, sourceFiles, htmlIds, allowedExternalPrefixes);
    } else if (extension === '.css') {
      const context = { sourceFiles, htmlIds, allowedExternalPrefixes, htmlPath: null, ids: new Set() };
      const { validateReference } = makeReferenceContext(context);
      validateCss(texts.get(file.relativePath), file.relativePath, validateReference, context);
    } else if (extension === '.js' || extension === '.mjs') {
      const context = { sourceFiles, htmlIds, allowedExternalPrefixes, htmlPath: null, ids: new Set() };
      validateJavaScript(texts.get(file.relativePath), file.relativePath, {
        ...context,
        generated: Boolean(file.generated),
      });
    }
  }

  return {
    entry: entryPath,
    htmlIds,
    texts,
    htmlFileCount: htmlFiles.length,
  };
}

async function hashFile(path) {
  const data = await readFile(path);
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Bundle the motion island with Bun. The entry ships as `assets/motion.js`;
 * the split Framer Motion chunk carries a content hash. Vendor output is
 * minified, source-map free, and never fetched from a CDN.
 */
async function bundleMotion(sourceDir) {
  const entry = join(sourceDir, MOTION_BOOT_ENTRY);
  if (!existsSync(entry)) return { files: [], tempDir: null };
  const bun = globalThis.Bun;
  if (!bun || typeof bun.build !== 'function') {
    throw new Error('motion bundling requires Bun');
  }

  const tempDir = await mkdtemp(join(tmpdir(), 'jcode-marketing-motion-'));
  let result;
  try {
    result = await bun.build({
      entrypoints: [entry],
      target: 'browser',
      format: 'esm',
      minify: true,
      splitting: true,
      sourcemap: 'none',
      define: { 'process.env.NODE_ENV': '"production"' },
      outdir: tempDir,
      naming: {
        entry: MOTION_ENTRY_OUTPUT,
        chunk: 'assets/[name]-[hash].js',
      },
    });
  } catch (error) {
    await rm(tempDir, { recursive: true, force: true });
    throw new Error(`motion bundle failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!result.success) {
    await rm(tempDir, { recursive: true, force: true });
    const details = result.logs
      .map((log) => (typeof log === 'string' ? log : log.message ?? String(log)))
      .join('\n');
    throw new Error(`motion bundle failed:\n${details}`);
  }

  const files = result.outputs
    .filter((output) => output.kind === 'entry-point' || output.kind === 'chunk')
    .map((output) => ({
      relativePath: relative(tempDir, output.path).split(sep).join('/'),
      absolute: output.path,
      realPath: output.path,
      size: output.size,
      generated: true,
    }))
    .sort((a, b) => a.relativePath.localeCompare(b.relativePath));

  if (!files.some((file) => file.relativePath === MOTION_ENTRY_OUTPUT)) {
    await rm(tempDir, { recursive: true, force: true });
    throw new Error(`motion bundle did not produce ${MOTION_ENTRY_OUTPUT}`);
  }

  return { files, tempDir };
}

function assertSafeOutput({ sourceDir, outDir, repoRoot, allowOutsideRepo }) {
  const source = resolve(sourceDir);
  const out = resolve(outDir);
  const repo = resolve(repoRoot);

  if (!allowOutsideRepo && !isInside(repo, out)) {
    throw new Error(`refusing to write outside the repository: ${out}`);
  }
  if (out === repo) throw new Error('refusing to use the repository root as the marketing output');
  if (out === resolve('/') || out === resolve(process.env.HOME ?? '/')) {
    throw new Error(`refusing to clean unsafe output directory: ${out}`);
  }
  if (out === source || isInside(out, source)) {
    throw new Error('refusing to clean an output directory that contains the website source');
  }
  if (isInside(source, out)) {
    throw new Error('refusing to write the output inside the website source');
  }
}

export async function buildMarketingSite(options = {}) {
  const {
    sourceDir = DEFAULT_SOURCE_DIR,
    outDir = DEFAULT_OUT_DIR,
    repoRoot = REPO_ROOT,
    allowOutsideRepo = false,
    quiet = false,
    allowedExternalPrefixes = [],
  } = options;

  const source = resolve(sourceDir);
  const out = resolve(outDir);
  const repo = resolve(repoRoot);

  if (!existsSync(join(source, 'index.html'))) {
    throw new Error(`marketing source is missing index.html: ${source}`);
  }
  const sourceInfo = await stat(source);
  if (!sourceInfo.isDirectory()) throw new Error(`marketing source is not a directory: ${source}`);

  assertSafeOutput({ sourceDir: source, outDir: out, repoRoot: repo, allowOutsideRepo });

  const externalPrefixes = getAllowedExternalPrefixes(allowedExternalPrefixes);
  const sourceFiles = (await walkSourceFiles(source, repo)).filter(
    (file) => !isMotionSource(file.relativePath),
  );
  const motion = await bundleMotion(source);

  let manifests;
  let totalBytes;
  let checks;
  try {
    const allFiles = [...sourceFiles, ...motion.files];
    checks = await validateSite({ sourceFiles: allFiles, allowedExternalPrefixes: externalPrefixes });

    await rm(out, { recursive: true, force: true });
    await mkdir(out, { recursive: true });

    for (const file of allFiles) {
      const destination = join(out, file.relativePath);
      await mkdir(dirname(destination), { recursive: true });
      await cp(file.realPath, destination);
    }

    manifests = [];
    totalBytes = 0;
    for (const file of allFiles) {
      const destination = join(out, file.relativePath);
      const info = await stat(destination);
      totalBytes += info.size;
      manifests.push({
        path: file.relativePath,
        bytes: info.size,
        sha256: await hashFile(destination),
      });
    }
    manifests.sort((a, b) => a.path.localeCompare(b.path));
  } finally {
    if (motion.tempDir) await rm(motion.tempDir, { recursive: true, force: true });
  }

  let productVersion = null;
  try {
    const packageJson = JSON.parse(await readFile(join(repo, 'package.json'), 'utf8'));
    productVersion = typeof packageJson.version === 'string' ? packageJson.version : null;
  } catch {
    productVersion = null;
  }

  const manifest = {
    schemaVersion: 1,
    generator: 'scripts/marketing/build.mjs',
    entry: checks.entry,
    productVersion,
    basePath: '.',
    fileCount: manifests.length,
    totalBytes,
    files: manifests,
    motion: motion.files.length
      ? {
          entry: MOTION_ENTRY_OUTPUT,
          files: motion.files.map((file) => file.relativePath),
          bytes: motion.files.reduce((sum, file) => sum + file.size, 0),
        }
      : null,
  };
  await writeFile(join(out, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

  if (!quiet) {
    const kib = (totalBytes / 1024).toFixed(1);
    console.log(`marketing: built ${manifests.length} files (${kib} KiB) -> ${relative(process.cwd(), out) || out}`);
    console.log(`marketing: entry ${checks.entry}; manifest ${MANIFEST_NAME}`);
  }

  return { outDir: out, manifest, checks, sourceFiles };
}

function parseArgs(argv) {
  const options = {
    sourceDir: process.env.MARKETING_SOURCE_DIR ?? DEFAULT_SOURCE_DIR,
    outDir: process.env.MARKETING_OUT_DIR ?? DEFAULT_OUT_DIR,
    allowOutsideRepo: false,
    quiet: false,
  };
  const positional = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--source' || arg === '--src') {
      options.sourceDir = argv[++index];
    } else if (arg === '--out' || arg === '--output') {
      options.outDir = argv[++index];
    } else if (arg === '--allow-outside-repo') {
      options.allowOutsideRepo = true;
    } else if (arg === '--quiet') {
      options.quiet = true;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else if (arg.startsWith('-')) {
      throw new Error(`unknown argument: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 0) options.sourceDir = positional[0];
  if (positional.length > 1) options.outDir = positional[1];
  return options;
}

function printHelp() {
  console.log(`Usage: bun scripts/marketing/build.mjs [source] [out] [options]

Copies the static marketing site into a self-contained output tree and writes
build-manifest.json. Refuses root-absolute URLs, missing local assets, remote
runtime assets, and invented canonical origins.

Options:
  --source <dir>          Source directory (default: website)
  --out <dir>             Output directory (default: dist/marketing)
  --allow-outside-repo    Permit an output directory outside the repo (tests)
  --quiet                 Suppress the summary
  -h, --help              Show this help

Environment:
  MARKETING_SOURCE_DIR
  MARKETING_OUT_DIR
  MARKETING_ALLOWED_EXTERNAL_PREFIXES  Comma-separated extra https prefixes`);
}

const isMain = import.meta.main ?? (process.argv[1] ? resolve(process.argv[1]) === fileURLToPath(import.meta.url) : false);
if (isMain) {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
    } else {
      await buildMarketingSite(options);
    }
  } catch (error) {
    console.error(`marketing: build failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
