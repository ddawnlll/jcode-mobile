import { createHash } from 'node:crypto';
import { mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'bun:test';
import { buildMarketingSite, MANIFEST_NAME } from './build.mjs';
import { createSiteFixture, FIXTURE_HTML } from './test-helpers.mjs';

async function withFixture(run) {
  const fixture = await createSiteFixture();
  try {
    return await run(fixture);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
}

function build(fixture, overrides = {}) {
  return buildMarketingSite({
    sourceDir: fixture.source,
    outDir: fixture.out,
    repoRoot: fixture.root,
    quiet: true,
    ...overrides,
  });
}

describe('marketing build', () => {
  test('copies the site verbatim and writes a deterministic manifest', async () => {
    await withFixture(async (fixture) => {
      const before = await readFile(join(fixture.source, 'index.html'), 'utf8');
      const result = await build(fixture);

      expect(result.manifest.entry).toBe('index.html');
      expect(result.manifest.productVersion).toBe('9.9.9');
      expect(result.manifest.fileCount).toBe(5);
      expect(result.manifest.files.map((file) => file.path)).toEqual([
        'assets/font.ttf',
        'assets/pixel.png',
        'index.html',
        'main.js',
        'styles.css',
      ]);

      const index = await readFile(join(fixture.out, 'index.html'), 'utf8');
      expect(index).toBe(before);
      for (const file of result.manifest.files) {
        const content = await readFile(join(fixture.out, file.path));
        expect(createHash('sha256').update(content).digest('hex')).toBe(file.sha256);
      }
      const manifestFile = await readFile(join(fixture.out, MANIFEST_NAME), 'utf8');
      expect(JSON.parse(manifestFile).schemaVersion).toBe(1);
    });
  });

  test('removes stale files from a previous build', async () => {
    await withFixture(async (fixture) => {
      await mkdir(fixture.out, { recursive: true });
      await writeFile(join(fixture.out, 'stale.txt'), 'stale', 'utf8');
      await build(fixture);
      await expect(readFile(join(fixture.out, 'stale.txt'))).rejects.toThrow();
    });
  });

  test('refuses a root-absolute asset URL', async () => {
    await withFixture(async (fixture) => {
      await writeFile(
        join(fixture.source, 'index.html'),
        FIXTURE_HTML.replace('href="styles.css"', 'href="/styles.css"'),
        'utf8',
      );
      await expect(build(fixture)).rejects.toThrow(/root-absolute URL/);
    });
  });

  test('refuses a missing local asset', async () => {
    await withFixture(async (fixture) => {
      await writeFile(
        join(fixture.source, 'index.html'),
        FIXTURE_HTML.replace('assets/pixel.png', 'assets/missing.png'),
        'utf8',
      );
      await expect(build(fixture)).rejects.toThrow(/missing image/);
    });
  });

  test('refuses remote runtime assets', async () => {
    await withFixture(async (fixture) => {
      await writeFile(
        join(fixture.source, 'index.html'),
        FIXTURE_HTML.replace('<script src="main.js" defer></script>', '<script src="https://cdn.example/x.js"></script>'),
        'utf8',
      );
      await expect(build(fixture)).rejects.toThrow(/remote script/);
    });

    await withFixture(async (fixture) => {
      await writeFile(
        join(fixture.source, 'styles.css'),
        'body { background: url("https://cdn.example/x.png"); }\n',
        'utf8',
      );
      await expect(build(fixture)).rejects.toThrow(/remote image/);
    });
  });

  test('permits product links but not arbitrary external anchors', async () => {
    await withFixture(async (fixture) => {
      const html = FIXTURE_HTML.replace(
        '<a href="#top">Back to top</a>',
        '<a href="https://example.com/">Elsewhere</a>',
      );
      await writeFile(join(fixture.source, 'index.html'), html, 'utf8');
      await expect(build(fixture)).rejects.toThrow(/remote anchor/);
    });
  });

  test('refuses an invented absolute canonical origin', async () => {
    await withFixture(async (fixture) => {
      const html = FIXTURE_HTML.replace(
        '</head>',
        '  <link rel="canonical" href="https://example.com/jcode-mobile/">\n</head>',
      );
      await writeFile(join(fixture.source, 'index.html'), html, 'utf8');
      await expect(build(fixture)).rejects.toThrow(/absolute canonical URL/);
    });
  });

  test('refuses duplicate ids and broken anchors', async () => {
    await withFixture(async (fixture) => {
      const html = FIXTURE_HTML.replace('<h1 id="top">', '<h1 id="top"><span id="top"></span>');
      await writeFile(join(fixture.source, 'index.html'), html, 'utf8');
      await expect(build(fixture)).rejects.toThrow(/duplicate ids: top/);
    });

    await withFixture(async (fixture) => {
      const html = FIXTURE_HTML.replace('href="#top"', 'href="#missing"');
      await writeFile(join(fixture.source, 'index.html'), html, 'utf8');
      await expect(build(fixture)).rejects.toThrow(/anchor "#missing"/);
    });
  });

  test('refuses a symlink that escapes the repository', async () => {
    await withFixture(async (fixture) => {
      const outside = join(tmpdir(), `jcode-marketing-outside-${process.pid}-${Date.now()}`);
      await mkdir(outside, { recursive: true });
      const outsideFile = join(outside, 'secret.txt');
      await writeFile(outsideFile, 'outside', 'utf8');
      try {
        await symlink(outsideFile, join(fixture.source, 'assets', 'escape.txt'));
        await expect(build(fixture)).rejects.toThrow(/symlink escapes the repository/);
      } catch (error) {
        if (error instanceof Error && /EPERM|EACCES|ENOTSUP/.test(error.message)) return;
        throw error;
      } finally {
        await rm(outside, { recursive: true, force: true });
      }
    });
  });

  test('refuses an output directory inside the source or repository root', async () => {
    await withFixture(async (fixture) => {
      await expect(
        buildMarketingSite({
          sourceDir: fixture.source,
          outDir: join(fixture.source, 'dist'),
          repoRoot: fixture.root,
          quiet: true,
        }),
      ).rejects.toThrow(/inside the website source/);

      await expect(
        buildMarketingSite({
          sourceDir: fixture.source,
          outDir: fixture.root,
          repoRoot: fixture.root,
          quiet: true,
        }),
      ).rejects.toThrow(/repository root/);
    });
  });

  test('allows data images and relative srcset candidates', async () => {
    await withFixture(async (fixture) => {
      const html = FIXTURE_HTML.replace(
        '<img src="assets/pixel.png" alt="">',
        '<img src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==" alt="" srcset="assets/pixel.png 1x">',
      );
      await writeFile(join(fixture.source, 'index.html'), html, 'utf8');
      const result = await build(fixture);
      expect(result.manifest.fileCount).toBe(5);
    });
  });
});
