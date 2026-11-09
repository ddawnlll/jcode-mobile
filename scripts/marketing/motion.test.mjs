import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import {
  buildMarketingSite,
  DEFAULT_SOURCE_DIR,
  MOTION_ENTRY_OUTPUT,
  REPO_ROOT,
} from './build.mjs';

let root;
let first;
let second;

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'jcode-marketing-motion-test-'));
  first = await buildMarketingSite({
    sourceDir: DEFAULT_SOURCE_DIR,
    outDir: join(root, 'one'),
    repoRoot: REPO_ROOT,
    allowOutsideRepo: true,
    quiet: true,
  });
  second = await buildMarketingSite({
    sourceDir: DEFAULT_SOURCE_DIR,
    outDir: join(root, 'two'),
    repoRoot: REPO_ROOT,
    allowOutsideRepo: true,
    quiet: true,
  });
});

afterAll(async () => {
  if (root) await rm(root, { recursive: true, force: true });
});

async function bundleText(name) {
  return readFile(join(first.outDir, name), 'utf8');
}

describe('marketing motion bundle', () => {
  test('emits a local GSAP entry and a split Framer Motion chunk', async () => {
    expect(first.manifest.motion).not.toBeNull();
    expect(first.manifest.motion.entry).toBe(MOTION_ENTRY_OUTPUT);
    const paths = first.manifest.motion.files;
    expect(paths).toContain(MOTION_ENTRY_OUTPUT);
    expect(paths.some((path) => /^assets\/island-[a-z0-9]+\.js$/.test(path))).toBe(true);
    expect(paths.some((path) => /^assets\/boot-[a-z0-9]+\.js$/.test(path))).toBe(true);

    for (const path of paths) {
      expect(first.manifest.files.some((file) => file.path === path), path).toBe(true);
    }

    const entry = await bundleText(MOTION_ENTRY_OUTPUT);
    expect(entry).toContain('gsap');
    expect(entry).toContain('__jcodeMotion');

    const islandPath = paths.find((path) => path.includes('/island-'));
    const island = await bundleText(islandPath);
    expect(island).toContain('data-framer-motion');
    expect(island).toContain('scene-caption');
  });

  test('ships no source maps, CDN hosts, or un-bundled motion sources', async () => {
    expect(first.manifest.files.some((file) => file.path.startsWith('motion/'))).toBe(false);
    expect(first.manifest.files.some((file) => file.path.endsWith('.jsx'))).toBe(false);

    for (const path of first.manifest.motion.files) {
      const source = await bundleText(path);
      expect(source, path).not.toContain('sourceMappingURL');
      expect(source, path).not.toMatch(/cdn\.|unpkg\.com|jsdelivr\.net|esm\.sh/);
    }
  });

  test('is byte-for-byte deterministic across consecutive builds', () => {
    expect(second.manifest.files).toEqual(first.manifest.files);
    expect(second.manifest.motion).toEqual(first.manifest.motion);
    expect(second.manifest.totalBytes).toBe(first.manifest.totalBytes);
  });

  test('keeps the hero entry smaller than the lazy island chunk', () => {
    const entry = first.manifest.files.find((file) => file.path === MOTION_ENTRY_OUTPUT);
    const island = first.manifest.files.find((file) => /assets\/island-.*\.js$/.test(file.path));
    expect(entry.bytes).toBeGreaterThan(20_000);
    expect(entry.bytes).toBeLessThan(250_000);
    expect(island.bytes).toBeGreaterThan(entry.bytes);
    expect(first.manifest.motion.bytes).toBeLessThan(900_000);
  });
});
