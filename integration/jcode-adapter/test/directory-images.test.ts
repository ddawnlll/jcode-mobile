import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createDirectory, listDirectories } from '../src/directory.ts';
import { parseImages } from '../src/images.ts';
import { splitReasoningMarkup } from '../src/attachment.ts';
import { effortLadders, inferredEfforts } from '../src/efforts.ts';

test('directory listing stays inside canonical roots and hides dotfolders', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jcode-directory-'));
  const outside = await mkdtemp(join(tmpdir(), 'jcode-outside-'));
  try {
    await mkdir(join(root, 'alpha'));
    await mkdir(join(root, 'beta'));
    await mkdir(join(root, '.hidden'));
    await writeFile(join(root, 'file.txt'), 'not a folder');
    await symlink(outside, join(root, 'escape'));
    const result = await listDirectories([root], root, false, 0, 50);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.listing.parent, null);
    assert.deepEqual(
      result.listing.entries.map((entry) => entry.name),
      ['alpha', 'beta', 'escape'],
    );
    const escape = result.listing.entries.find((entry) => entry.name === 'escape');
    assert.equal(escape?.readable, false);
    const withHidden = await listDirectories([root], root, true, 0, 50);
    assert.equal(withHidden.ok, true);
    if (withHidden.ok) {
      assert.ok(withHidden.listing.entries.some((entry) => entry.name === '.hidden'));
    }
  } finally {
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
});

test('directory listing paginates and rejects files and path escapes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jcode-directory-page-'));
  try {
    for (const name of ['a', 'b', 'c']) await mkdir(join(root, name));
    const first = await listDirectories([root], root, false, 0, 2);
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.deepEqual(first.listing.entries.map((entry) => entry.name), ['a', 'b']);
    assert.equal(first.listing.cursor, '2');
    const second = await listDirectories([root], root, false, 2, 2);
    assert.equal(second.ok, true);
    if (second.ok) assert.deepEqual(second.listing.entries.map((entry) => entry.name), ['c']);
    const file = await listDirectories([root], join(root, 'missing'), false, 0, 2);
    assert.equal(file.ok, false);
    const escape = await listDirectories([root], '/etc', false, 0, 2);
    assert.equal(escape.ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('image tuples are bounded and media types are validated', () => {
  const tiny = 'iVBORw0KGgo=';
  const ok = parseImages([['image/png', tiny]]);
  assert.equal(ok.ok, true);
  if (ok.ok) assert.deepEqual(ok.images, [['image/png', tiny]]);
  assert.equal(parseImages([['image/svg+xml', tiny]]).ok, false);
  assert.equal(parseImages([['image/png', 'not base64!']]).ok, false);
  assert.equal(
    parseImages(Array.from({ length: 5 }, () => ['image/png', tiny])).ok,
    false,
  );
  assert.equal(parseImages('image/png').ok, false);
});

test('persisted reasoning markup is separated from assistant prose', () => {
  const split = splitReasoningMarkup(
    `*\u2063The user asks for E2E-OK.\\*No tools\\*.\u2063*  \nE2E-OK`,
  );
  assert.equal(split.reasoning, 'The user asks for E2E-OK.*No tools*.');
  assert.equal(split.content, 'E2E-OK');
});

test('ordinary Markdown keeps every byte when no reasoning wrapper exists', () => {
  const source = 'Intro\n\n\n    indented code\n\n\n- list\n';
  const split = splitReasoningMarkup(source);
  assert.equal(split.content, source);
  assert.equal(split.reasoning, '');
});

test('reasoning ladders follow the daemon model capabilities', () => {
  assert.deepEqual(inferredEfforts('anthropic', 'claude-sonnet-4-6'), [
    'none',
    'low',
    'medium',
    'high',
    'max',
    'swarm',
  ]);
  assert.deepEqual(inferredEfforts('anthropic', 'claude-opus-4-7'), [
    'none',
    'low',
    'medium',
    'high',
    'xhigh',
    'max',
    'swarm',
  ]);
  assert.deepEqual(inferredEfforts('anthropic', 'claude-3-5-sonnet'), []);
  assert.deepEqual(inferredEfforts('openrouter', 'anything'), [
    'none',
    'minimal',
    'low',
    'medium',
    'high',
    'xhigh',
    'swarm',
  ]);
  assert.deepEqual(effortLadders('anthropic', ['claude-sonnet-4-6', 'unknown']), {
    'claude-sonnet-4-6': ['none', 'low', 'medium', 'high', 'max', 'swarm'],
  });
});

test('folder creation stays inside a permitted root and refuses traversal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jcode-mkdir-'));
  try {
    const created = await createDirectory([root], root, 'new-project');
    assert.equal(created.ok, true);
    if (!created.ok) return;
    assert.equal(created.path, join(await realpath(root), 'new-project'));
    const again = await createDirectory([root], root, 'new-project');
    assert.equal(again.ok, false);
    const escape = await createDirectory([root], root, '../outside');
    assert.equal(escape.ok, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
