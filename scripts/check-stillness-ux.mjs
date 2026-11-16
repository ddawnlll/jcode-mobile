#!/usr/bin/env node
/**
 * Runner-free checks for the pure Stillness 0.4 UI helpers.
 *
 * Run with: node scripts/check-stillness-ux.mjs
 * Node strips TypeScript types natively; these modules are type-only imports
 * so no bundler or test runner is needed.
 */
import assert from 'node:assert/strict';
import './check-tool-status.mjs';
import {
  analyzeToolOutput,
  classifyDiffLine,
  diffStats,
  describeToolCall,
  groupHistory,
  looksLikeDiff,
  partialJsonString,
  pathParts,
  redactSecrets,
  stripAnsi,
  toolIntent,
} from '../apps/stillness/src/lib/toolLabels.ts';
import {
  filterModelRoutes,
  groupByProvider,
  modelRoutePool,
  providerChips,
  routeKey,
} from '../apps/stillness/src/lib/modelSearch.ts';
import { AdapterClient } from '../apps/stillness/src/lib/adapter.ts';
import { orderedTimeline } from '../apps/stillness/src/lib/timelineJournal.ts';
import { confirmedSessionTitle } from '../apps/stillness/src/lib/format.ts';
import {
  favoriteView,
  sessionFavorite,
  sessionIsArchived,
  sortSessions,
  visibleSessions,
} from '../apps/stillness/src/lib/sessionPrefs.ts';
import {
  MAX_IMAGE_BYTES,
  validateImage,
} from '../apps/stillness/src/lib/attachmentRules.ts';
import {
  deepLinkIntent,
  sessionIdFromUrl,
  sharePlan,
} from '../apps/stillness/src/lib/nativeIntents.ts';
import {
  hasPendingShare,
  holdPendingShare,
  takePendingShare,
} from '../apps/stillness/src/lib/pendingShare.ts';
import {
  normalizeMotionPreference,
  resolveMotion,
} from '../apps/stillness/src/lib/motionPrefs.ts';

let checks = 0;
function check(name, fn) {
  fn();
  checks += 1;
  console.log(`ok ${checks} - ${name}`);
}

check('tool intents map common names', () => {
  assert.equal(toolIntent('bash'), 'Run command');
  assert.equal(toolIntent('read_file'), 'Read file');
  assert.equal(toolIntent('edit'), 'Edit file');
  assert.equal(toolIntent('grep'), 'Search code');
  assert.equal(toolIntent('web_search'), 'Search web');
  assert.equal(toolIntent('todo_write'), 'Update plan');
  assert.equal(toolIntent('mystery_tool'), 'mystery tool');
});

check('tool args produce an observed summary and keep the raw name', () => {
  const bash = describeToolCall('bash', JSON.stringify({ command: 'bun run build' }));
  assert.equal(bash.label, 'Run command');
  assert.equal(bash.summary, 'bun run build');
  assert.equal(bash.raw, 'bash');

  const edit = describeToolCall('edit', JSON.stringify({ file_path: '/repo/a.ts' }));
  assert.equal(edit.label, 'Edit file');
  assert.equal(edit.summary, 'a.ts');
  assert.equal(edit.basename, 'a.ts');
  assert.equal(edit.path, '/repo/a.ts');

  const unavailable = describeToolCall('read', 'not json');
  assert.equal(unavailable.summary, '');
  assert.equal(unavailable.parseState, 'invalid');
});

check('source intent is primary text and exact evidence stays intact', () => {
  const input = JSON.stringify({
    intent: 'Build the web bundle',
    command: 'cd /repo && bun run build',
    timeout: 120000,
  });
  const bash = describeToolCall('bash', input);
  assert.equal(bash.label, 'Build the web bundle');
  assert.equal(bash.familyLabel, 'Run command');
  assert.equal(bash.intent, 'Build the web bundle');
  assert.equal(bash.command, 'cd /repo && bun run build');
  assert.equal(bash.summary, 'cd /repo && bun run build');

  const noIntent = describeToolCall('bash', JSON.stringify({ command: 'cd /home/quant && df -h' }));
  assert.equal(noIntent.label, 'Run command', 'missing intent must not be invented');
  assert.equal(noIntent.intent, null);
  assert.equal(noIntent.summary, 'cd /home/quant && df -h');
});

