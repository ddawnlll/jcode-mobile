#!/usr/bin/env bun
/**
 * Test-only second client for multi-client checks (reading anchor, guidance
 * bursts). Pairs once with a short-lived code, stores the token outside the
 * repository, then sends one message to a chosen session.
 *
 * Env:
 *   JCODE_TEST_CODE_FILE   file containing a `jcode pair` code (mode 0600)
 *   JCODE_TEST_TOKEN_FILE  token cache path outside the repository
 *   JCODE_TEST_TITLE       substring of the target session title
 *   JCODE_TEST_MESSAGE     prompt to send
 *   JCODE_TEST_HOST/PORT   default 127.0.0.1:7643
 */
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import WebSocket from 'ws';

const host = process.env.JCODE_TEST_HOST ?? '127.0.0.1';
const port = process.env.JCODE_TEST_PORT ?? '7643';
const tokenFile = process.env.JCODE_TEST_TOKEN_FILE;
const codeFile = process.env.JCODE_TEST_CODE_FILE;
const titleMatch = process.env.JCODE_TEST_TITLE ?? '';
const message = process.env.JCODE_TEST_MESSAGE ?? 'Reply with exactly BURST-ONE.';

if (!tokenFile || !codeFile) {
  throw new Error('JCODE_TEST_TOKEN_FILE and JCODE_TEST_CODE_FILE are required.');
}

async function token() {
  try {
    return readFileSync(tokenFile, 'utf8').trim();
  } catch {
    const code = readFileSync(codeFile, 'utf8').trim();
    const deviceId = `second-${createHash('sha256').update(randomUUID()).digest('hex').slice(0, 16)}`;
    const response = await fetch(`http://${host}:${port}/pair`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code, device_id: deviceId, device_name: 'Second client' }),
    });
    const body = await response.json();
    if (!response.ok || !body.ok || typeof body.token !== 'string') {
      throw new Error(`pair failed: ${body.error ?? response.status}`);
    }
    writeFileSync(tokenFile, `${body.token}\n`, { mode: 0o600 });
    return body.token;
  }
}

const socket = new WebSocket(`ws://${host}:${port}/ws`, {
  headers: { authorization: `Bearer ${await token()}` },
});
const pending = new Map();
const events = [];
const waiters = [];

socket.on('message', (data) => {
  const frame = JSON.parse(String(data));
  if (typeof frame.reply_to === 'number' && pending.has(frame.reply_to)) {
    const resolve = pending.get(frame.reply_to);
    pending.delete(frame.reply_to);
    resolve(frame);
    return;
  }
  events.push(frame);
  for (const waiter of [...waiters]) {
    if (waiter.match(frame)) {
      waiters.splice(waiters.indexOf(waiter), 1);
      waiter.resolve(frame);
    }
  }
});

function rpc(id, body, timeout = 20_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`timeout waiting for reply ${id}`));
    }, timeout);
    pending.set(id, (frame) => {
      clearTimeout(timer);
      resolve(frame);
    });
    socket.send(JSON.stringify({ v: 1, id, ...body }));
  });
}

function event(match, timeout = 30_000) {
  const existing = events.find(match);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const waiter = { match, resolve };
    waiters.push(waiter);
    setTimeout(() => {
      const index = waiters.indexOf(waiter);
      if (index >= 0) waiters.splice(index, 1);
      reject(new Error('timeout waiting for event'));
    }, timeout);
  });
}

await new Promise((resolve, reject) => {
  socket.once('open', resolve);
  socket.once('error', reject);
});

await rpc(1, { req: 'hello', min_version: 1, max_version: 1, client: 'jcode-mobile/0.1.0' });
const listed = await rpc(2, { req: 'list_sessions', limit: 100, include_archived: false });
const sessions = Array.isArray(listed.sessions) ? listed.sessions : [];
const candidates = sessions.filter(
  (session) => !titleMatch || String(session.title ?? '').includes(titleMatch),
);
candidates.sort((left, right) => Number(right.updated_at_ms ?? 0) - Number(left.updated_at_ms ?? 0));
const target = candidates[0];
if (!target) throw new Error('no matching session');

const attached = await rpc(3, { req: 'attach_session', session_id: target.session_id });
if (attached.ev !== 'attached') throw new Error(`attach failed: ${attached.ev}`);

const clientMessageId = `second_${randomUUID()}`;
await rpc(4, {
  req: 'send_message',
  session_id: target.session_id,
  content: message,
  client_message_id: clientMessageId,
});
let accepted = false;
try {
  await event(
    (frame) =>
      frame.ev === 'message_accepted' && frame.client_message_id === clientMessageId,
    30_000,
  );
  accepted = true;
} catch {
  accepted = false;
}

console.log(
  JSON.stringify({
    session_id: target.session_id,
    title: target.title ?? null,
    sent: true,
    accepted,
  }),
);
socket.close();
