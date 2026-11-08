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
    logLevel: 'warn',
    faultAfterSend: false,
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

test('retry rollback clears provisional text and reports the retry phase', async () => {
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

    const replacement = emitted.find((frame) => frame.ev === 'text_replace');
    assert.ok(replacement, 'text_replace emitted');
    assert.equal(replacement!.text, '', 'provisional text is cleared');
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
