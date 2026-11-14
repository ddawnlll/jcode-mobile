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
import { TimelineJournal } from '../apps/stillness/src/lib/timelineJournal.ts';
import { confirmedSessionTitle } from '../apps/stillness/src/lib/format.ts';

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

check('timeline keeps observed order across reasoning and tools', () => {
  const journal = new TimelineJournal();
  const base = {
    turnId: 't1',
    finishedTurnId: null,
    assistants: [],
    reasoning: '',
    tools: [],
  };
  let items = journal.observe({ ...base, reasoning: 'First idea' });
  assert.deepEqual(items.map((item) => item.kind), ['reasoning']);

  items = journal.observe({ ...base, reasoning: 'First idea, extended' });
  assert.deepEqual(items.map((item) => item.kind), ['reasoning']);

  items = journal.observe({
    ...base,
    reasoning: 'First idea, extended',
    tools: [
      { callId: 'c1', name: 'bash', input: '{"command":"ls"}', output: '', error: null, status: 'started' },
    ],
  });
  assert.deepEqual(items.map((item) => item.kind), ['reasoning', 'tool']);

  items = journal.observe({
    ...base,
    reasoning: 'First idea, extended. Now inspect.',
    tools: [
      { callId: 'c1', name: 'bash', input: '{"command":"ls"}', output: 'a.ts', error: null, status: 'done' },
    ],
  });
  assert.deepEqual(items.map((item) => item.kind), ['reasoning', 'tool', 'reasoning']);

  // A finished turn keeps the same key and therefore the order.
  items = journal.observe({
    turnId: null,
    finishedTurnId: 't1',
    assistants: [],
    reasoning: 'First idea, extended. Now inspect.',
    tools: [
      { callId: 'c1', name: 'bash', input: '{"command":"ls"}', output: 'a.ts', error: null, status: 'done' },
    ],
  });
  assert.deepEqual(items.map((item) => item.kind), ['reasoning', 'tool', 'reasoning']);
});

check('confirmed title prefers the snapshot and never merges sources', () => {
  const inventory = [{ session_id: 's1', title: 'Inventory title' }];
  const snapshot = { session: { session_id: 's1', title: 'Snapshot title' } };
  assert.equal(confirmedSessionTitle({ activeSessionId: 's1', snapshot, sessions: inventory }), 'Snapshot title');
  assert.equal(confirmedSessionTitle({ activeSessionId: 's1', snapshot: null, sessions: inventory }), 'Inventory title');
  assert.equal(confirmedSessionTitle({ activeSessionId: 's2', snapshot, sessions: inventory }), 'Untitled session');
});

console.log(`\n${checks} checks passed.`);
