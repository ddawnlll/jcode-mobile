/**
 * Live Adapter v4 verification.
 *
 * Runs against a real adapter and a real JCode daemon. It is deliberately
 * read-only: it redeems one pairing code, negotiates the protocol, lists
 * sessions, opens a snapshot, checks that a v2 client still negotiates v2, and
 * then revokes the devices it created. It never reserves or dispatches an
 * operation, so it cannot send a prompt or start a turn.
 *
 * Usage:
 *   ADAPTER_PAIR_CODE=XXXX-XXXX-XXXX \
 *   ADAPTER_BASE_URL=https://dawnll.duckdns.org \
 *   bun run scripts/adapter-v4-live-check.ts
 *
 * Env:
 *   ADAPTER_BASE_URL           adapter origin (default http://127.0.0.1:7644)
 *   ADAPTER_PAIR_CODE          pairing code, required
 *   ADAPTER_EXPECT_VERSION     expected adapter_version (default 0.5.0)
 *   ADAPTER_SKIP_PAIR          "1" to reuse ADAPTER_TOKEN instead of pairing
 *   ADAPTER_TOKEN              existing device token when skipping pairing
 *   ADAPTER_KEEP_DEVICE        "1" keeps the device this check paired
 *   ADAPTER_EVIDENCE_PATH      write the JSON evidence to this path as well
 */

import { writeFile } from 'node:fs/promises';

const BASE = (process.env.ADAPTER_BASE_URL ?? 'http://127.0.0.1:7644').replace(/\/+$/, '');
const PAIR_CODE = process.env.ADAPTER_PAIR_CODE ?? '';
const EXPECT_VERSION = process.env.ADAPTER_EXPECT_VERSION ?? '0.5.0';
const SKIP_PAIR = process.env.ADAPTER_SKIP_PAIR === '1';
const EXISTING_TOKEN = process.env.ADAPTER_TOKEN ?? '';
const EVIDENCE_PATH = process.env.ADAPTER_EVIDENCE_PATH ?? '';
const KEEP_DEVICE = process.env.ADAPTER_KEEP_DEVICE === '1';
// Every device this check creates carries this name. Verification runs are
// normally cleanup-on-exit so they cannot litter the server device list.
const DEVICE_NAME = 'adapter-v4-live-check';

// Adapter v4 sends any response larger than one chunk as a JSON
// `transport.bytes` descriptor followed by binary WebSocket frames that the
// client reassembles before decoding. These mirror adapter-protocol.
const BYTE_PACKAGE_CHUNK = 64 * 1024;
const BYTE_PACKAGE_LIMIT = 64 * 1024 * 1024;

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
  expected_adapter_version: EXPECT_VERSION,
  started_at: new Date().toISOString(),
};

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function toBytes(raw: unknown): Promise<Uint8Array | null> {
  if (raw instanceof ArrayBuffer) return new Uint8Array(raw);
  if (ArrayBuffer.isView(raw)) return new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);
  if (typeof Blob !== 'undefined' && raw instanceof Blob) return new Uint8Array(await raw.arrayBuffer());
  return null;
}

class Client {
  private socket: WebSocket;
  private pending = new Map<
    string,
    { resolve: (value: any) => void; reject: (error: Error) => void; timer: number }
  >();
  private listeners = new Map<string, Array<(envelope: Envelope) => void>>();
  private bytePackage: { buffer: Uint8Array; used: number } | null = null;
  version = 4;
  framesOut = 0;
  versionsSeen = new Set<number>();
  bytePackages = 0;

  private constructor(socket: WebSocket) {
    this.socket = socket;
    socket.onmessage = (event) => this.handleFrame(event.data);
  }

