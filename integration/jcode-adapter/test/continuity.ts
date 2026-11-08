/**
 * Real-JCode continuity proof (A01).
 *
 * Runs against the isolated staging daemon through the mobile adapter:
 *   1. create a session and start a deterministic long shell tool
 *   2. abruptly terminate the phone transport mid-tool (no graceful goodbye)
 *   3. observe the sentinel file appear while the transport is gone
 *   4. reattach the same session and reconcile authoritative history
 *
 * Evidence is written to docs/evidence/continuity-<timestamp>.json (no secrets).
 */
import { spawnSync } from 'node:child_process';
import { appendFile, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { WebSocket } from 'ws';

const base = process.env.ADAPTER_BASE ?? 'http://127.0.0.1:7643';
const wsBase = base.replace(/^http/, 'ws');
const workDir = process.env.STAGING_WORK_DIR ?? '/tmp/jcode-mobile-staging/work';
const evidenceDir = join(process.cwd(), 'docs', 'evidence');

interface Client {
  socket: WebSocket;
  frames: Array<Record<string, unknown>>;
  call: (request: Record<string, unknown>, timeoutMs?: number) => Promise<Record<string, unknown>>;
  close: () => void;
  waitFor: (predicate: (frame: Record<string, unknown>) => boolean, timeoutMs: number) => Promise<Record<string, unknown>>;
}

function pairingCode(): string {
  const result = spawnSync('jcode', ['pair'], { encoding: 'utf8', env: process.env, timeout: 30_000 });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const match = /(\d{6})/.exec(output.replace(/\s/g, ''));
  if (!match) throw new Error('could not mint a pairing code');
  return match[1];
}

async function pair(): Promise<string> {
  const response = await fetch(`${base}/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      code: pairingCode(),
      device_id: 'continuity-device-0001',
      device_name: 'Continuity Test',
    }),
  });
  const body = (await response.json()) as { ok: boolean; token?: string; error?: string };
  if (!body.ok || !body.token) throw new Error(`pair failed: ${body.error}`);
  return body.token;
}

async function connect(token: string): Promise<Client> {
  const socket = new WebSocket(`${wsBase}/ws`, { headers: { authorization: `Bearer ${token}` } });
  const frames: Array<Record<string, unknown>> = [];
  let nextId = 1;
  const pending = new Map<number, (frame: Record<string, unknown>) => void>();
  const waiters: Array<{ predicate: (frame: Record<string, unknown>) => boolean; resolve: (frame: Record<string, unknown>) => void }> = [];

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
    for (let index = waiters.length - 1; index >= 0; index -= 1) {
      if (waiters[index].predicate(frame)) {
        const [waiter] = waiters.splice(index, 1);
        waiter.resolve(frame);
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
    call: (request, timeoutMs = 20_000) =>
      new Promise((resolve, reject) => {
        const id = nextId++;
        const timer = setTimeout(() => reject(new Error(`timeout: ${String(request.req)}`)), timeoutMs);
        pending.set(id, (frame) => {
          clearTimeout(timer);
          resolve(frame);
        });
        socket.send(JSON.stringify({ v: 1, id, ...request }));
      }),
    close: () => socket.terminate(),
    waitFor: (predicate, timeoutMs) =>
      new Promise((resolve, reject) => {
        const existing = frames.find(predicate);
        if (existing) return resolve(existing);
        const timer = setTimeout(() => reject(new Error('timed out waiting for frame')), timeoutMs);
        waiters.push({
          predicate,
          resolve: (frame) => {
            clearTimeout(timer);
            resolve(frame);
          },
        });
      }),
  };
}

async function waitForFile(path: string, timeoutMs: number): Promise<{ at: number; content: string } | null> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const info = await stat(path);
      return { at: info.mtimeMs, content: await readFile(path, 'utf8') };
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return null;
}

async function main(): Promise<void> {
  await mkdir(evidenceDir, { recursive: true });
  await rm(join(workDir, 'progress.log'), { force: true });
  await rm(join(workDir, 'final.log'), { force: true });
  await rm(join(workDir, 'disconnect.log'), { force: true });

  const token = await pair();
  const client = await connect(token);
  const hello = await client.call({ req: 'hello', min_version: 1, max_version: 1, client: 'continuity/1' });
  const capabilities = hello.capabilities as string[];
  if (!capabilities.includes('mobile_continuation')) {
    throw new Error('adapter did not advertise mobile_continuation');
  }

  const before = await client.call({ req: 'list_sessions', limit: 200 });
  const beforeCount = (before.sessions as unknown[]).length;

  const requestKey = `continuity-${Date.now()}`;
  const created = await client.call({
    req: 'create_session',
    working_dir: workDir,
    client_request_id: requestKey,
  });
  const sessionId = String((created.session as Record<string, unknown>).session_id);
  const attachmentId = String(created.attachment_id);
  const continuation = created.continuation === true;
  if (!continuation) throw new Error('attached without continuation');

  await client.call({ req: 'get_history', session_id: sessionId });

  const instruction = [
    'Use your bash/shell tool to run this exact command in the current working directory,',
    'and wait for it to finish before replying:',
    'for i in 1 2 3 4 5 6; do echo "step-$i $(date +%s)" >> progress.log; sleep 4; done; echo "FINAL-$(date +%s)" >> final.log',
    'After it finishes, reply with exactly: COMPLETE',
  ].join(' ');
  const clientMessageId = `cont-${Date.now()}`;
  const sendAck = await client.call({
    req: 'send_message',
    session_id: sessionId,
    content: instruction,
    client_message_id: clientMessageId,
  });
  if (sendAck.ev !== 'ok') throw new Error('send was not acknowledged by the adapter');

  const accepted = await client.waitFor(
    (frame) => frame.ev === 'message_accepted' && frame.client_message_id === clientMessageId,
    60_000,
  );
  const toolStart = await client.waitFor((frame) => frame.ev === 'tool_start', 90_000);
  const toolExec = await client.waitFor((frame) => frame.ev === 'tool_exec', 90_000);

  const disconnectedAt = Date.now();
  const socketClosedAt = new Date(disconnectedAt).toISOString();
  client.close();
  await appendFile(join(workDir, 'disconnect.log'), `disconnect ${disconnectedAt}\n`);

  const finalFile = await waitForFile(join(workDir, 'final.log'), 150_000);
  const progress = await readFile(join(workDir, 'progress.log'), 'utf8').catch(() => '');
  const finishedAt = finalFile?.at ?? 0;

  const reconnect = await connect(token);
  await reconnect.call({ req: 'hello', min_version: 1, max_version: 1, client: 'continuity/1' });
  const reattached = await reconnect.call({ req: 'attach_session', session_id: sessionId });
  const reattachmentId = String(reattached.attachment_id);
  const firstHistory = await reconnect.waitFor((frame) => frame.ev === 'history', 20_000);

  // Wait for authoritative idle status, then re-read history so the final
  // assistant message (persisted with the terminal event) is included.
  const status = await reconnect
    .waitFor((frame) => frame.ev === 'session_status' && frame.status === 'idle', 45_000)
    .catch(() => null);
  await reconnect.call({ req: 'get_history', session_id: sessionId });
  const history = await reconnect
    .waitFor(
      (frame) =>
        frame.ev === 'history' &&
        frame.attachment_id === reattachmentId &&
        (frame.messages as Array<Record<string, unknown>>).some(
          (message) => message.role === 'assistant' && String(message.content).trim().length > 0,
        ),
      45_000,
    )
    .catch(() => firstHistory);

  const historyMessages = history.messages as Array<Record<string, unknown>>;
  const userMessages = historyMessages.filter((message) => message.role === 'user' && String(message.content).includes('for i in 1 2 3 4 5 6'));
  const assistantText = historyMessages
    .filter((message) => message.role === 'assistant')
    .map((message) => String(message.content))
    .join('\n');

  const after = await reconnect.call({ req: 'list_sessions', limit: 200 });
  const afterCount = (after.sessions as unknown[]).length;
  reconnect.close();

  const evidence = {
    recordedAt: new Date().toISOString(),
    adapter: base,
    sessionId,
    attachmentId,
    reattachmentId,
    continuationFlag: continuation,
    capabilities,
    clientMessageId,
    acceptedAt: accepted.ev,
    tool: { start: toolStart.name, callId: toolExec.call_id, input: toolExec.input },
    disconnectedAt: socketClosedAt,
    progressLines: progress.trim().split('\n').filter(Boolean),
    final: finalFile ? { at: new Date(finishedAt).toISOString(), content: finalFile.content.trim() } : null,
    continuedWhilePhoneAbsent: finishedAt > disconnectedAt,
    history: {
      total: history.total_messages,
      baseIndex: history.base_index,
      userMessagesMatchingInstruction: userMessages.length,
      assistantTail: assistantText.slice(-800),
    },
    sessionCountBefore: beforeCount,
    sessionCountAfter: afterCount,
    reconciledStatus: status ? status.status : null,
  };
  const evidencePath = join(evidenceDir, `continuity-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  await import('node:fs/promises').then((fs) => fs.writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`));

  const failures: string[] = [];
  if (!evidence.continuedWhilePhoneAbsent) failures.push('the tool did not finish while the phone transport was absent');
  if (evidence.progressLines.length < 6) failures.push(`progress.log has ${evidence.progressLines.length} lines, expected 6`);
  if (userMessages.length !== 1) failures.push(`history has ${userMessages.length} matching user messages, expected 1`);
  if (!assistantText.toLowerCase().includes('complete')) failures.push('assistant completion text missing from history');
  if (afterCount !== beforeCount + 1) failures.push(`session count changed unexpectedly: ${beforeCount} -> ${afterCount}`);

  console.log(JSON.stringify(evidence, null, 2));
  if (failures.length) {
    console.error('FAIL');
    for (const failure of failures) console.error(` - ${failure}`);
    process.exit(1);
  }
  console.log(`PASS evidence=${evidencePath}`);
}

main().catch((error: Error) => {
  console.error('FAIL', error.message);
  process.exit(1);
});
