#!/usr/bin/env bun
/**
 * Adapter A/B streaming client. Pairs with one adapter, creates a session on
 * the isolated daemon, sends one prompt, and records exactly what reached the
 * WebSocket.
 *
 * Env:
 *   ADAPTER_URL   http://127.0.0.1:PORT
 *   PAIR_CODE     adapter pairing code
 *   WORKDIR       allowed session working directory
 *   LABEL         old | new (free label)
 *   OUT           metrics JSON path
 *   PROMPT        message body (default "bench")
 *   MAX_MS        hard collection window after dispatch (default 60000)
 *   IDLE_MS       finish after this much silence following text (default 1500)
 */
import WebSocket from 'ws';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const BASE = process.env.ADAPTER_URL ?? 'http://127.0.0.1:7655';
const PAIR_CODE = process.env.PAIR_CODE ?? '482913';
const WORKDIR = process.env.WORKDIR ?? process.cwd();
const LABEL = process.env.LABEL ?? 'adapter';
const OUT = process.env.OUT ?? '/tmp/adapter-bench.json';
const PROMPT = process.env.PROMPT ?? 'bench';
const MAX_MS = Number(process.env.MAX_MS ?? 60_000);
const IDLE_MS = Number(process.env.IDLE_MS ?? 1_500);
const PROTOCOL = Number(process.env.PROTOCOL ?? 4);
const PREWARM_MS = Number(process.env.PREWARM_MS ?? 2_500);

const now = () => performance.now();
const t0 = now();

type Frame = {
  at_ms: number;
  transport: 'text' | 'binary' | 'control';
  bytes: number;
  msg_type?: string;
  v?: number;
  event_kind?: string;
  text_bytes?: number;
  session_id?: string;
  seq?: number;
  operation_state?: string;
  binary_bytes?: number;
};

const frames: Frame[] = [];
const messageTypes: Record<string, number> = {};
const eventKinds: Record<string, number> = {};
let textDeltaBytes = 0;
let textDeltaCount = 0;
let firstDeltaAt: number | null = null;
let lastDeltaAt: number | null = null;
let completedAt: number | null = null;
let wsBinaryFrames = 0;
let wsBinaryBytes = 0;
let transportBytesDescriptors = 0;
let assembledBytes = 0;
let assembling: { expected: number; chunks: Buffer[]; got: number } | null = null;
let assembledPackages = 0;
let assembledJsonOk = 0;
let assembledUtf8Ok = 0;

function note(type: string, delta = 1) {
  messageTypes[type] = (messageTypes[type] ?? 0) + delta;
}

function handleSessionEvent(payload: unknown) {
  const event = (payload as { event?: { kind?: string; text?: string } } | null)?.event;
  const kind = event?.kind;
  if (!kind) return;
  eventKinds[kind] = (eventKinds[kind] ?? 0) + 1;
  if (kind === 'text_delta') {
    const text = event?.text ?? '';
    textDeltaCount += 1;
    textDeltaBytes += Buffer.byteLength(text, 'utf8');
    const at = now();
    if (firstDeltaAt == null) firstDeltaAt = at;
    lastDeltaAt = at;
  }
  if (kind === 'turn_stopped' || kind === 'turn_done') {
    completedAt = now();
  }
}

