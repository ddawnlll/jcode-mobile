#!/usr/bin/env node
/**
 * Runner-free checks for the pure Stillness 0.4 UI helpers.
 *
 * Run with: node scripts/check-stillness-ux.mjs
 * Node strips TypeScript types natively; these modules are type-only imports
 * so no bundler or test runner is needed.
 */
import assert from 'node:assert/strict';
import {
  classifyDiffLine,
  describeToolCall,
  groupHistory,
  looksLikeDiff,
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
  assert.equal(edit.summary, '/repo/a.ts');

  const unavailable = describeToolCall('read', 'not json');
  assert.equal(unavailable.summary, '');
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

console.log(`\n${checks} checks passed.`);