  private async handleFrame(raw: unknown) {
    const packet = this.bytePackage;
    if (packet) {
      const bytes = await toBytes(raw);
      const size = bytes?.byteLength ?? 0;
      if (!size || size > BYTE_PACKAGE_CHUNK || packet.used + size > packet.buffer.length) {
        this.bytePackage = null;
        this.socket.close(4002, 'Invalid byte package');
        return;
      }
      packet.buffer.set(bytes!, packet.used);
      packet.used += size;
      if (packet.used < packet.buffer.length) return;
      this.bytePackage = null;
      const text = new TextDecoder('utf-8', { fatal: true }).decode(packet.buffer);
      this.receive(JSON.parse(text) as Envelope);
      return;
    }
    if (typeof raw !== 'string') {
      const bytes = await toBytes(raw);
      if (!bytes) return;
      this.receive(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) as Envelope);
      return;
    }
    const envelope = JSON.parse(raw) as Envelope;
    if (envelope.type === 'transport.bytes' && this.version >= 4) {
      const length = (envelope.payload as { length?: number } | null)?.length;
      assert(typeof length === 'number', 'transport.bytes without a length');
      assert(length > BYTE_PACKAGE_CHUNK && length <= BYTE_PACKAGE_LIMIT, 'byte package out of range');
      this.bytePackages += 1;
      this.bytePackage = { buffer: new Uint8Array(length), used: 0 };
      return;
    }
    this.receive(envelope);
  }

  private receive(envelope: Envelope) {
    this.versionsSeen.add(envelope.v);
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
  }

  static async open(token: string, subprotocols: string[]): Promise<Client> {
    const url = `${BASE.replace(/^http/, 'ws')}/v2/ws`;
    const socket = new WebSocket(url, [...subprotocols, `token.${token}`]);
    socket.binaryType = 'arraybuffer';
    await new Promise<void>((resolve, reject) => {
      socket.onopen = () => resolve();
      socket.onerror = () => reject(new Error('websocket failed'));
      socket.onclose = (event) => reject(new Error(`websocket closed ${event.code}`));
    });
    return new Client(socket);
  }

  request<T = any>(
    type: string,
    payload: Record<string, unknown>,
    opts: { timeoutMs?: number; version?: number } = {},
  ): Promise<T> {
    const id = `req_${Math.random().toString(36).slice(2)}_${Date.now()}`;
    this.framesOut += 1;
    this.socket.send(
      JSON.stringify({ v: opts.version ?? this.version, kind: 'request', id, type, payload }),
    );
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`${type} timed out`));
      }, opts.timeoutMs ?? 30_000) as unknown as number;
      this.pending.set(id, { resolve, reject, timer });
    });
  }

  close() {
    this.socket.close(1000, 'check complete');
  }
}

