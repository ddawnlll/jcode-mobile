/**
 * Adapter smoke test: pairing, handshake, inventory, create, attach, send,
 * streaming, and a clean turn. Run against an isolated staging daemon.
 *
 * Usage: node integration/jcode-adapter/test/smoke.ts
 */
import { spawnSync } from 'node:child_process';
import { WebSocket } from 'ws';

const base = process.env.ADAPTER_BASE ?? 'http://127.0.0.1:7643';
const wsBase = base.replace(/^http/, 'ws');

function runJcode(args: string[]): { ok: boolean; stdout: string } {
  const result = spawnSync('jcode', args, {
    encoding: 'utf8',
    env: process.env,
    timeout: 30_000,
  });
  return { ok: result.status === 0, stdout: `${result.stdout ?? ''}${result.stderr ?? ''}` };
}

function pairingCode(): string {
  const result = runJcode(['pair']);
  const match = /(\d{6})/.exec(result.stdout.replace(/\s/g, ''));
  if (!match) throw new Error(`no pairing code in output: ${result.stdout.slice(0, 300)}`);
  return match[1];
}

async function main(): Promise<void> {
  const health = await fetch(`${base}/health`).then((response) => response.json());
  console.log('health', health);

  const code = pairingCode();
  const pairResponse = await fetch(`${base}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, device_id: 'smoke-device-0001', device_name: 'Smoke Test' }),
  });
  const paired = (await pairResponse.json()) as { ok: boolean; token?: string; error?: string };
  if (!paired.ok || !paired.token) throw new Error(`pair failed: ${paired.error}`);
  console.log('paired ok');

  const socket = new WebSocket(`${wsBase}/ws`, {
    headers: { authorization: `Bearer ${paired.token}` },
  });
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
    const interesting = ['attached', 'history', 'message_accepted', 'tool_start', 'tool_exec', 'tool_done', 'turn_done', 'turn_stopped', 'error', 'session_status'];
    if (interesting.includes(String(frame.ev))) {
      const short = { ...frame };
      if (typeof short.output === 'string' && short.output.length > 120) short.output = `${short.output.slice(0, 120)}…`;
      if (typeof short.content === 'string' && short.content.length > 120) short.content = `${short.content.slice(0, 120)}…`;
      console.log('event', JSON.stringify(short));
    }
  });

  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });

  const call = (request: Record<string, unknown>, timeoutMs = 20_000) =>
    new Promise<Record<string, unknown>>((resolve, reject) => {
      const id = nextId++;
      const timer = setTimeout(() => reject(new Error(`timeout: ${String(request.req)}`)), timeoutMs);
      pending.set(id, (frame) => {
        clearTimeout(timer);
        resolve(frame);
      });
      socket.send(JSON.stringify({ v: 1, id, ...request }));
    });

  const hello = await call({ req: 'hello', min_version: 1, max_version: 1, client: 'smoke/1' });
  console.log('hello', hello.ev, hello.capabilities);

  const sessions = await call({ req: 'list_sessions', limit: 50 });
  console.log('sessions', sessions.ev, Array.isArray(sessions.sessions) ? sessions.sessions.length : sessions);

  const created = await call({
    req: 'create_session',
    working_dir: process.env.STAGING_WORK_DIR ?? '/Users/hootie/.jcode/scratch/jcode-mobile-staging/work',
    client_request_id: `smoke-${Date.now()}`,
  });
  console.log('created', created.ev, created.session_id ?? (created.session as Record<string, unknown> | undefined)?.session_id);
  const sessionId = String(
    (created.session_id as string | undefined) ??
      ((created.session as Record<string, unknown> | undefined)?.session_id as string | undefined) ??
      '',
  );
  if (!sessionId) throw new Error('no session id');

  const sent = await call({ req: 'send_message', session_id: sessionId, content: 'Reply with exactly the word: ready', client_message_id: `m-${Date.now()}` });
  console.log('send ack', sent.ev);

  await new Promise((resolve) => setTimeout(resolve, 30_000));
  console.log('frame count', frames.length);
  socket.close();
}

main().catch((error: Error) => {
  console.error('FAIL', error.message);
  process.exit(1);
});
