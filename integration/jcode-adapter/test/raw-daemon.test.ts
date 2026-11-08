import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { RawDaemonConnection } from '../src/rawDaemon.ts';

test('decodes a UTF-8 character split across socket chunks', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'jcode-raw-'));
  const socketPath = join(dir, 'daemon.sock');
  const text = 'Grüße — İstanbul';
  const payload = Buffer.from(`${JSON.stringify({ type: 'state', text })}\n`, 'utf8');
  const split = payload.indexOf(Buffer.from('ü', 'utf8')) + 1;

  const server = createServer((socket) => {
    socket.write(payload.subarray(0, split));
    setTimeout(() => socket.write(payload.subarray(split)), 20);
  });
  await new Promise<void>((resolve) => server.listen(socketPath, resolve));

  const events: Array<Record<string, unknown>> = [];
  const connection = new RawDaemonConnection(socketPath);
  connection.onEvent((event) => events.push(event));
  await connection.connect();
  await new Promise((resolve) => setTimeout(resolve, 120));

  assert.equal(events.length, 1);
  assert.equal(events[0].text, text);
  connection.close();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await rm(dir, { recursive: true, force: true });
});