async function pair(): Promise<{ token: string; deviceId: string; serverId: string }> {
  assert(PAIR_CODE || SKIP_PAIR, 'set ADAPTER_PAIR_CODE (or ADAPTER_SKIP_PAIR=1 with ADAPTER_TOKEN)');
  if (SKIP_PAIR) {
    assert(EXISTING_TOKEN, 'ADAPTER_SKIP_PAIR=1 needs ADAPTER_TOKEN');
    return { token: EXISTING_TOKEN, deviceId: 'reused', serverId: 'reused' };
  }
  const response = await fetch(`${BASE}/v2/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code: PAIR_CODE, device_name: DEVICE_NAME }),
  });
  const body = await response.text();
  assert(response.ok, `pair failed: ${response.status} ${body}`);
  const paired = JSON.parse(body) as {
    token: string;
    device: { device_id: string };
    server: { server_id: string; adapter_version: string; protocol_version: number };
  };
  assert(paired.token, 'pair returned no token');
  evidence.paired_server = paired.server;
  return {
    token: paired.token,
    deviceId: paired.device.device_id,
    serverId: paired.server.server_id,
  };
}

async function main() {
  // 1. Health. This is what a phone shows in Server details.
  const healthResponse = await fetch(`${BASE}/health`);
  assert(healthResponse.ok, `health failed: ${healthResponse.status}`);
  const health = (await healthResponse.json()) as Record<string, any>;
  evidence.health = health;
  assert(
    health.adapter_version === EXPECT_VERSION,
    `expected adapter_version ${EXPECT_VERSION}, got ${health.adapter_version}`,
  );
  assert(health.protocol_version === 4, `expected protocol_version 4, got ${health.protocol_version}`);
  assert(
    health.min_protocol_version === 2,
    `expected min_protocol_version 2, got ${health.min_protocol_version}`,
  );
  assert(health.jcode_connected === true, 'adapter is not connected to the JCode harness');

  // 2. Pair one device. Any client must do this, and it proves the auth path.
  const identity = await pair();
  evidence.device_id = identity.deviceId;
  evidence.server_id = identity.serverId;

  // 3. v4 handshake, the way the 0.5.0 client does it: speak v2 in the hello,
  //    offer every version, and let the adapter select.
  const client = await Client.open(identity.token, [
    'jcode.mobile.v4',
    'jcode.mobile.v3',
    'jcode.mobile.v2',
  ]);
  const hello = await client.request<any>(
    'client.hello',
    {
      client_name: 'adapter-v4-live-check',
      client_version: '0.5.0',
      min_version: 2,
      max_version: 4,
      supports: ['jcode.mobile.v4', 'jcode.mobile.v3', 'jcode.mobile.v2'],
    },
    { version: 2 },
  );
  assert(hello.negotiated_version === 4, `expected v4, got ${hello.negotiated_version}`);
  assert(hello.max_protocol_version === 4, 'adapter did not advertise protocol 4');
  assert(hello.server.protocol_version === 4, 'server reports a different protocol');
  assert(hello.server.adapter_version === EXPECT_VERSION, 'server reports a different version');
  assert(hello.server.healthy === true, 'adapter reports the harness as unhealthy');
  for (const capability of ['events.journal', 'attachments.images', 'diagnostics.snapshot']) {
    assert(hello.server.capabilities.includes(capability), `capability ${capability} missing`);
  }
  client.version = hello.negotiated_version;
  evidence.v4_hello = {
    negotiated_version: hello.negotiated_version,
    max_protocol_version: hello.max_protocol_version,
    adapter_version: hello.server.adapter_version,
    jcode_version: hello.server.jcode_version,
    capabilities: hello.server.capabilities,
    resumed: hello.resumed,
  };

  // 4. Real inventory from the real daemon.
  const list = await client.request<any>('sessions.list', {});
  assert(Array.isArray(list.sessions), 'sessions.list did not return an array');
  evidence.sessions = {
    count: list.sessions.length,
    source: list.source,
    stale: list.stale,
    revision: list.revision ?? null,
    first: list.sessions.slice(0, 3).map((session: any) => ({
      session_id: session.session_id,
      title: session.title,
      status: session.status,
      agent_label: session.agent_label ?? null,
    })),
  };
  if (list.sessions.length > 0) {
    const target = list.sessions[0].session_id as string;

    // 5. Subscribe to the newest session and take an authoritative snapshot.
    const subscribed = await client.request<any>(
      'events.subscribe',
      { session_id: target, after_seq: 0, limit: 100, tail: 40, include_snapshot: true },
      { timeoutMs: 45_000 },
    );
    assert(subscribed.snapshot?.session?.session_id === target, 'snapshot does not match the session');
    assert(subscribed.resync_required === false, 'first subscribe asked for a resync');
    assert(typeof subscribed.latest_seq === 'number', 'journal returned no sequence');
    evidence.snapshot = {
      session_id: target,
      epoch: subscribed.epoch,
      latest_seq: subscribed.latest_seq,
      floor_seq: subscribed.floor_seq,
      messages: subscribed.snapshot.messages?.length ?? 0,
      status: subscribed.snapshot.session?.status ?? null,
      runtime: subscribed.snapshot.runtime ?? null,
      swarm_children: subscribed.snapshot.swarm?.children?.length ?? null,
    };

    // 6. Unsubscribe, which only exists from v4.
    const unsubscribed = await client.request<any>('sessions.unsubscribe', { session_id: target });
    evidence.unsubscribed = unsubscribed;
  } else {
    evidence.sessions_empty = true;
  }

  // 7. Diagnostics reflect the live process.
  const diagnostics = await client.request<any>('diagnostics.snapshot', {});
  assert(diagnostics.protocol_version === 4, 'diagnostics protocol mismatch');
  assert(diagnostics.adapter_version === EXPECT_VERSION, 'diagnostics version mismatch');
  assert(diagnostics.journal.append_failures === 0, 'journal reports append failures');
  assert(diagnostics.jcode.healthy === true, 'diagnostics reports the harness as unhealthy');
  evidence.diagnostics = {
    adapter_version: diagnostics.adapter_version,
    protocol_version: diagnostics.protocol_version,
    min_protocol_version: diagnostics.min_protocol_version,
    epoch: diagnostics.epoch,
    capabilities: diagnostics.capabilities.length,
    devices: diagnostics.connections.devices,
    journal_events: diagnostics.journal.events,
    journal_bytes: diagnostics.journal.bytes,
    jcode_version: diagnostics.jcode.jcode_version,
    jcode_reconnects: diagnostics.jcode.reconnects,
    frames_out: diagnostics.connections.frames_out,
  };

  // 8. A v3 client and a v2 client must still work against the same adapter,
  //    on the same device token. This is the "an older phone is not broken"
  //    check, so it must run before the device is revoked at step 10.
  for (const version of [3, 2] as const) {
    const legacy = await Client.open(identity.token, [`jcode.mobile.v${version}`]);
    const legacyHello = await legacy.request<any>(
      'client.hello',
      {
        client_name: `adapter-v4-live-check-v${version}`,
        client_version: version === 3 ? '0.4.0' : '0.3.1',
        min_version: 2,
        max_version: version,
        supports: [`jcode.mobile.v${version}`],
      },
      { version: 2 },
    );
    assert(
      legacyHello.negotiated_version === version,
      `expected v${version} negotiation, got ${legacyHello.negotiated_version}`,
    );
    legacy.version = legacyHello.negotiated_version;
    const legacyList = await legacy.request<any>('sessions.list', {});
    assert(Array.isArray(legacyList.sessions), `v${version} sessions.list failed`);
    evidence[`v${version}_hello`] = {
      negotiated_version: legacyHello.negotiated_version,
      sessions: legacyList.sessions.length,
      frame_versions: [...legacy.versionsSeen],
    };
    assert(
      [...legacy.versionsSeen].every((seen) => seen === version),
      `a v${version} client received a frame at another version: ${[...legacy.versionsSeen]}`,
    );
    legacy.close();
  }

  // 9. Every frame on the v4 connection stayed at the negotiated version.
  evidence.v4_frames = {
    versions_seen: [...client.versionsSeen],
    frames_out: client.framesOut,
    byte_packages_reassembled: client.bytePackages,
  };
  assert(
    [...client.versionsSeen].every((version) => version === 4),
    `a frame left the adapter at a version other than 4: ${[...client.versionsSeen]}`,
  );

  // 10. Revoke every device this check has created, including ones left behind
  //     by an earlier run. Verification must not litter the server device list.
  //     This is last, because revoking the token ends the connections using it.
  if (!SKIP_PAIR && !KEEP_DEVICE) {
    const devices = await client.request<any>('device.list', {});
    const mine = (devices.devices ?? []).filter((d: any) => d.name === DEVICE_NAME);
    assert(
      mine.some((d: any) => d.device_id === identity.deviceId),
      'the device this check paired is missing from device.list',
    );
    const revoked: string[] = [];
    for (const device of mine) {
      await client.request<any>('device.revoke', { device_id: device.device_id });
      revoked.push(device.device_id);
    }
    evidence.devices_revoked = revoked;
  } else if (!SKIP_PAIR) {
    evidence.device_kept = identity.deviceId;
  }

  client.close();

  evidence.result = 'PASS';
  evidence.finished_at = new Date().toISOString();
  const output = JSON.stringify(evidence, null, 2);
  if (EVIDENCE_PATH) await writeFile(EVIDENCE_PATH, `${output}\n`);
  console.log(output);
}

main().catch((error) => {
  evidence.result = 'FAIL';
  evidence.error = error instanceof Error ? error.message : String(error);
  evidence.finished_at = new Date().toISOString();
  console.error(JSON.stringify(evidence, null, 2));
  process.exit(1);
});