check('file cards are filename-first and keep the full source path', () => {
  const edit = describeToolCall('edit', JSON.stringify({
    intent: 'Fix the release check',
    file_path: '/home/quant/src/jcode-mobile/apps/stillness/src/lib/toolLabels.ts',
    old_string: 'old line\n',
    new_string: 'new line\n',
  }));
  assert.equal(edit.basename, 'toolLabels.ts');
  assert.equal(edit.directory, '/home/quant/src/jcode-mobile/apps/stillness/src/lib');
  assert.equal(edit.directoryHint, '…/src/lib');
  assert.equal(edit.edits.length, 1);
  assert.equal(edit.oldText, 'old line\n');
  assert.equal(edit.newText, 'new line\n');

  const multi = describeToolCall('edit', JSON.stringify({
    file_path: 'src/a.ts',
    edits: [
      { old_string: 'one', new_string: 'two' },
      { old_string: 'three', new_string: 'four', replace_all: true },
    ],
  }));
  assert.equal(multi.edits.length, 2);
  assert.equal(multi.edits[1].replaceAll, true);

  const write = describeToolCall('write', JSON.stringify({
    file_path: '/tmp/empty.txt',
    content: '',
  }));
  assert.equal(write.basename, 'empty.txt');
  assert.equal(write.content, '', 'an empty file is valid observed content');

  const windows = pathParts('C:\\Users\\dev\\src\\App.tsx');
  assert.equal(windows.basename, 'App.tsx');
  assert.equal(windows.directoryHint, '…/dev/src');
  assert.equal(pathParts('/repo/ünïcode/文件.ts').basename, '文件.ts');
  assert.equal(pathParts('/repo/').basename, 'repo');
});

check('patch paths and aliases resolve without rewriting the tool name', () => {
  const patch = describeToolCall('apply_patch', JSON.stringify({
    intent: 'Apply parser fix',
    patch_text: '*** Begin Patch\n*** Update File: crates/parser/src/lib.rs\n@@ -1 +1 @@\n-a\n+b\n*** End Patch',
  }));
  assert.equal(patch.family, 'apply_patch');
  assert.equal(patch.basename, 'lib.rs');
  assert.equal(patch.path, 'crates/parser/src/lib.rs');
  assert.match(patch.patch, /Begin Patch/);

  assert.equal(describeToolCall('shell_exec', '{}').family, 'bash');
  assert.equal(describeToolCall('functions.bash', '{}').family, 'bash');
  assert.equal(describeToolCall('Bash', '{}').family, 'bash');
  assert.equal(describeToolCall('file_edit', '{}').family, 'edit');
  assert.equal(describeToolCall('functions.file_grep', '{}').family, 'search');
  assert.equal(describeToolCall('task', '{}').family, 'subagent');
  assert.equal(describeToolCall('todo_write', '{}').family, 'plan');
  assert.equal(describeToolCall('mcp__github__create_issue', '{}').family, 'mcp');
});

check('streamed partial input exposes only complete source fields', () => {
  const partial = '{"intent":"Inspect logs","command":"tail -n 50 /var/log/jcode.log"';
  assert.equal(partialJsonString(partial, 'intent'), 'Inspect logs');
  const tool = describeToolCall('bash', partial);
  assert.equal(tool.parseState, 'partial');
  assert.equal(tool.label, 'Inspect logs', 'intent may arrive before the JSON closes');
  assert.equal(tool.command, 'tail -n 50 /var/log/jcode.log');

  const unterminated = '{"intent":"Inspect logs","command":"tail -n';
  assert.equal(partialJsonString(unterminated, 'command'), null);
  assert.equal(partialJsonString(unterminated, 'intent'), 'Inspect logs');
});

