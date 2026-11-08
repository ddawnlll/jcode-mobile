/**
 * Daemon-death test (A04). The staging daemon is killed while the phone is
 * absent, then restarted. Reopening must not claim uninterrupted execution.
 *
 * Usage: node integration/jcode-adapter/test/daemon-death.ts
 */
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocket } from 'ws';

const base = process.env.ADAPTER_BASE ?? 'http://127.0.0.1:7643';
const wsBase = base.replace(/^http/, 'ws');
const workDir = process.env.STAGING_WORK_DIR ?? '/tmp/jcode-mobile-staging/work';
const stage =
  process.env.JCODE_STAGING_DIR ??
  `${process.env.JCODE_SCRATCH_DIR ?? '/tmp'}/jcode-mobile-staging`;

function pairingCode(): string {
  const result = spawnSync('jcode', ['pair'], { encoding: 'utf8', env: process.env, timeout: 30_000 });
  const match = /(\d{6})/.exec(`${result.stdout ?? ''}${result.stderr ?? ''}`.replace(/\s/g, ''));
  if (!match) throw new Error('could not mint a pairing code');
  return match[1];
}

async function pair(): Promise<string> {
  const response = await fetch(`${base}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: pairingCode(), device_id: 'daemon-death-0001', device_name: 'Daemon Death' }),
  });
  const body = (await response.json()) as { ok: boolean; token?: string; error?: string };
  if (!body.ok || !body.token) throw new Error(`pair failed: ${body.error}`);
  return body.token;
}

async function connect(token: string) {
  const socket = new WebSocket(`${wsBase}/ws`, { headers: { authorization: `Bearer ${token}` } });
  const frames: Array<Record<string, unknown>> = [];
  let nextId = 1;
  const pending = new Map<number, (frame: Record<string, unknown>) => void>();
  socket.on('message', (data) => {
    const frame = JSON.parse(data.toString()) as Record<string, unknown>;
    frames.push(frame);
    if (typeof frame.reply_to === 'number') {
      const resolve = pending.get(frame.reply_to);
      if (resolve) {
        pending.delete(frame.reply_to);
        resolve(frame);
      }
    }
  });
  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  return {
    socket,
    frames,
    call: (request: Record<string, unknown>, timeoutMs = 20_000) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => reject(new Error(`timeout ${String(request.req)}`)), timeoutMs);
        pending.set(id, (frame) => {
          clearTimeout(timer);
          resolve(frame);
        });
        socket.send(JSON.stringify({ v: 1, id, ...request }));
      }),
    waitFor: (predicate: (frame: Record<string, unknown>) => boolean, timeoutMs: number) =>
      new Promise<Record<string, unknown>>((resolve, reject) => {
        const existing = frames.find(predicate);
        if (existing) return resolve(existing);
        const started = Date.now();
        const timer = setInterval(() => {
          const found = frames.find(predicate);
          if (found) {
            clearInterval(timer);
            resolve(found);
          } else if (Date.now() - started > timeoutMs) {
            clearInterval(timer);
            reject(new Error('timed out waiting for frame'));
          }
        }, 250);
      }),
  };
}

async function main(): Promise<void> {
  const token = await pair();
  const client = await connect(token);
  await client.call({ req: 'hello', min_version: 1, max_version: 1, client: 'daemon-death/1' });
  const created = await client.call({
    req: 'create_session',
    working_dir: workDir,
    client_request_id: `death-${Date.now()}`,
  });
  const sessionId = String((created.session as Record<string, unknown>).session_id);

  await client.call({
    req: 'send_message',
    session_id: sessionId,
    content:
      'Use your bash/shell tool to run: for i in 1 2 3 4 5 6 7 8; do echo tick-$i >> death.log; sleep 4; done; echo done >> death.log',
    client_message_id: `death-msg-${Date.now()}`,
  });
  await client.waitFor((frame) => frame.ev === 'tool_start', 90_000);
  client.socket.terminate();
  console.log('phone transport closed; killing staging daemon');

  const pidFile = join(stage, 'serve.pid');
  const pid = Number((await readFile(pidFile, 'utf8')).trim());
  process.kill(pid, 'SIGKILL');
  await new Promise((resolve) => setTimeout(resolve, 3000));

  const restart = spawnSync('bash', ['scripts/staging-up.sh'], {
    encoding: 'utf8',
    env: { ...process.env, JCODE_STAGING_DIR: stage },
    timeout: 60_000,
  });
  if (restart.status !== 0) throw new Error(`staging restart failed: ${restart.stderr}`);
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const reopen = await connect(token);
  await reopen.call({ req: 'hello', min_version: 1, max_version: 1, client: 'daemon-death/1' });
  const attached = await reopen.call({ req: 'attach_session', session_id: sessionId });
  const history = await reopen.waitFor(
    (frame) => frame.ev === 'history' && frame.attachment_id === attached.attachment_id,
    30_000,
  );
  const statusFrames = reopen.frames.filter(
    (frame) => frame.ev === 'session_status' && frame.attachment_id === attached.attachment_id,
  );
  const workingClaim = statusFrames.some((frame) => frame.status === 'running');
  const evidence = {
    recordedAt: new Date().toISOString(),
    sessionId,
    attachmentId: attached.attachment_id,
    interruptedAtAttach: history.interrupted_at_attach === true,
    recovery: history.recovery ?? null,
    historyMessages: Array.isArray(history.messages) ? history.messages.length : 0,
    claimedWorking: workingClaim,
    statuses: statusFrames.map((frame) => frame.status),
  };
  reopen.socket.terminate();
  console.log(JSON.stringify(evidence, null, 2));

  if (!evidence.interruptedAtAttach) {
    console.error('FAIL: reattachment did not report a source-backed interruption');
    process.exit(1);
  }
  if (evidence.claimedWorking) {
    console.error('FAIL: reattachment claimed the turn was still running after daemon death');
    process.exit(1);
  }
  console.log('PASS');
}

main().catch((error: Error) => {
  console.error('FAIL', error.message);
  process.exit(1);
});
