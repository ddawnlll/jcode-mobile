/**
 * Adapter v3 real-stack smoke test.
 *
 * Requires `scripts/v3-smoke-up.sh`, which starts an isolated JCode daemon and
 * the Rust adapter. This script performs a real agent turn: it sends one short
 * prompt through reserve/dispatch and waits for the journaled stream to finish.
 *
 * Every assertion is against the real daemon/adapter, not a mock. The output is
 * machine-readable JSON so evidence can be archived.
 */

const BASE = process.env.V3_SMOKE_BASE_URL ?? 'http://127.0.0.1:7660';
const PAIR_CODE = process.env.V3_SMOKE_PAIR_CODE ?? '482914';
const TURN_TIMEOUT_MS = Number(process.env.V3_SMOKE_TURN_TIMEOUT_MS ?? 180_000);
const PROMPT = process.env.V3_SMOKE_PROMPT ?? 'Reply with exactly: OK';

interface Envelope {
  v: number;
  kind: 'request' | 'response' | 'event';
  id: string;
  reply_to?: string;
  session_id?: string;
  seq?: number;
  type: string;
  payload: any;
}

const evidence: Record<string, unknown> = {
  base: BASE,
  started_at: new Date().toISOString(),
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

class Client {
  private socket: WebSocket;
  private pending = new Map<
    string,
    { resolve: (value: any) => void; reject: (error: Error) => void; timer: number }
  >();
  private listeners = new Map<string, Array<(envelope: Envelope) => void>>();
  version = 3;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.onmessage = (event) => {
      const envelope = JSON.parse(String(event.data)) as Envelope;
      if (envelope.kind === 'response') {
        const pending = envelope.reply_to ? this.pending.get(envelope.reply_to) : undefined;
        if (!pending) return;
        clearTimeout(pending.timer);
        this.pending.delete(envelope.reply_to!);
        if (envelope.type === 'error') {
          pending.reject(new Error(`${envelope.payload.code}: ${envelope.payload.message}`));
        } else {
          pending.resolve(envelope.payload);
        }
        return;
      }
      if (envelope.kind === 'event') {
        for (const listener of this.listeners.get(envelope.type) ?? []) listener(envelope);
      }
    };
  }

  static async open(token: string): Promise<Client> {
    const url = `${BASE.replace(/^http/, 'ws')}/v2/ws`;
    const socket = new WebSocket(url, ['jcode.mobile.v3', 'jcode.mobile.v2', `token.${token}`]);
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error('websocket failed'));
      socket.onclose = (event) => reject(new Error(`websocket closed ${event.code}`));
    });
    return new Client(socket);
  }

  on(type: string, listener: (envelope: Envelope) => void) {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  request<T = any>(
    type: string,
    payload: Record<string, unknown>,
    opts: { timeoutMs?: number; version?: number } = {},
  ): Promise<T> {
    const id = `req_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    const envelope = {
      v: opts.version ?? this.version,
      kind: 'request',
      id,
      type,
      payload,
    };
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${type} timed out`));
      }, opts.timeoutMs ?? 30_000) as unknown as number;
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify(envelope));
    });
  }

  close() {
    this.socket.close(1000, 'smoke complete');
  }
}

