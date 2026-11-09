import { MobileClient, TransportError } from '../client';

type Listener = ((event: { data?: string; code?: number }) => void) | null;

class FakeSocket {
  static instances: FakeSocket[] = [];
  static helloMode: 'ok' | 'error' | 'none' = 'ok';

  readonly url: string;
  readonly sent: Array<Record<string, unknown>> = [];
  closed = false;
  onopen: (() => void) | null = null;
  onmessage: Listener = null;
  onclose: Listener = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
    queueMicrotask(() => {
      if (this.closed) return;
      this.onopen?.();
    });
  }

  send(raw: string): void {
    const frame = JSON.parse(raw) as Record<string, unknown>;
    this.sent.push(frame);
    if (frame.req === 'hello') {
      if (FakeSocket.helloMode === 'none') return;
      const reply =
        FakeSocket.helloMode === 'error'
          ? { v: 1, reply_to: frame.id, ev: 'error', code: 'unsupported_version', message: 'No shared version.' }
          : {
              v: 1,
              reply_to: frame.id,
              ev: 'hello_ok',
              version: 1,
              server: 'fake',
              capabilities: ['mobile_continuation'],
            };
      queueMicrotask(() => {
        if (!this.closed) this.onmessage?.({ data: JSON.stringify(reply) });
      });
      return;
    }
    if (frame.req === 'ping') {
      queueMicrotask(() => {
        if (!this.closed) {
          this.onmessage?.({ data: JSON.stringify({ v: 1, reply_to: frame.id, ev: 'ok' }) });
        }
      });
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => this.onclose?.({ code: 1000 }));
  }
}

function client(events: { events: string[] } = { events: [] }): MobileClient {
  return new MobileClient(
    { host: 'test.example', port: 443, tls: true },
    'a'.repeat(64),
    {
      onEvent: (frame) => events.events.push(frame.ev),
      onState: (state) => events.events.push(`state:${state}`),
    },
  );
}

describe('MobileClient handshake lifecycle', () => {
  const originalWebSocket = global.WebSocket;

  beforeEach(() => {
    FakeSocket.instances = [];
    FakeSocket.helloMode = 'ok';
    global.WebSocket = FakeSocket as unknown as typeof WebSocket;
  });

  afterAll(() => {
    global.WebSocket = originalWebSocket;
  });

  it('closes a rejected handshake and requires a fresh hello for the next connect', async () => {
    FakeSocket.helloMode = 'error';
    const events = { events: [] as string[] };
    const transport = client(events);

    await expect(transport.connect()).rejects.toMatchObject({ code: 'unsupported_version' });
    expect(transport.isOpen).toBe(false);
    expect(FakeSocket.instances[0].closed).toBe(true);

    FakeSocket.helloMode = 'ok';
    await transport.connect();
    expect(FakeSocket.instances).toHaveLength(2);
    expect(transport.isOpen).toBe(true);
    expect(transport.hello?.ev).toBe('hello_ok');

    // A late frame from the retired socket cannot reach the event stream.
    const before = events.events.length;
    FakeSocket.instances[0].onmessage?.({
      data: JSON.stringify({ v: 1, ev: 'text_delta', attachment_id: 'a', turn_id: 1, text: 'late' }),
    });
    expect(events.events.length).toBe(before);
  });

  it('times out a silent handshake and rejects later requests as not ready', async () => {
    FakeSocket.helloMode = 'none';
    const transport = client();
    await expect(transport.connect(40)).rejects.toMatchObject({ code: 'handshake_timeout' });
    expect(transport.isOpen).toBe(false);
    expect(FakeSocket.instances[0].closed).toBe(true);
    await expect(transport.request({ req: 'ping' })).rejects.toMatchObject({ code: 'not_open' });
  });

  it('separates protocol readiness from transport open and probes health', async () => {
    const transport = client();
    const connecting = transport.connect();
    await connecting;
    expect(transport.isOpen).toBe(true);
    expect(transport.isTransportOpen).toBe(true);
    await expect(transport.ping(100)).resolves.toBeUndefined();
    expect(transport.isHealthy(1_000)).toBe(true);

    transport.close();
    expect(transport.isOpen).toBe(false);
    await expect(transport.request({ req: 'ping' })).rejects.toBeInstanceOf(TransportError);
  });
});
