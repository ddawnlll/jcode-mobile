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
