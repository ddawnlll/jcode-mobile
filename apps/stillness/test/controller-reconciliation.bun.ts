import { describe, expect, test } from 'bun:test';
import type { AppState } from '../src/lib/controller';
import { AdapterRequestError } from '../src/lib/adapter';
import type { SessionSnapshot } from '../src/lib/protocol';

// Deterministic browser shims: scheduled retries are recorded but not executed.
const timers: Array<() => void> = [];
Object.assign(globalThis, {
  window: {
    setTimeout: (fn: () => void) => (timers.push(fn), timers.length), clearTimeout: () => {},
    requestAnimationFrame: (fn: () => void) => (timers.push(fn), timers.length), cancelAnimationFrame: () => {},
  },
  document: { title: '' },
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
});
const { Controller } = await import('../src/lib/controller');

type Harness = {
  state: AppState;
  client: { status: string; request: (method: string, payload: unknown) => Promise<unknown> };
  sessionGeneration: number;
  applySnapshot: (snapshot: SessionSnapshot) => void;
};

const snapshot = (stale = false): SessionSnapshot => ({
  session: { session_id: 'session-a', title: 'Test' },
  messages: [], active_turn: null, stale, last_seq: 5, epoch: 'epoch',
  plan: null, context: null, runtime: null, agents: null,
} as unknown as SessionSnapshot);

function setup(request: Harness['client']['request']) {
  const controller = new Controller();
  const h = controller as unknown as Harness;
  h.client = { status: 'connected', request };
  h.state = {
    ...h.state,
    credential: { serverId: 'server' } as AppState['credential'],
    activeSessionId: 'session-a', snapshot: snapshot(), epoch: 'epoch', lastSeq: 5,
    pending: { text: 'in flight', operationId: 'op', state: 'accepted', error: null, createdAt: 1 },
    composerText: 'draft',
    live: {
      ...h.state.live, turnId: 'turn-a', operationId: 'op', status: 'working',
      reasoning: [{ seq: 1, id: 'r', text: 'thinking', done: false }],
      tools: [{ seq: 2, callId: 'tool', name: 'shell', input: '', output: '', error: null, status: 'running' }],
    },
  };
  return { controller, h };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

const conflict = () => new AdapterRequestError({ code: 'conflict', message: 'no active turn to stop', retryable: false });

describe('issue 80 authoritative reconciliation', () => {
  test('fresh idle clears turn, keeps work and pending, and marks unconfirmed tool unknown', () => {
    const { h } = setup(async () => snapshot());
    h.applySnapshot(snapshot());
    expect(h.state.live.turnId).toBeNull();
    expect(h.state.live.finishedTurnId).toBe('turn-a');
    expect(h.state.live.reasoning[0].text).toBe('thinking');
    expect(h.state.live.tools[0].status).toBe('unknown');
    expect(h.state.pending?.text).toBe('in flight');
    expect(h.state.composerText).toBe('draft');
  });

  test('stale idle snapshot does not claim the turn ended', () => {
    const { h } = setup(async () => snapshot(true));
    h.applySnapshot(snapshot(true));
    expect(h.state.live.turnId).toBe('turn-a');
    expect(h.state.live.tools[0].status).toBe('running');
    expect(h.state.reconciling).toBe(true);
  });

  test('stop conflict requests snapshot once despite repeated taps', async () => {
    const cancel = deferred<unknown>();
    const calls: string[] = [];
    const { controller, h } = setup(async (method) => {
      calls.push(method);
      return method === 'operations.cancel' ? cancel.promise : snapshot();
    });
    const first = controller.stop();
    await controller.stop();
    cancel.reject(conflict());
    await first;
    expect(calls).toEqual(['operations.cancel', 'sessions.snapshot']);
    expect(h.state.live.turnId).toBeNull();
    expect(h.state.live.tools[0].status).toBe('unknown');
  });

  test('late stop conflict cannot affect a newer turn', async () => {
    const cancel = deferred<unknown>();
    const calls: string[] = [];
    const { controller, h } = setup(async (method) => { calls.push(method); return cancel.promise; });
    const first = controller.stop();
    h.state.live = { ...h.state.live, turnId: 'turn-b' };
    cancel.reject(conflict());
    await first;
    expect(calls).toEqual(['operations.cancel']);
    expect(h.state.live.turnId).toBe('turn-b');
  });

  test('late stop conflict cannot affect a different session', async () => {
    const cancel = deferred<unknown>();
    const calls: string[] = [];
    const { controller, h } = setup(async (method) => { calls.push(method); return cancel.promise; });
    const first = controller.stop();
    h.sessionGeneration += 1;
    h.state.activeSessionId = 'session-b';
    cancel.reject(conflict());
    await first;
    expect(calls).toEqual(['operations.cancel']);
    expect(h.state.toast).toBeNull();
  });

  test('delayed idle snapshot cannot clear a newer turn', async () => {
    const response = deferred<SessionSnapshot>();
    const { controller, h } = setup(async () => response.promise);
    const refresh = controller.refreshSnapshot();
    h.state.live = { ...h.state.live, turnId: 'turn-b', finishedTurnId: 'turn-a' };
    response.resolve(snapshot());
    await refresh;
    expect(h.state.live.turnId).toBe('turn-b');
  });

  test('older snapshot cannot overwrite a newer journal event', async () => {
    const response = deferred<SessionSnapshot>();
    const { controller, h } = setup(async () => response.promise);
    const refresh = controller.refreshSnapshot();
    h.state.lastSeq = 6;
    response.resolve(snapshot());
    await refresh;
    expect(h.state.live.turnId).toBe('turn-a');
    expect(h.state.lastSeq).toBe(6);
  });

  test('failed refresh leaves turn and reconciliation visible', async () => {
    const { controller, h } = setup(async (method) => {
      if (method === 'operations.cancel') throw conflict();
      throw new Error('offline');
    });
    await controller.stop();
    expect(h.state.live.turnId).toBe('turn-a');
    expect(h.state.reconciling).toBe(true);
    expect(h.state.toast).toBe('offline');
  });
});
