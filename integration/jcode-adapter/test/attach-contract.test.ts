/**
 * Contract test: the adapter's attach must opt into disconnect continuation on
 * the daemon-facing Subscribe. A fake daemon records the wire frame, so this
 * runs in CI without a provider or a real JCode install.
 */
import assert from 'node:assert/strict';
import { createServer, type Server, type Socket } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { Attachment } from '../src/attachment.ts';
import type { AdapterConfig } from '../src/config.ts';

function configFor(socketPath: string, stateDir: string, overrides: Partial<AdapterConfig> = {}): AdapterConfig {
  return {
    host: '127.0.0.1',
    port: 0,
    allowInsecureBind: false,
    allowedOrigins: [],
    jcodeHome: stateDir,
    daemonSocket: socketPath,
    apiSocket: join(stateDir, 'api.sock'),
    jcodeBin: 'jcode',
    stateDir,
    devicesPath: join(stateDir, 'devices.json'),
    ledgerPath: join(stateDir, 'ledger.json'),
    maxFrameBytes: 1024 * 1024,
    maxHistoryMessages: 100,
    historyWindow: 10,
    maxHistoryBytes: 3 * 1024 * 1024,
    renameTimeoutMs: 8_000,
    logLevel: 'warn',
    faultAfterSend: false,
    trustProxy: false,
    workspaceRoots: [stateDir],
    ...overrides,
  };
}

function readFrames(socket: Socket): { next: () => Promise<Record<string, unknown>>; socket: Socket } {
  let buffer = '';
  const queue: Array<Record<string, unknown>> = [];
  const waiters: Array<(value: Record<string, unknown>) => void> = [];
  socket.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    for (;;) {
      const newline = buffer.indexOf('\n');
      if (newline === -1) break;
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      const parsed = JSON.parse(line) as Record<string, unknown>;
      const waiter = waiters.shift();
      if (waiter) waiter(parsed);
      else queue.push(parsed);
    }
  });
  return {
    socket,
    next: () =>
      new Promise((resolve, reject) => {
        const item = queue.shift();
        if (item) return resolve(item);
        const timer = setTimeout(() => reject(new Error('timed out waiting for daemon frame')), 5000);
        waiters.push((value) => {
          clearTimeout(timer);
          resolve(value);
        });
      }),
  };
}

async function withFakeDaemon(
  run: (context: {
    socketPath: string;
    stateDir: string;
    frames: () => Record<string, unknown>[];
    send: (frame: Record<string, unknown>) => void;
  }) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), 'jcode-adapter-test-'));
  const socketPath = join(dir, 'daemon.sock');
  const holder: { socket: Socket | null } = { socket: null };
  const received: Record<string, unknown>[] = [];
  const server: Server = createServer((socket) => {
    holder.socket = socket;
    const frames = readFrames(socket);
    void (async () => {
      for (;;) {
        const frame = await frames.next().catch(() => null);
        if (!frame) return;
        received.push(frame);
      }
    })();
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));
  try {
    await run({
      socketPath,
      stateDir: dir,
      frames: () => received,
      send: (frame) => holder.socket?.write(`${JSON.stringify(frame)}\n`),
    });
  } finally {
    holder.socket?.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(dir, { recursive: true, force: true });
  }
}

