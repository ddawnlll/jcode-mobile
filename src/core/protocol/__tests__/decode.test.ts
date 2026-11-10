import { decodeFrame } from '../decode';
import { PROTOCOL_VERSION } from '../frames';

const identity = {
  session_id: 's1',
  attachment_id: 'att_1',
  turn_id: 3,
};

describe('decodeFrame', () => {
  it('accepts a well-formed stream frame', () => {
    const result = decodeFrame(
      JSON.stringify({ v: PROTOCOL_VERSION, ev: 'text_delta', ...identity, text: 'hello' }),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.frame.ev === 'text_delta') {
      expect(result.frame.text).toBe('hello');
      expect(result.frame.turn_id).toBe(3);
    }
  });

  it('rejects a future protocol version instead of guessing', () => {
    const result = decodeFrame(JSON.stringify({ v: 2, ev: 'text_delta', ...identity, text: 'x' }));
    expect(result).toMatchObject({ ok: false, reason: 'bad_envelope' });
  });

  it('rejects malformed JSON and non-object bodies', () => {
    expect(decodeFrame('{')).toMatchObject({ ok: false, reason: 'not_json' });
    expect(decodeFrame('[]')).toMatchObject({ ok: false, reason: 'bad_envelope' });
  });

  it('rejects oversized frames before parsing', () => {
    const result = decodeFrame('x'.repeat(100), 10);
    expect(result).toMatchObject({ ok: false, reason: 'too_large' });
  });

  it('drops stream frames missing identity instead of attributing them', () => {
    const result = decodeFrame(
      JSON.stringify({ v: PROTOCOL_VERSION, ev: 'text_delta', session_id: 's1', text: 'x' }),
    );
    expect(result).toMatchObject({ ok: false, reason: 'bad_event' });
  });

  it('keeps unknown event kinds as a skippable frame', () => {
    const result = decodeFrame(JSON.stringify({ v: PROTOCOL_VERSION, ev: 'future_thing' }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.frame.ev).toBe('unknown');
  });

  it('validates history shape and indexes', () => {
    const result = decodeFrame(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        ev: 'history',
        session_id: 's1',
        attachment_id: 'att_1',
        base_index: 4,
        total_messages: 6,
        tail_fingerprint: 'abc',
        accepted_client_ids: ['m1'],
        messages: [
          { role: 'user', content: 'a' },
          { role: 'assistant', content: 'b', index: 5 },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.frame.ev === 'history') {
      expect(result.frame.messages[0].index).toBe(4);
      expect(result.frame.messages[1].index).toBe(5);
      expect(result.frame.accepted_client_ids).toEqual(['m1']);
    }
  });

  it('ignores unknown capability strings', () => {
    const result = decodeFrame(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        ev: 'hello_ok',
        version: 1,
        server: 'x',
        capabilities: ['mobile_continuation', 'invented'],
        reply_to: 1,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.frame.ev === 'hello_ok') {
      expect(result.frame.capabilities).toEqual(['mobile_continuation']);
      expect(result.frame.reply_to).toBe(1);
    }
  });
});


describe('history recovery fields', () => {
  it('retains daemon interruption and recovery evidence', () => {
    const result = decodeFrame(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        ev: 'history',
        session_id: 's1',
        attachment_id: 'att_1',
        messages: [],
        base_index: 0,
        total_messages: 0,
        interrupted_at_attach: true,
        recovery: {
          continuation_message: 'Continue from the last completed step.',
          reconnect_notice: 'The daemon restarted.',
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.frame.ev === 'history') {
      expect(result.frame.interrupted_at_attach).toBe(true);
      expect(result.frame.recovery?.continuation_message).toContain('Continue');
      expect(result.frame.recovery?.reconnect_notice).toContain('restarted');
    }
  });
});

describe('0.2.2 protocol additions', () => {
  it('decodes provider-response boundaries and retry rollbacks distinctly', () => {
    const end = decodeFrame(
      JSON.stringify({ v: PROTOCOL_VERSION, ev: 'message_end', ...identity, stop_reason: 'max_tokens' }),
    );
    expect(end.ok).toBe(true);
    if (end.ok && end.frame.ev === 'message_end') {
      expect(end.frame.stop_reason).toBe('max_tokens');
    }
    const rollback = decodeFrame(
      JSON.stringify({ v: PROTOCOL_VERSION, ev: 'retry_rollback', ...identity, attempt: 2, max: 4 }),
    );
    expect(rollback.ok).toBe(true);
    if (rollback.ok && rollback.frame.ev === 'retry_rollback') {
      expect(rollback.frame).toMatchObject({ attempt: 2, max: 4 });
    }
  });

  it('moves legacy sentinel reasoning out of assistant prose', () => {
    const body = `*\u2063Weighing the options.\\*Carefully\\*.\u2063*  \n\nFinal **answer**`;
    const result = decodeFrame(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        ev: 'history',
        session_id: 's1',
        attachment_id: 'att_1',
        base_index: 0,
        total_messages: 1,
        messages: [{ index: 0, role: 'assistant', content: body }],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.frame.ev === 'history') {
      const [message] = result.frame.messages;
      expect(message.reasoning).toBe('Weighing the options.*Carefully*.');
      expect(message.content).toBe('Final **answer**');
    }
  });

  it('keeps ordinary markdown untouched and carries image omission counts', () => {
    const source = 'Intro\n\n\n    indented\n\n\n- list';
    const result = decodeFrame(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        ev: 'history',
        session_id: 's1',
        attachment_id: 'att_1',
        base_index: 0,
        total_messages: 1,
        images_omitted: 2,
        messages: [{ index: 0, role: 'assistant', content: source }],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.frame.ev === 'history') {
      expect(result.frame.messages[0].content).toBe(source);
      expect(result.frame.messages[0].reasoning).toBeUndefined();
      expect(result.frame.images_omitted).toBe(2);
    }
  });

  it('carries per-model effort ladders', () => {
    const result = decodeFrame(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        ev: 'models',
        session_id: 's1',
        models: ['m1', 'm2'],
        efforts: ['low'],
        efforts_by_model: { m1: ['low', 'high'], m2: null },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.frame.ev === 'models') {
      expect(result.frame.efforts_by_model).toEqual({ m1: ['low', 'high'] });
    }
  });
});

describe('0.2.2 catalog and context metadata', () => {
  it('decodes model routes for provider filtering', () => {
    const result = decodeFrame(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        ev: 'models',
        session_id: 's1',
        models: ['claude-opus-4-7', 'gpt-6.1-sol'],
        routes: [
          { model: 'claude-opus-4-7', provider: 'Anthropic', available: true },
          { model: 'gpt-6.1-sol', provider: 'local-gemini', available: false },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.frame.ev === 'models') {
      expect(result.frame.routes).toEqual([
        { model: 'claude-opus-4-7', provider: 'Anthropic', available: true },
        { model: 'gpt-6.1-sol', provider: 'local-gemini', available: false },
      ]);
    }
  });

  it('carries the cached observation flag', () => {
    const result = decodeFrame(
      JSON.stringify({
        v: PROTOCOL_VERSION,
        ev: 'context_snapshot',
        session_id: 's1',
        attachment_id: 'att_1',
        used_tokens: 29198,
        limit_tokens: 1000000,
        basis: 'last_request',
        model: 'gpt-6.1-sol',
        observed_at_ms: 1,
        cached: true,
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok && result.frame.ev === 'context_snapshot') {
      expect(result.frame.cached).toBe(true);
      expect(result.frame.used_tokens).toBe(29198);
    }
  });
});