check('compact previews redact credential shapes but expanded evidence does not', () => {
  const command = 'curl -H "Authorization: Bearer sk-abcdefghijklmnop" https://api.test';
  const tool = describeToolCall('bash', JSON.stringify({ command, token: 'super-secret-value' }));
  assert.match(tool.summary, /Bearer \[redacted\]/);
  assert.doesNotMatch(tool.summary, /sk-abcdefghijklmnop/);
  assert.equal(tool.command, command, 'expanded evidence is preserved exactly');
  assert.equal(redactSecrets('API_KEY=abc123'), 'API_KEY=[redacted]');
  assert.equal(redactSecrets('--password hunter2'), '--password [redacted]');
  assert.equal(redactSecrets('plain text stays'), 'plain text stays');
});

check('output facts come from source text and never invent an exit code', () => {
  const failed = analyzeToolOutput('boom\n\nExit code: 2');
  assert.equal(failed.exitCode, 2);
  assert.match(failed.summary, /boom/);
  assert.doesNotMatch(failed.summary, /Exit code/, 'the footer is shown once as metadata');
  assert.match(failed.display, /Exit code: 2/, 'copy keeps the exact source text');

  const unknown = analyzeToolOutput('some output');
  assert.equal(unknown.exitCode, null, 'missing exit code is not zero');
  const empty = analyzeToolOutput('Command completed successfully (no output)');
  assert.equal(empty.exitCode, null);

  const background = analyzeToolOutput('--- Command finished with exit code: 7 ---');
  assert.equal(background.exitCode, 7);

  const withDiff = analyzeToolOutput([
    'Updated file.ts (2 lines):',
    '1- old',
    '1+ new',
    '',
    'File diff:',
    '```diff',
    '--- a/file.ts',
    '+++ b/file.ts',
    '@@ -1 +1 @@',
    '-old',
    '+new',
    '```',
  ].join('\n'));
  assert.match(withDiff.summary, /Updated file\.ts/);
  assert.equal(withDiff.diff.includes('@@ -1 +1 @@'), true);
  assert.deepEqual(diffStats(withDiff.diff), { added: 1, removed: 1 });

  const ansi = analyzeToolOutput('\u001b[31mred\u001b[0m and \u001b[1mbold\u001b[0m');
  assert.equal(ansi.display, 'red and bold');
  assert.equal(ansi.hasAnsi, true);
  assert.equal(stripAnsi('plain'), 'plain');
  assert.equal(analyzeToolOutput('line\n... (output truncated)').truncated, true);
  assert.equal(analyzeToolOutput('<script>alert(1)</script>').display, '<script>alert(1)</script>');
});

check('100 KB+ tool payload stays complete for copy and paged rendering', () => {
  const chunk = 'x'.repeat(1024);
  const output = Array.from({ length: 140 }, (_, index) => `${index}-${chunk}`).join('\n');
  const facts = analyzeToolOutput(output);
  assert.equal(facts.display.length > 100 * 1024, true);
  assert.equal(facts.display, output, 'display keeps the full source for copy');
  assert.equal(facts.exitCode, null);
});

check('diff classification is exact', () => {
  assert.equal(classifyDiffLine('+added'), 'add');
  assert.equal(classifyDiffLine('-removed'), 'remove');
  assert.equal(classifyDiffLine('@@ -1,2 +1,3 @@'), 'hunk');
  assert.equal(classifyDiffLine('--- a/file'), 'meta');
  assert.equal(classifyDiffLine(' context'), 'context');
  assert.equal(looksLikeDiff('diff --git a/x b/x\n@@ -1 +1 @@\n-a\n+b'), true);
  assert.equal(looksLikeDiff('plain output'), false);
});