async function pair(): Promise<string> {
  const response = await fetch(`${BASE}/v2/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: PAIR_CODE, device_name: `bench-${LABEL}` }),
  });
  const body = (await response.json().catch(() => ({}))) as { token?: string; message?: string };
  if (!response.ok || !body.token) {
    throw new Error(`pair failed ${response.status}: ${body.message ?? 'no token'}`);
  }
  return body.token;
}

const tokenFile = process.env.TOKEN_FILE ?? `${OUT}.token`;
let token = process.env.TOKEN ?? '';
if (!token && existsSync(tokenFile)) {
  token = readFileSync(tokenFile, 'utf8').trim();
}
if (!token) {
  token = await pair();
  writeFileSync(tokenFile, token);
}
const pairAt = now();

const wsUrl = BASE.replace(/^http/, 'ws') + '/v2/ws';
const socket = new WebSocket(wsUrl, ['jcode.mobile.v3', `token.${token}`], {
  headers: { Authorization: `Bearer ${token}` },
});

let nextId = 1;
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (reason: Error) => void }>();

function request(
  type: string,
  payload: unknown,
  extra: { session_id?: string; operation_id?: string } = {},
): Promise<any> {
  const id = `bench_${nextId++}`;
  const sentAt = now();
  const frame = {
    v: PROTOCOL,
    kind: 'request',
    id,
    type,
    payload,
    ...extra,
  };
  socket.send(JSON.stringify(frame));
  note(type);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`${type} timed out after ${Math.round(now() - sentAt)}ms`));
    }, 60_000);
    pending.set(id, {
      resolve: (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      reject: (reason) => {
        clearTimeout(timer);
        reject(reason);
      },
    });
  });
}

const opened = new Promise<void>((resolve, reject) => {
  socket.once('open', () => resolve());
  socket.once('error', (error) => reject(error));
});

socket.on('message', (data, isBinary) => {
  const at = now();
  const size = isBinary ? (data as Buffer).length : Buffer.byteLength(String(data));
  if (isBinary) {
    wsBinaryFrames += 1;
    wsBinaryBytes += size;
    assembledBytes += size;
    const last = frames[frames.length - 1];
    if (last && last.msg_type === 'transport.bytes') {
      last.binary_bytes = (last.binary_bytes ?? 0) + size;
    }
    if (assembling) {
      assembling.chunks.push(Buffer.from(data as Buffer));
      assembling.got += size;
      if (assembling.got >= assembling.expected) {
        const buffer = Buffer.concat(assembling.chunks);
        const text = buffer.toString('utf8');
        assembledPackages += 1;
        if (!text.includes('\uFFFD')) assembledUtf8Ok += 1;
        try {
          JSON.parse(text);
          assembledJsonOk += 1;
        } catch {
          // counted as a package that did not decode to JSON
        }
        assembling = null;
      }
    }
    return;
  }
  let parsed: any = null;
  try {
    parsed = JSON.parse(String(data));
  } catch {
    // A non-JSON frame is still measured.
  }
  const type = parsed?.type ?? 'unparsed';
  note(type);
  const frame: Frame = {
    at_ms: Math.round(at - t0),
    transport: 'text',
    bytes: size,
    msg_type: type,
    v: parsed?.v,
    session_id: parsed?.session_id,
    seq: parsed?.seq,
  };
  if (type === 'session.event') {
    frame.event_kind = parsed?.payload?.event?.kind;
    if (frame.event_kind === 'text_delta') {
      frame.text_bytes = Buffer.byteLength(parsed?.payload?.event?.text ?? '', 'utf8');
    }
    handleSessionEvent(parsed?.payload);
  } else if (type === 'operations.state') {
    frame.operation_state = parsed?.payload?.operation?.state;
  } else if (type === 'transport.bytes') {
    transportBytesDescriptors += 1;
    const expected = parsed?.payload?.length;
    if (typeof expected === 'number') {
      assembling = { expected, chunks: [], got: 0 };
    }
  }
  frames.push(frame);

  if (parsed?.kind === 'response' && parsed?.reply_to && pending.has(parsed.reply_to)) {
    const waiter = pending.get(parsed.reply_to)!;
    pending.delete(parsed.reply_to);
    if (parsed.type === 'error' || parsed?.payload?.code) {
      waiter.reject(new Error(`${parsed.type}: ${parsed?.payload?.message ?? 'error'}`));
    } else {
      waiter.resolve({ at: at, payload: parsed.payload });
    }
  }
});

function closeAndFinish(noteText: string) {
  try {
    socket.close();
  } catch {
    // best effort
  }
  const end = now();
  const metrics = {
    label: LABEL,
    note: noteText,
    adapter_version: undefined as string | undefined,
    t_pair_ms: Math.round(pairAt - t0),
    t_hello_ms: helloMs,
    t_create_ms: createMs,
    t_subscribe_ms: subscribeMs,
    t_reserve_ms: reserveMs,
    t_dispatch_ms: dispatchMs,
    t_first_delta_ms: firstDeltaAt == null ? null : Math.round(firstDeltaAt - t0),
    t_last_delta_ms: lastDeltaAt == null ? null : Math.round(lastDeltaAt - t0),
    t_completed_ms: completedAt == null ? null : Math.round(completedAt - t0),
    dispatch_to_first_delta_ms:
      firstDeltaAt == null ? null : Math.round(firstDeltaAt - dispatchAt),
    first_to_last_delta_ms:
      firstDeltaAt == null || lastDeltaAt == null ? null : Math.round(lastDeltaAt - firstDeltaAt),
    total_wall_ms: Math.round(end - t0),
    text_delta_count: textDeltaCount,
    text_delta_bytes: textDeltaBytes,
    ws_text_frames: frames.filter((frame) => frame.transport === 'text').length,
    ws_text_bytes: frames.filter((frame) => frame.transport === 'text').reduce((sum, frame) => sum + frame.bytes, 0),
    ws_binary_frames: wsBinaryFrames,
    ws_binary_bytes: wsBinaryBytes,
    transport_bytes_descriptors: transportBytesDescriptors,
    assembled_packages: assembledPackages,
    assembled_json_ok: assembledJsonOk,
    assembled_utf8_ok: assembledUtf8Ok,
    session_event_frames: frames.filter((frame) => frame.msg_type === 'session.event').length,
    max_text_frame_bytes: frames.reduce((max, frame) => Math.max(max, frame.bytes), 0),
    message_types: messageTypes,
    event_kinds: eventKinds,
    frames,
  };
  writeFileSync(OUT, JSON.stringify(metrics, null, 2));
  console.log(JSON.stringify({ ...metrics, frames: `see ${OUT}` }, null, 2));
  process.exit(0);
}

let helloMs: number | null = null;
let createMs: number | null = null;
let subscribeMs: number | null = null;
let reserveMs: number | null = null;
let dispatchMs: number | null = null;
let dispatchAt = 0;

await opened;
const helloAt = now();
const hello = await request('client.hello', {
  client_name: 'jcode-mobile-bench',
  client_version: '1.0.0',
  min_version: 2,
  max_version: PROTOCOL,
  supports: ['events', 'runtime', 'swarm', 'transport.bytes'],
});
helloMs = Math.round(now() - helloAt);

const createAt = now();
const created = await request('sessions.create', {
  client_request_id: `bench_create_${LABEL}_${Date.now().toString(36)}`,
  project_id: null,
  working_dir: WORKDIR,
  title: `Bench ${LABEL}`,
});
createMs = Math.round(now() - createAt);
const sessionId = created.payload?.session?.session_id as string;
if (!sessionId) throw new Error('sessions.create returned no session_id');

const subscribeAt = now();
await request('sessions.subscribe', { session_id: sessionId, tail: 32, after_seq: null }, { session_id: sessionId });
subscribeMs = Math.round(now() - subscribeAt);
if (PREWARM_MS > 0) await new Promise((resolve) => setTimeout(resolve, PREWARM_MS));

const operationId = `bench_op_${LABEL}_${Date.now().toString(36)}`;
const reserveAt = now();
await request(
  'operations.reserve',
  {
    operation_id: operationId,
    session_id: sessionId,
    kind: 'send',
    body: PROMPT,
    expected_turn_id: null,
    images: [],
  },
  { session_id: sessionId, operation_id: operationId },
);
reserveMs = Math.round(now() - reserveAt);

const dispatchStart = now();
const dispatched = await request(
  'operations.dispatch',
  { operation_id: operationId },
  { session_id: sessionId, operation_id: operationId },
);
dispatchMs = Math.round(now() - dispatchStart);
dispatchAt = now();

// Wait for the stream to settle. The turn is finished when a turn_stopped or
// idle status arrives, or after IDLE_MS of silence once text has started.
const deadline = dispatchAt + MAX_MS;
let idleCheck: ReturnType<typeof setInterval> | null = null;
idleCheck = setInterval(() => {
  const nowMs = now();
  if (completedAt != null) {
    if (idleCheck) clearInterval(idleCheck);
    closeAndFinish(`completed dispatch=${JSON.stringify(dispatched.payload?.operation?.state)}`);
    return;
  }
  if (lastDeltaAt != null && nowMs - lastDeltaAt > IDLE_MS) {
    if (idleCheck) clearInterval(idleCheck);
    closeAndFinish('idle after last delta');
    return;
  }
  if (nowMs > deadline) {
    if (idleCheck) clearInterval(idleCheck);
    closeAndFinish('deadline');
  }
}, 50);