test('attach sends continue_on_disconnect and exact target_session_id', async () => {
  await withFakeDaemon(async ({ socketPath, stateDir, frames, send }) => {
    const emitted: Array<Record<string, unknown>> = [];
    const attachment = new Attachment({
      config: configFor(socketPath, stateDir),
      replyTo: 7,
      emit: (frame) => emitted.push(frame),
      sessionId: 'session_target_1',
    });

    const started = attachment.start();
    await new Promise((resolve) => setTimeout(resolve, 150));

    const subscribe = frames().find((frame) => frame.type === 'subscribe');
    assert.ok(subscribe, 'subscribe frame was sent');
    assert.equal(subscribe!.continue_on_disconnect, true);
    assert.equal(subscribe!.target_session_id, 'session_target_1');
    assert.equal(subscribe!.client_has_local_history, false);
    assert.equal(subscribe!.allow_session_takeover, false);

    send({ type: 'state', id: 2, session_id: 'session_target_1', is_processing: false, message_count: 3 });
    send({
      type: 'history',
      id: 9,
      session_id: 'session_target_1',
      messages: [
        { role: 'user', content: 'hello' },
        { role: 'assistant', content: 'hi' },
      ],
      provider_name: 'openai',
      provider_model: 'test-model',
    });
    await started;

    const attached = emitted.find((frame) => frame.ev === 'attached');
    assert.ok(attached);
    assert.equal(attached!.continuation, true);
    assert.equal(attached!.reply_to, 7);

    const history = emitted.find((frame) => frame.ev === 'history');
    assert.ok(history, 'history emitted');
    assert.equal(history!.base_index, 0);
    assert.equal(history!.total_messages, 2);
    assert.equal((history!.messages as unknown[]).length, 2);

    // Disposing must not write a destructive request.
    attachment.dispose();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const types = frames().map((frame) => frame.type);
    assert.ok(!types.includes('cancel'), 'no cancel on transport close');
    assert.ok(!types.includes('clear'), 'no clear on transport close');
    assert.ok(!types.includes('prepare_disconnect'), 'no graceful goodbye dependency');
  });
});

test('attach never sends a destructive request before an explicit Stop', async () => {
  await withFakeDaemon(async ({ socketPath, stateDir, frames, send }) => {
    const emitted: Array<Record<string, unknown>> = [];
    const attachment = new Attachment({
      config: configFor(socketPath, stateDir),
      replyTo: 1,
      emit: (frame) => emitted.push(frame),
      sessionId: 'session_target_2',
    });
    const started = attachment.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    send({ type: 'state', id: 2, session_id: 'session_target_2', is_processing: true, message_count: 0 });
    send({ type: 'history', id: 3, session_id: 'session_target_2', messages: [] });
    await started;
    assert.ok(emitted.some((frame) => frame.ev === 'attached'));
    attachment.dispose();
    const types = frames().map((frame) => frame.type);
    assert.ok(!types.includes('cancel'));
  });
});

test('retry rollback is a distinct event so the client can discard the attempt', async () => {
  await withFakeDaemon(async ({ socketPath, stateDir, frames, send }) => {
    const emitted: Array<Record<string, unknown>> = [];
    const attachment = new Attachment({
      config: configFor(socketPath, stateDir),
      replyTo: 4,
      emit: (frame) => emitted.push(frame),
      sessionId: 'session_target_3',
    });
    const started = attachment.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    send({ type: 'state', id: 2, session_id: 'session_target_3', is_processing: true, message_count: 0 });
    send({ type: 'history', id: 3, session_id: 'session_target_3', messages: [] });
    await started;

    send({ type: 'text_delta', text: 'partial answer' });
    send({ type: 'retry_rollback', attempt: 1, max: 3 });
    await new Promise((resolve) => setTimeout(resolve, 100));

    const rollback = emitted.find((frame) => frame.ev === 'retry_rollback');
    assert.ok(rollback, 'retry_rollback emitted');
    assert.equal(rollback!.attempt, 1);
    assert.equal(rollback!.max, 3);
    // It must not fabricate a text replacement: the client rolls back exactly
    // the attempt's steps, including reasoning and in-progress tools.
    assert.ok(!emitted.some((frame) => frame.ev === 'text_replace'));
    const phase = emitted.find((frame) => frame.ev === 'connection_phase');
    assert.ok(phase, 'retry phase emitted');
    assert.match(String(phase!.phase), /retrying \(1\/3\)/);
    const types = frames().map((frame) => frame.type);
    assert.ok(!types.includes('cancel'), 'retry must not cancel the turn');
    attachment.dispose();
  });
});