check('history merges consecutive assistant chunks only', () => {
  const entries = groupHistory([
    { index: 0, role: 'user', content: 'hi', tool_call_id: null, tool_name: null, tool_input: null, response_stats: null },
    { index: 1, role: 'assistant', content: 'one', tool_call_id: null, tool_name: null, tool_input: null, response_stats: null },
    { index: 2, role: 'assistant', content: 'two', tool_call_id: null, tool_name: null, tool_input: null, response_stats: null },
    { index: 3, role: 'tool', content: 'out', tool_call_id: 'c1', tool_name: 'bash', tool_input: { command: 'ls' }, response_stats: null },
    { index: 4, role: 'assistant', content: 'three', tool_call_id: null, tool_name: null, tool_input: null, response_stats: null },
  ]);
  assert.deepEqual(entries.map((entry) => entry.kind), ['user', 'assistant', 'tool', 'assistant']);
  assert.equal(entries[1].content, 'one\n\ntwo');
});

check('model routes filter, group, and disambiguate', () => {
  const routes = [
    { model: 'shared', provider: 'alpha', api_method: 'responses', available: true, detail: '', is_command_code: false },
    { model: 'shared', provider: 'beta', api_method: 'chat', available: false, detail: 'quota', is_command_code: false },
    { model: 'command', provider: 'native', api_method: 'command', available: true, detail: '', is_command_code: true },
  ];
  assert.equal(modelRoutePool(routes, null).length, 3);
  assert.equal(routeKey(routes[0]), 'alpha::shared::responses');
  assert.deepEqual(filterModelRoutes(routes, 'shared', null).map(routeKey), [
    'alpha::shared::responses',
    'beta::shared::chat',
  ]);
  assert.deepEqual(filterModelRoutes(routes, '', 'beta').map((route) => route.model), ['shared']);
  const groups = groupByProvider(routes);
  assert.deepEqual(groups.map((group) => group.provider), ['alpha', 'beta', 'native']);
  assert.equal(groups[0].available, 1);
  assert.deepEqual(providerChips(routes).map((chip) => `${chip.provider}:${chip.available}/${chip.count}`), [
    'alpha:1/1',
    'beta:0/1',
    'native:1/1',
  ]);
});

check('timeline keeps wire order across reasoning, tools and assistant updates in one frame', () => {
  const items = orderedTimeline(
    [{ id: 'message', seq: 6, text: 'Result', done: false }],
    [
      { id: 'r1', seq: 1, text: 'First idea', done: true },
      { id: 'r2', seq: 5, text: 'After the tool', done: true },
    ],
    [{ callId: 'c1', seq: 3, name: 'bash', input: '{}', output: 'a.ts', error: null, status: 'done' }],
  );
  assert.deepEqual(items.map((item) => item.kind), ['reasoning', 'tool', 'reasoning', 'assistant']);
  assert.equal(items[2].block.text, 'After the tool');
});

check('v4 byte packages decode UTF-8 across frames and publish exactly once', () => {
  const client = new AdapterClient('http://127.0.0.1', 'fixture');
  const received = [];
  client.on('session.swarm', (frame) => received.push(frame));
  const frame = { v: 4, kind: 'event', type: 'session.swarm', payload: { label: '' } };
  const headerLength = JSON.stringify(frame).length - 3;
  frame.payload.label = 'a'.repeat(65_535 - headerLength) + 'İstanbul 🪶';
  const bytes = new TextEncoder().encode(JSON.stringify(frame));
  assert.equal(bytes[65_535], 0xc4, 'the UTF-8 code point must span two frames');
  client.handleFrame(JSON.stringify({
    v: 4, kind: 'event', type: 'transport.bytes', payload: { length: bytes.length },
  }));
  client.handleFrame(bytes.slice(0, 65_536).buffer);
  assert.deepEqual(received, []);
  client.handleFrame(bytes.slice(65_536).buffer);
  assert.deepEqual(received, [frame]);

  let closeCode;
  client.socket = { close(code) { closeCode = code; } };
  client.handleFrame(JSON.stringify({
    v: 4, kind: 'event', type: 'transport.bytes', payload: { length: 67_108_865 },
  }));
  assert.equal(closeCode, 4002);
});

