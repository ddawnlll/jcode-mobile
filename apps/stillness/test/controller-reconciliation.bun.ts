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
  applySessionEvent: (envelope: unknown) => void;
  finishTurn: (turnId: string | null, status: 'done' | 'stopped') => void;
};

const snapshot = (
  stale = false,
  daemon: 'idle' | 'running' | 'unknown' | null = null,
): SessionSnapshot => ({
  session: { session_id: 'session-a', title: 'Test' },
  messages: [], active_turn: null, stale, last_seq: 5, epoch: 'epoch',
  plan: null, context: null, runtime: null, agents: null,
  daemon_status: daemon
    ? { status: daemon, raw_status: daemon, observed_at_ms: 10, source: 'test' }
    : null,
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

  test('daemon idle clears a stale turn even when a tool is still marked running', () => {
    const { h } = setup(async () => snapshot(false, 'idle'));
    h.applySnapshot(snapshot(false, 'idle'));
    expect(h.state.live.turnId).toBeNull();
    expect(h.state.live.daemonRunning).toBe(false);
    expect(h.state.live.daemonStatus).toBe('idle');
    expect(h.state.live.tools[0].status).toBe('unknown');
  });

  test('daemon running with no adapter turn keeps Stop and blocks Send after restart', async () => {
    const calls: string[] = [];
    const { controller, h } = setup(async (method) => {
      calls.push(method);
      return snapshot(false, 'running');
    });
    h.applySnapshot(snapshot(false, 'running'));
    expect(h.state.live.turnId).toBeNull();
    expect(h.state.live.daemonRunning).toBe(true);
    expect(h.state.live.finishedTurnId).toBeNull();
    h.applySessionEvent({
      session_id: 'session-a',
      epoch: 'epoch',
      seq: 6,
      payload: {
        event: { kind: 'text_delta', text: 'still running', message_id: 'm' },
        turn_id: 'turn-a',
        operation_id: 'op',
        observed_at_ms: 12,
      },
    });
    expect(h.state.live.assistants.at(-1)?.text).toContain('still running');
    h.state.pending = null;
    h.state.composerText = 'second message';
    await controller.send();
    expect(calls).toEqual([]);
    expect(h.state.toast).toContain('already running');
  });

  test('daemon unknown never claims idle or releases the composer', () => {
    const { h } = setup(async () => snapshot(false, 'unknown'));
    h.applySnapshot(snapshot(false, 'unknown'));
    expect(h.state.live.turnId).toBe('turn-a');
    expect(h.state.live.daemonRunning).toBe(false);
    expect(h.state.live.daemonStatus).toBe('unknown');
    expect(h.state.live.needsReconcile).toBe(true);
  });

  test('stop on an already idle daemon is a no-op success that releases the composer', async () => {
    const calls: string[] = [];
    const { controller, h } = setup(async (method) => {
      calls.push(method);
      return {
        cancelled: false,
        turn_id: null,
        already_stopped: true,
        final_state: 'idle',
        atomic_turn_scope: false,
        note: 'already idle',
      };
    });
    await controller.stop();
    expect(calls).toEqual(['operations.cancel']);
    expect(h.state.live.turnId).toBeNull();
    expect(h.state.live.daemonRunning).toBe(false);
    expect(h.state.live.tools[0].status).toBe('unknown');
    expect(h.state.toast).toContain('already stopped');
  });

  test('stop without a turn id targets daemon-confirmed running state', async () => {
    const calls: Array<{ method: string; payload: unknown }> = [];
    const { controller, h } = setup(async (method, payload) => {
      calls.push({ method, payload });
      return {
        cancelled: true,
        turn_id: null,
        already_stopped: false,
        final_state: 'idle',
        atomic_turn_scope: false,
        note: 'stop accepted',
      };
    });
    h.state.live = {
      ...h.state.live,
      turnId: null,
      operationId: null,
      daemonRunning: true,
      daemonStatus: 'running',
    };
    await controller.stop();
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('operations.cancel');
    expect(calls[0].payload).toMatchObject({
      expected_turn_id: null,
      operation_id: null,
      allow_running_unknown: true,
    });
    expect(h.state.live.turnId).toBeNull();
    expect(h.state.live.daemonRunning).toBe(false);
  });

  test('daemon idle status event settles a missed terminal and unresolved tool', () => {
    const { h } = setup(async () => snapshot());
    h.applySessionEvent({
      session_id: 'session-a',
      epoch: 'epoch',
      seq: 6,
      payload: {
        event: { kind: 'session_status', status: 'idle', pending_soft_interrupts: null },
        turn_id: 'turn-a',
        operation_id: 'op',
        observed_at_ms: 11,
      },
    });
    expect(h.state.live.turnId).toBeNull();
    expect(h.state.live.daemonRunning).toBe(false);
    expect(h.state.live.tools[0].status).toBe('unknown');
  });

  test('turn terminal settles unfinished tools without marking them done', () => {
    const { h } = setup(async () => snapshot());
    h.finishTurn('turn-a', 'done');
    expect(h.state.live.turnId).toBeNull();
    expect(h.state.live.daemonRunning).toBe(false);
    expect(h.state.live.tools[0].status).toBe('unknown');
  });

  test('authoritative history removes represented live blocks but keeps unmatched work', () => {
    const { h } = setup(async () => snapshot());
    h.state.live = {
      ...h.state.live,
      assistants: [{ seq: 7, id: 'assistant', text: 'Command output: android-e2e', done: true }],
      reasoning: [{ seq: 1, id: 'r', text: 'thinking', done: true }],
      tools: [
        { seq: 2, callId: 't1', name: 'bash', input: '', output: 'android-e2e', error: null, status: 'done' },
        { seq: 3, callId: 't2', name: 'write', input: '', output: '', error: null, status: 'running' },
      ],
    };
    const first = snapshot(false, 'idle');
    first.messages = [
      { index: 0, role: 'user', content: 'do work', tool_call_id: null, tool_name: null, tool_input: null, response_stats: null },
      { index: 1, role: 'assistant', content: 'Command output: android-e2e', tool_call_id: null, tool_name: null, tool_input: null, response_stats: null },
      { index: 2, role: 'tool', content: 'android-e2e', tool_call_id: 't1', tool_name: 'bash', tool_input: null, response_stats: null },
    ] as typeof first.messages;
    h.applySnapshot(first);
    expect(h.state.live.assistants).toHaveLength(0);
    expect(h.state.live.tools.map((tool) => tool.callId)).toEqual(['t2']);
    expect(h.state.live.tools[0].status).toBe('unknown');
    expect(h.state.live.reasoning).toHaveLength(1);

    const second = snapshot(false, 'idle');
    second.messages = [
      ...first.messages,
      { index: 3, role: 'tool', content: 'written', tool_call_id: 't2', tool_name: 'write', tool_input: null, response_stats: null },
    ] as typeof first.messages;
    h.applySnapshot(second);
    expect(h.state.live.assistants).toHaveLength(0);
    expect(h.state.live.tools).toHaveLength(0);
    expect(h.state.live.reasoning).toHaveLength(0);
  });
});