async function main() {
  // 1. Pair over HTTP.
  const pairResponse = await fetch(`${BASE}/v2/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: PAIR_CODE, device_name: 'v3-smoke' }),
  });
  if (!pairResponse.ok) {
    throw new Error(`pair failed: ${pairResponse.status} ${await pairResponse.text()}`);
  }
  const paired = (await pairResponse.json()) as {
    token: string;
    device: { device_id: string };
    server: { server_id: string; adapter_version: string };
  };
  assert(paired.token, 'pair returned no token');
  evidence.server_id = paired.server.server_id;
  evidence.device_id = paired.device.device_id;

  // 2. Handshake at v2; a v3 adapter negotiates v3.
  const client = await Client.open(paired.token);
  const hello = await client.request<{
    server: { capabilities: string[]; healthy: boolean; protocol_version: number };
    negotiated_version: number;
    max_protocol_version: number;
  }>(
    'client.hello',
    {
      client_name: 'v3-smoke',
      client_version: '0.4.0',
      min_version: 2,
      max_version: 3,
      supports: ['jcode.mobile.v3', 'jcode.mobile.v2'],
    },
    { version: 2 },
  );
  assert(hello.negotiated_version === 3, `expected v3, got ${hello.negotiated_version}`);
  assert(hello.server.protocol_version === 3, 'server reports a different protocol');
  assert(hello.server.capabilities.includes('events.journal'), 'journal capability missing');
  assert(hello.server.capabilities.includes('attachments.images'), 'image capability missing');
  client.version = hello.negotiated_version;
  evidence.negotiated_version = hello.negotiated_version;
  evidence.jcode_healthy = hello.server.healthy;

  // 3. Create the session under test, then observe full and incremental sync.
  const created = await client.request<any>('sessions.create', {
    client_request_id: `smoke_${Date.now()}`,
    project_id: null,
    working_dir: null,
    title: 'Adapter v3 smoke',
  });
  const sessionId: string = created.session.session_id;
  assert(sessionId, 'create returned no session id');
  evidence.session_id = sessionId;

  const full = await client.request<any>('sessions.delta', {
    since_revision: 0,
    include_projects: true,
  });
  assert(full.full === true, 'first delta must be full');
  assert(typeof full.revision === 'number' && full.revision > 0, 'delta revision missing');
  const firstSummary = full.sessions.find(
    (session: any) => session.session_id === sessionId,
  );
  assert(firstSummary, 'created session missing from the full delta');
  evidence.first_summary = firstSummary;

  const secondCreated = await client.request<any>('sessions.create', {
    client_request_id: `smoke_delta_${Date.now()}`,
    project_id: null,
    working_dir: null,
    title: 'Adapter v3 delta probe',
  });
  const changed = await client.request<any>('sessions.delta', {
    since_revision: full.revision,
    include_projects: false,
  });
  assert(changed.full === false, 'second delta must be incremental');
  assert(
    changed.sessions.some(
      (session: any) => session.session_id === secondCreated.session.session_id,
    ),
    'new session missing from the incremental delta',
  );
  evidence.delta_ids = changed.sessions.map((session: any) => session.session_id);
  const resent = changed.sessions.find(
    (session: any) => session.session_id === sessionId,
  );
  evidence.unchanged_resent = Boolean(resent);
  if (resent) {
    evidence.resent_summary_diff = Object.fromEntries(
      Object.keys(resent)
        .filter(
          (key) =>
            JSON.stringify(resent[key]) !==
            JSON.stringify((firstSummary as Record<string, unknown>)[key]),
        )
        .map((key) => [
          key,
          { before: (firstSummary as Record<string, unknown>)[key], after: resent[key] },
        ]),
    );
  }
  evidence.delta_revision = changed.revision;

  // 4. Subscribe with an authoritative snapshot.
  const subscribed = await client.request<any>('events.subscribe', {
    session_id: sessionId,
    after_seq: 0,
    limit: 100,
    tail: 40,
    include_snapshot: true,
  });
  assert(subscribed.snapshot?.session?.session_id === sessionId, 'snapshot does not match');
  assert(subscribed.resync_required === false, 'initial subscribe asked for a resync');

  // 5. Real turn: reserve + dispatch one short prompt.
  const operationId = `op_smoke_${Date.now()}`;
  const reserved = await client.request<any>(
    'operations.reserve',
    {
      operation_id: operationId,
      session_id: sessionId,
      kind: 'send',
      body: PROMPT,
      expected_turn_id: null,
    },
    { timeoutMs: 20_000 },
  );
  assert(reserved.operation.state === 'staged', 'reserve did not stage');
  const dispatched = await client.request<any>(
    'operations.dispatch',
    { operation_id: operationId },
    { timeoutMs: 60_000 },
  );
  assert(
    ['dispatching', 'accepted'].includes(dispatched.operation.state),
    `unexpected dispatch state ${dispatched.operation.state}`,
  );

  // 6. Wait for the durable journal to report a terminal turn.
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  let latestSeq = 0;
  let text = '';
  let sawTurnDone = false;
  let gapSeen = false;
  while (Date.now() < deadline) {
    const replay = await client.request<any>('events.subscribe', {
      session_id: sessionId,
      after_seq: latestSeq,
      limit: 500,
      tail: 20,
      include_snapshot: false,
    });
    gapSeen ||= Boolean(replay.gap);
    latestSeq = Math.max(latestSeq, replay.latest_seq);
    for (const event of replay.events as any[]) {
      const payload = event.event;
      if (payload.kind === 'text_delta') text += payload.text;
      if (payload.kind === 'turn_done' || payload.kind === 'turn_stopped') {
        sawTurnDone = true;
      }
      if (payload.kind === 'adapter_error') {
        throw new Error(`adapter error: ${payload.code}: ${payload.message}`);
      }
    }
    if (sawTurnDone) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  assert(sawTurnDone, `turn did not finish within ${TURN_TIMEOUT_MS} ms`);
  assert(latestSeq > 0, 'journal assigned no sequence');
  assert(!gapSeen, 'journal reported a gap during one continuous turn');
  evidence.journal_latest_seq = latestSeq;
  evidence.assistant_text = text.slice(0, 500);
  evidence.turn_done = sawTurnDone;

  // 7. Acknowledge the cursor.
  const ack = await client.request<any>('events.ack', {
    session_id: sessionId,
    seq: latestSeq,
  });
  assert(ack.acked_seq === latestSeq, 'ack did not persist the cursor');

  // 8. Diagnostics reflect real state.
  const diagnostics = await client.request<any>('diagnostics.snapshot', {});
  assert(diagnostics.protocol_version === 3, 'diagnostics protocol mismatch');
  assert(diagnostics.journal.events > 0, 'diagnostics reports no journal events');
  assert(diagnostics.journal.append_failures === 0, 'journal append failures');
  evidence.diagnostics = {
    journal_events: diagnostics.journal.events,
    journal_bytes: diagnostics.journal.bytes,
    retention: diagnostics.journal.retention_per_session,
    dispatch_p50_ms: diagnostics.latency.dispatch_p50_ms,
    dispatch_p95_ms: diagnostics.latency.dispatch_p95_ms,
    replay_p50_ms: diagnostics.latency.replay_p50_ms,
    frames_out: diagnostics.connections.frames_out,
  };

  // 9. Reconnect and replay from the acknowledged cursor. The sequence must
  // continue without a gap and without re-executing the prompt.
  client.close();
  const second = await Client.open(paired.token);
  const secondHello = await second.request<any>(
    'client.hello',
    {
      client_name: 'v3-smoke-reconnect',
      client_version: '0.4.0',
      min_version: 2,
      max_version: 3,
      supports: ['jcode.mobile.v3'],
    },
    { version: 2 },
  );
  second.version = secondHello.negotiated_version;
  const replayed = await second.request<any>('events.subscribe', {
    session_id: sessionId,
    after_seq: latestSeq,
    epoch: undefined,
    limit: 100,
    include_snapshot: false,
  });
  assert(replayed.resync_required === false, 'reconnect required an unexpected resync');
  assert(replayed.latest_seq >= latestSeq, 'journal lost acknowledged sequence');
  assert(!replayed.gap, 'reconnect reported a gap');
  evidence.reconnect = {
    latest_seq: replayed.latest_seq,
    replayed_events: replayed.events.length,
  };

  // 10. The operation must not have been dispatched twice.
  const operation = await second.request<any>('operations.lookup', {
    operation_id: operationId,
  });
  assert(
    ['accepted', 'observed_in_history'].includes(operation.operation.state),
    `operation ended in ${operation.operation.state}`,
  );
  evidence.operation_state = operation.operation.state;
  second.close();

  evidence.result = 'PASS';
  evidence.finished_at = new Date().toISOString();
  console.log(JSON.stringify(evidence, null, 2));
}

main().catch((error) => {
  evidence.result = 'FAIL';
  evidence.error = error instanceof Error ? error.message : String(error);
  evidence.finished_at = new Date().toISOString();
  console.error(JSON.stringify(evidence, null, 2));
  process.exit(1);
});