check('confirmed title prefers the snapshot and never merges sources', () => {
  const inventory = [{ session_id: 's1', title: 'Inventory title' }];
  const snapshot = { session: { session_id: 's1', title: 'Snapshot title' } };
  assert.equal(confirmedSessionTitle({ activeSessionId: 's1', snapshot, sessions: inventory }), 'Snapshot title');
  assert.equal(confirmedSessionTitle({ activeSessionId: 's1', snapshot: null, sessions: inventory }), 'Inventory title');
  assert.equal(confirmedSessionTitle({ activeSessionId: 's2', snapshot, sessions: inventory }), 'Untitled session');
});

check('server favorite and archive flags are authoritative online', () => {
  const prefs = { pinned: ['a'], archived: ['b'] };
  const a = { session_id: 'a', favorite: false, archived: false };
  const b = { session_id: 'b', favorite: true, archived: true };
  assert.deepEqual(favoriteView(a, prefs, true), { favorite: false, source: 'server' });
  assert.deepEqual(favoriteView(b, prefs, true), { favorite: true, source: 'server' });
  assert.equal(sessionFavorite(a, prefs, true), false, 'local pin must not override server false');
  assert.equal(sessionIsArchived(a, prefs, true), false);
  assert.equal(sessionIsArchived(b, prefs, true), true);
});

check('offline favorites and archives fall back to phone state', () => {
  const prefs = { pinned: ['a'], archived: ['b'] };
  const a = { session_id: 'a', favorite: false, archived: false };
  const b = { session_id: 'b', favorite: false, archived: false };
  const cached = { session_id: 'c', favorite: true, archived: false };
  assert.deepEqual(favoriteView(a, prefs, false), { favorite: true, source: 'local' });
  assert.deepEqual(favoriteView(b, prefs, false), { favorite: false, source: 'local' });
  assert.deepEqual(favoriteView(cached, prefs, false), { favorite: true, source: 'server' });
  assert.deepEqual(
    favoriteView({ session_id: 'd', favorite: true }, { pinned: ['d'], archived: [] }, false),
    { favorite: true, source: 'server' },
    'a server favorite stays server-owned even if a stale phone pin exists',
  );
  assert.equal(sessionIsArchived(a, prefs, false), false);
  assert.equal(sessionIsArchived(b, prefs, false), true);
});

check('favorites sort first and archived rows are filtered', () => {
  const prefs = { pinned: [], archived: [] };
  const sessions = [
    { session_id: 'one', favorite: false, archived: false, updated_at_ms: 10 },
    { session_id: 'two', favorite: true, archived: false, updated_at_ms: 5 },
    { session_id: 'three', favorite: false, archived: true, updated_at_ms: 30 },
  ];
  assert.deepEqual(
    visibleSessions(sessions, prefs, true).map((session) => session.session_id),
    ['two', 'one'],
  );
  assert.deepEqual(
    sortSessions(sessions, prefs, true).map((session) => session.session_id),
    ['two', 'three', 'one'],
  );
});

check('image validation enforces type and the 4 MiB limit', () => {
  assert.equal(validateImage('image/png', 1024), null);
  assert.equal(validateImage('image/jpeg', MAX_IMAGE_BYTES), null);
  assert.match(validateImage('image/svg+xml', 1024), /PNG, JPEG, WebP or GIF/);
  assert.match(validateImage('image/jpeg', MAX_IMAGE_BYTES + 1), /4 MiB/);
});