test('ACK alone does not claim acceptance, and a later rejection is correlated', async () => {
  await withFakeDaemon(async ({ socketPath, stateDir, frames, send }) => {
    const emitted: Array<Record<string, unknown>> = [];
    const attachment = new Attachment({
      config: configFor(socketPath, stateDir),
      replyTo: 1,
      emit: (frame) => emitted.push(frame),
      sessionId: 'session_ack_1',
    });
    const started = attachment.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    send({ type: 'state', id: 2, session_id: 'session_ack_1', is_processing: false, message_count: 0 });
    send({ type: 'history', id: 3, session_id: 'session_ack_1', messages: [] });
    await started;

    attachment.sendMessage('hello', 'cm_1');
    await new Promise((resolve) => setTimeout(resolve, 60));
    const messageFrame = frames().find((frame) => frame.type === 'message');
    assert.ok(messageFrame);
    const messageId = messageFrame!.id as number;

    send({ type: 'ack', id: messageId });
    await new Promise((resolve) => setTimeout(resolve, 50));
    assert.ok(
      !emitted.some((frame) => frame.ev === 'message_accepted'),
      'raw ACK must not be emitted as acceptance',
    );

    send({ type: 'error', id: messageId, message: 'Already processing a message' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    const rejected = emitted.find((frame) => frame.ev === 'send_rejected');
    assert.ok(rejected, 'rejection after ACK is correlated to the send');
    assert.equal(rejected!.client_message_id, 'cm_1');
    attachment.dispose();
  });
});

test('processing state promotes an ACKed message to accepted', async () => {
  await withFakeDaemon(async ({ socketPath, stateDir, frames, send }) => {
    const emitted: Array<Record<string, unknown>> = [];
    const accepted: string[] = [];
    const attachment = new Attachment({
      config: configFor(socketPath, stateDir),
      replyTo: 1,
      emit: (frame) => emitted.push(frame),
      sessionId: 'session_ack_2',
      onAccepted: (id) => accepted.push(id),
    });
    const started = attachment.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    send({ type: 'state', id: 2, session_id: 'session_ack_2', is_processing: false, message_count: 0 });
    send({ type: 'history', id: 3, session_id: 'session_ack_2', messages: [] });
    await started;

    attachment.sendMessage('hello', 'cm_2');
    await new Promise((resolve) => setTimeout(resolve, 60));
    const messageFrame = frames().find((frame) => frame.type === 'message');
    assert.ok(messageFrame);
    send({ type: 'ack', id: messageFrame!.id });
    send({ type: 'state', id: 9, session_id: 'session_ack_2', is_processing: true });
    await new Promise((resolve) => setTimeout(resolve, 80));

    assert.deepEqual(accepted, ['cm_2']);
    const acceptedFrame = emitted.find((frame) => frame.ev === 'message_accepted');
    assert.ok(acceptedFrame);
    assert.equal(acceptedFrame!.client_message_id, 'cm_2');
    attachment.dispose();
  });
});

test('history uses absolute indexes once and respects the outbound byte budget', async () => {
  await withFakeDaemon(async ({ socketPath, stateDir, send }) => {
    const emitted: Array<Record<string, unknown>> = [];
    const attachment = new Attachment({
      config: configFor(socketPath, stateDir, {
        maxHistoryMessages: 3,
        historyWindow: 2,
        maxHistoryBytes: 4096,
      }),
      replyTo: 1,
      emit: (frame) => emitted.push(frame),
      sessionId: 'session_hist_1',
    });
    const started = attachment.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    send({ type: 'state', id: 2, session_id: 'session_hist_1', is_processing: false, message_count: 5 });
    send({
      type: 'history',
      id: 3,
      session_id: 'session_hist_1',
      messages: Array.from({ length: 5 }, (_, index) => ({
        role: index % 2 === 0 ? 'user' : 'assistant',
        content: 'x'.repeat(600),
      })),
    });
    await started;
    const history = emitted.find((frame) => frame.ev === 'history');
    assert.ok(history);
    assert.equal(history!.base_index, 3);
    assert.equal(history!.total_messages, 5);
    const messages = history!.messages as Array<{ index: number; content: string }>;
    assert.deepEqual(messages.map((message) => message.index), [3, 4]);
    assert.ok(JSON.stringify(messages).length < 4096);
    attachment.dispose();
  });
});

test('rename resolves only after the daemon title confirmation', async () => {
  await withFakeDaemon(async ({ socketPath, stateDir, frames, send }) => {
    const emitted: Array<Record<string, unknown>> = [];
    const attachment = new Attachment({
      config: configFor(socketPath, stateDir),
      replyTo: 1,
      emit: (frame) => emitted.push(frame),
      sessionId: 'session_rename_ok',
    });
    const started = attachment.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    send({ type: 'state', id: 2, session_id: 'session_rename_ok', is_processing: false, message_count: 0 });
    send({ type: 'history', id: 3, session_id: 'session_rename_ok', messages: [] });
    await started;

    const result = attachment.rename('New title');
    await new Promise((resolve) => setTimeout(resolve, 80));
    const request = frames().find((frame) => frame.type === 'rename_session');
    assert.ok(request, 'rename reached the daemon');
    assert.equal(request!.title, 'New title');

    // No resolution on transport ACK alone.
    send({ type: 'ack', id: request!.id });
    await new Promise((resolve) => setTimeout(resolve, 80));
    let settled = false;
    void result.then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.equal(settled, false, 'ACK is not confirmation');

    send({
      type: 'session_renamed',
      session_id: 'session_rename_ok',
      title: 'New title',
      display_title: 'New title',
    });
    send({ type: 'done', id: request!.id });
    assert.deepEqual(await result, { title: 'New title', displayTitle: 'New title' });
    attachment.dispose();
  });
});

test('rename rejection is correlated and does not become a stopped turn', async () => {
  await withFakeDaemon(async ({ socketPath, stateDir, frames, send }) => {
    const emitted: Array<Record<string, unknown>> = [];
    const attachment = new Attachment({
      config: configFor(socketPath, stateDir),
      replyTo: 1,
      emit: (frame) => emitted.push(frame),
      sessionId: 'session_rename_reject',
    });
    const started = attachment.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    send({ type: 'state', id: 2, session_id: 'session_rename_reject', is_processing: false, message_count: 0 });
    send({ type: 'history', id: 3, session_id: 'session_rename_reject', messages: [] });
    await started;

    const result = attachment.rename('Rejected title');
    await new Promise((resolve) => setTimeout(resolve, 80));
    const request = frames().find((frame) => frame.type === 'rename_session');
    assert.ok(request);
    send({ type: 'error', id: request!.id, message: 'Title rejected by policy' });

    await assert.rejects(result, /Title rejected by policy/);
    assert.ok(!emitted.some((frame) => frame.ev === 'turn_stopped'), 'rename error is not a turn');
    attachment.dispose();
  });
});

test('rename without an authoritative event is ambiguous, not success', async () => {
  await withFakeDaemon(async ({ socketPath, stateDir, frames, send }) => {
    const attachment = new Attachment({
      config: configFor(socketPath, stateDir),
      replyTo: 1,
      emit: () => undefined,
      sessionId: 'session_rename_ambiguous',
    });
    const started = attachment.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    send({ type: 'state', id: 2, session_id: 'session_rename_ambiguous', is_processing: false, message_count: 0 });
    send({ type: 'history', id: 3, session_id: 'session_rename_ambiguous', messages: [] });
    await started;

    const result = attachment.rename('Maybe');
    await new Promise((resolve) => setTimeout(resolve, 80));
    const request = frames().find((frame) => frame.type === 'rename_session');
    assert.ok(request);
    send({ type: 'done', id: request!.id });
    await assert.rejects(result, /without confirming the new title/);
    attachment.dispose();
  });
});

test('a second rename is rejected while one is pending', async () => {
  await withFakeDaemon(async ({ socketPath, stateDir, frames, send }) => {
    const attachment = new Attachment({
      config: configFor(socketPath, stateDir),
      replyTo: 1,
      emit: () => undefined,
      sessionId: 'session_rename_busy',
    });
    const started = attachment.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    send({ type: 'state', id: 2, session_id: 'session_rename_busy', is_processing: false, message_count: 0 });
    send({ type: 'history', id: 3, session_id: 'session_rename_busy', messages: [] });
    await started;

    const first = attachment.rename('First');
    await assert.rejects(attachment.rename('Second'), /already in progress|still pending/);
    await new Promise((resolve) => setTimeout(resolve, 80));
    const request = frames().find((frame) => frame.type === 'rename_session');
    assert.ok(request);
    send({ type: 'session_renamed', session_id: 'session_rename_busy', title: 'First', display_title: 'First' });
    send({ type: 'done', id: request!.id });
    assert.deepEqual(await first, { title: 'First', displayTitle: 'First' });
    attachment.dispose();
  });
});

test('a timed-out rename cannot complete or hide a later rename', async () => {
  await withFakeDaemon(async ({ socketPath, stateDir, frames, send }) => {
    const attachment = new Attachment({
      config: configFor(socketPath, stateDir, { renameTimeoutMs: 200 }),
      replyTo: 1,
      emit: () => undefined,
      sessionId: 'session_rename_order',
    });
    const started = attachment.start();
    await new Promise((resolve) => setTimeout(resolve, 100));
    send({ type: 'state', id: 2, session_id: 'session_rename_order', is_processing: false, message_count: 0 });
    send({ type: 'history', id: 3, session_id: 'session_rename_order', messages: [] });
    await started;

    const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
    try {
      const first = attachment.rename('A title');
      await settle();
      const firstRequest = await waitForFrame(frames, 'rename_session');
      assert.ok(firstRequest);
      // Real 200 ms deadline: Bun and Node expose different fake-timer
      // surfaces, and this test must exercise the attachment's real timer.
      await assert.rejects(first, /did not confirm/);

      // The daemon may still process the timed-out request. Overlapping a new
      // rename would make a late event for A indistinguishable from B.
      await assert.rejects(attachment.rename('B title'), /still pending|pending/);

      // Late confirmation for A is authoritative for A, but must not complete B.
      send({
        type: 'session_renamed',
        session_id: 'session_rename_order',
        title: 'A title',
        display_title: 'A title',
      });
      send({ type: 'done', id: firstRequest!.id });
      await settle();
      await settle();

      const second = attachment.rename('B title');
      await settle();
      const secondRequest = await waitForFrame(frames, 'rename_session', firstRequest!.id);
      assert.ok(secondRequest);
      assert.notEqual(secondRequest!.id, firstRequest!.id);

      // A duplicate late A event must not resolve B.
      send({
        type: 'session_renamed',
        session_id: 'session_rename_order',
        title: 'A title',
        display_title: 'A title',
      });
      let settled = false;
      void second.then(() => { settled = true; });
      await settle();
      assert.equal(settled, false, 'late A did not complete B');

      send({
        type: 'session_renamed',
        session_id: 'session_rename_order',
        title: 'B title',
        display_title: 'B title',
      });
      send({ type: 'done', id: secondRequest!.id });
      assert.deepEqual(await second, { title: 'B title', displayTitle: 'B title' });
    } finally {
      attachment.dispose();
    }
  });
});

/** Socket writes settle on a different turn under Bun and Node. */
async function waitForFrame(
  frames: () => Record<string, unknown>[],
  type: string,
  afterId?: unknown,
): Promise<Record<string, unknown> | undefined> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const match = frames()
      .filter((frame) => frame.type === type)
      .find((frame) => afterId === undefined || frame.id !== afterId);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  return undefined;
}

test('live deltas are delivered before any history snapshot arrives', async () => {
  await withFakeDaemon(async ({ socketPath, stateDir, frames, send }) => {
    const emitted: Array<Record<string, unknown>> = [];
    const attachment = new Attachment({
      config: configFor(socketPath, stateDir),
      replyTo: 1,
      emit: (frame) => emitted.push(frame),
      sessionId: 'session_live_1',
    });
    const started = attachment.start();
    await waitForFrame(frames, 'state');
    send({ type: 'state', id: 2, session_id: 'session_live_1', is_processing: true, message_count: 0 });
    await started;
    // No history frame has been sent: the live stream must still flow.
    send({ type: 'text_delta', text: 'live answer' });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const delta = emitted.find((frame) => frame.ev === 'text_delta');
    assert.ok(delta, 'delta delivered without waiting for history');
    assert.equal(delta!.text, 'live answer');
    attachment.dispose();
  });
});

test('an uncorrelated done cannot finish a turn', async () => {
  await withFakeDaemon(async ({ socketPath, stateDir, frames, send }) => {
    const emitted: Array<Record<string, unknown>> = [];
    const attachment = new Attachment({
      config: configFor(socketPath, stateDir),
      replyTo: 1,
      emit: (frame) => emitted.push(frame),
      sessionId: 'session_done_1',
    });
    const started = attachment.start();
    await waitForFrame(frames, 'state');
    send({ type: 'state', id: 2, session_id: 'session_done_1', is_processing: false, message_count: 0 });
    await started;
    send({ type: 'done', id: 9999 });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.ok(!emitted.some((frame) => frame.ev === 'turn_done'), 'no phantom turn');

    attachment.sendMessage('hello', 'cm_done');
    const message = await waitForFrame(frames, 'message');
    assert.ok(message);
    send({ type: 'ack', id: message!.id });
    send({ type: 'done', id: message!.id });
    await new Promise((resolve) => setTimeout(resolve, 100));
    const accepted = emitted.find((frame) => frame.ev === 'message_accepted');
    const done = emitted.find((frame) => frame.ev === 'turn_done');
    assert.ok(accepted, 'correlated acceptance still published');
    assert.ok(done, 'correlated completion published');
    attachment.dispose();
  });
});

test('a control reply does not finish the generation', async () => {
  await withFakeDaemon(async ({ socketPath, stateDir, frames, send }) => {
    const emitted: Array<Record<string, unknown>> = [];
    const attachment = new Attachment({
      config: configFor(socketPath, stateDir),
      replyTo: 1,
      emit: (frame) => emitted.push(frame),
      sessionId: 'session_control_1',
    });
    const started = attachment.start();
    await waitForFrame(frames, 'state');
    send({ type: 'state', id: 2, session_id: 'session_control_1', is_processing: true, message_count: 0 });
    await started;
    attachment.setSaved(true);
    const saved = await waitForFrame(frames, 'set_session_saved');
    assert.ok(saved);
    send({ type: 'ack', id: saved!.id });
    send({ type: 'done', id: saved!.id });
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.ok(!emitted.some((frame) => frame.ev === 'turn_done'), 'control done ignored');
    attachment.dispose();
  });
});

test('model catalog resolves by request id and stays out of the transcript', async () => {
  await withFakeDaemon(async ({ socketPath, stateDir, frames, send }) => {
    const emitted: Array<Record<string, unknown>> = [];
    const attachment = new Attachment({
      config: configFor(socketPath, stateDir),
      replyTo: 1,
      emit: (frame) => emitted.push(frame),
      sessionId: 'session_catalog_1',
    });
    const started = attachment.start();
    await waitForFrame(frames, 'state');
    send({ type: 'state', id: 2, session_id: 'session_catalog_1', is_processing: false, message_count: 0 });
    await started;
    const modelsPromise = attachment.models();
    const catalog = await waitForFrame(frames, 'get_model_catalog');
    assert.ok(catalog);
    send({
      type: 'history',
      id: catalog!.id,
      session_id: 'session_catalog_1',
      messages: [],
      provider_name: 'anthropic',
      provider_model: 'claude-sonnet-4-6',
      available_models: ['claude-sonnet-4-6', 'claude-opus-4-7'],
      reasoning_effort: 'high',
    });
    const models = await modelsPromise;
    assert.deepEqual(models.models, ['claude-sonnet-4-6', 'claude-opus-4-7']);
    assert.equal(models.current, 'claude-sonnet-4-6');
    assert.deepEqual(models.efforts, ['none', 'low', 'medium', 'high', 'max', 'swarm']);
    assert.ok(
      !emitted.some((frame) => frame.ev === 'history' && frame.messages),
      'catalog reply is not a transcript snapshot',
    );
    attachment.dispose();
  });
});

test('a newer history snapshot replaces the image set even when empty', async () => {
  await withFakeDaemon(async ({ socketPath, stateDir, frames, send }) => {
    const emitted: Array<Record<string, unknown>> = [];
    const attachment = new Attachment({
      config: configFor(socketPath, stateDir),
      replyTo: 1,
      emit: (frame) => emitted.push(frame),
      sessionId: 'session_img_1',
    });
    const started = attachment.start();
    await waitForFrame(frames, 'state');
    send({ type: 'state', id: 2, session_id: 'session_img_1', is_processing: false, message_count: 1 });
    send({
      type: 'history',
      id: 3,
      session_id: 'session_img_1',
      messages: [{ role: 'user', content: 'with image' }],
      images: [{ media_type: 'image/png', data: 'AAAA' }],
    });
    await started;
    send({
      type: 'history',
      id: 4,
      session_id: 'session_img_1',
      messages: [{ role: 'user', content: 'cleared' }],
    });
    await new Promise((resolve) => setTimeout(resolve, 80));
    const histories = emitted.filter((frame) => frame.ev === 'history');
    assert.equal(histories.length, 2);
    assert.ok(!('images' in histories[1]), 'stale image set cleared');
    attachment.dispose();
  });
});

test('paged history at the retention floor says there is nothing older', async () => {
  await withFakeDaemon(async ({ socketPath, stateDir, frames, send }) => {
    const emitted: Array<Record<string, unknown>> = [];
    const attachment = new Attachment({
      config: configFor(socketPath, stateDir, { maxHistoryMessages: 2 }),
      replyTo: 1,
      emit: (frame) => emitted.push(frame),
      sessionId: 'session_page_1',
    });
    const started = attachment.start();
    await waitForFrame(frames, 'state');
    send({ type: 'state', id: 2, session_id: 'session_page_1', is_processing: false, message_count: 2 });
    send({
      type: 'history',
      id: 3,
      session_id: 'session_page_1',
      messages: [
        { role: 'user', content: 'a' },
        { role: 'assistant', content: 'b' },
      ],
    });
    await started;
    const page = attachment.getHistoryBefore(0, 40);
    assert.equal(page.has_older, false);
    assert.deepEqual(page.messages, []);
    attachment.dispose();
  });
});

test('outbound history stays inside the negotiated phone budget', async () => {
  await withFakeDaemon(async ({ socketPath, stateDir, frames, send }) => {
    const emitted: Array<Record<string, unknown>> = [];
    const attachment = new Attachment({
      config: configFor(socketPath, stateDir),
      replyTo: 1,
      maxFrameBytes: 128 * 1024,
      emit: (frame) => emitted.push(frame),
      sessionId: 'session_budget_1',
    });
    const started = attachment.start();
    await waitForFrame(frames, 'state');
    send({ type: 'state', id: 2, session_id: 'session_budget_1', is_processing: false, message_count: 1 });
    send({
      type: 'history',
      id: 3,
      session_id: 'session_budget_1',
      messages: [{ role: 'assistant', content: 'x'.repeat(400 * 1024) }],
    });
    await started;
    const history = emitted.find((frame) => frame.ev === 'history');
    assert.ok(history);
    assert.ok(
      Buffer.byteLength(JSON.stringify(history), 'utf8') <= 128 * 1024,
      'frame fits the phone budget',
    );
    const content = (history!.messages as Array<{ content: string }>)[0].content;
    assert.match(content, /truncated by adapter/);
    attachment.dispose();
  });
});