check('deep links resolve sessions, new sessions, and unhandled links', () => {
  assert.deepEqual(
    deepLinkIntent({ action: 'open_session', sessionId: 's1', url: null }),
    { kind: 'session', sessionId: 's1' },
  );
  assert.deepEqual(
    deepLinkIntent({ action: 'new_session', sessionId: null, url: 'jcode://new' }),
    { kind: 'new' },
  );
  assert.deepEqual(
    deepLinkIntent({ action: 'open_session', sessionId: null, url: 'jcode://session/s9' }),
    { kind: 'session', sessionId: 's9' },
  );
  assert.deepEqual(
    deepLinkIntent({
      action: 'open_session',
      sessionId: null,
      url: 'https://example.test/sessions/abc?x=1',
    }),
    { kind: 'session', sessionId: 'abc' },
  );
  assert.equal(
    deepLinkIntent({ action: 'unknown', sessionId: null, url: 'https://example.test/' }).kind,
    'unhandled',
  );
  assert.equal(deepLinkIntent({ action: 'none', sessionId: null, url: null }).kind, 'none');
  assert.equal(sessionIdFromUrl('jcode://session/s9'), 's9');
});

check('share plans keep text and images and count unsupported items', () => {
  const plan = sharePlan([
    { kind: 'text', text: 'hello', url: null, mimeType: null, fileName: null, uri: null, sizeBytes: null },
    { kind: 'url', text: null, url: 'https://x.test', mimeType: null, fileName: null, uri: null, sizeBytes: null },
    { kind: 'image', text: null, url: null, mimeType: 'image/png', fileName: 'a.png', uri: 'content://a', sizeBytes: 3 },
    { kind: 'file', text: null, url: null, mimeType: 'application/pdf', fileName: 'b.pdf', uri: 'content://b', sizeBytes: 3 },
  ]);
  assert.equal(plan.text, 'hello\n\nhttps://x.test');
  assert.deepEqual(plan.imageUris, ['content://a']);
  assert.equal(plan.unsupported, 1);
});

check('pending shares are scoped to the paired server', () => {
  const attachment = {
    id: 'att_1',
    name: 'a.png',
    mediaType: 'image/png',
    dataBase64: 'AAAA',
    size: 3,
  };
  holdPendingShare({ serverId: 'srv_a', text: 'hello', attachments: [attachment] });
  assert.equal(hasPendingShare('srv_b'), false, 'another server must not see the share');
  assert.equal(takePendingShare('srv_b'), null, 'another server must not take the share');
  assert.equal(hasPendingShare('srv_a'), true, 'the owning server still has the share');
  const taken = takePendingShare('srv_a');
  assert.equal(taken.text, 'hello');
  assert.equal(taken.attachments.length, 1);
  assert.equal(hasPendingShare('srv_a'), false, 'taking the share clears it');

  holdPendingShare({ serverId: null, text: 'pre-pairing', attachments: [] });
  assert.equal(hasPendingShare('srv_b'), true, 'an unscoped share belongs to the first server');
  assert.equal(takePendingShare('srv_b').text, 'pre-pairing');
  assert.equal(hasPendingShare(), false);

  holdPendingShare({ serverId: 'srv_a', text: '', attachments: [] });
  assert.equal(hasPendingShare(), false, 'an empty share is not held');
});

check('motion preferences resolve system, explicit overrides and legacy values', () => {
  assert.equal(resolveMotion('system', true), 'off');
  assert.equal(resolveMotion('system', false), 'full');
  assert.equal(resolveMotion('full', true), 'full', 'explicit Full is an opt-in');
  assert.equal(resolveMotion('subtle', true), 'subtle');
  assert.equal(resolveMotion('off', false), 'off');
  assert.equal(normalizeMotionPreference('reduced'), 'off');
  assert.equal(normalizeMotionPreference('reduce'), 'off');
  assert.equal(normalizeMotionPreference('nonsense'), 'system');
  assert.equal(normalizeMotionPreference(undefined), 'system');
  assert.equal(normalizeMotionPreference('subtle'), 'subtle');
});

console.log(`\n${checks} checks passed.`);
