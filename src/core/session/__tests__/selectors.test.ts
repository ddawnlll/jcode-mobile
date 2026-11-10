import {
  deriveSeam,
  groupSessions,
  messageFingerprint,
  basename,
  formatTime,
  attachHistoryImages,
  deriveChanges,
} from '../selectors';
import type { HistoryMessage, SessionInfo } from '../../protocol/frames';

function message(index: number, content: string, role = 'assistant'): HistoryMessage {
  return { index, role, content };
}

describe('deriveSeam', () => {
  const messages = [message(0, 'one'), message(1, 'two'), message(2, 'three')];

  it('reports an authoritative count when the anchor still matches', () => {
    const result = deriveSeam(
      messages,
      3,
      0,
      { messageIndex: 1, fingerprint: messageFingerprint(messages[1]) },
      false,
    );
    expect(result.index).toBe(1);
    expect(result.count).toBe(2);
    expect(result.anchorLost).toBe(false);
  });

  it('places the seam at the end without a count when nothing is new', () => {
    const result = deriveSeam(messages, 3, 0, { messageIndex: 3, fingerprint: 'x' }, false);
    expect(result.index).toBeNull();
    expect(result.count).toBeNull();
    expect(result.seenIndex).toBe(3);
  });

  it('recovers a moved anchor by fingerprint', () => {
    const result = deriveSeam(
      messages,
      3,
      0,
      { messageIndex: 0, fingerprint: messageFingerprint(messages[2]) },
      false,
    );
    expect(result.index).toBe(2);
    expect(result.count).toBe(1);
  });

  it('does not invent a count after compaction or rewrite', () => {
    const result = deriveSeam(
      messages,
      3,
      1,
      { messageIndex: 1, fingerprint: 'gone' },
      false,
    );
    expect(result.count).toBeNull();
    expect(result.anchorLost).toBe(true);
    expect(result.index).toBe(1);
  });

  it('has no seam on a first visit', () => {
    expect(deriveSeam(messages, 3, 0, null, true)).toMatchObject({
      index: null,
      count: null,
      seenIndex: 3,
    });
  });
});

describe('groupSessions', () => {
  const base: SessionInfo = {
    session_id: 'a',
    title: 'A',
    saved: false,
    archived: false,
  };

  it('puts working sessions first and never duplicates them', () => {
    const groups = groupSessions([
      { ...base, session_id: 'recent', live_state: 'ready' },
      { ...base, session_id: 'work', live_state: 'working', saved: true },
      { ...base, session_id: 'saved', saved: true },
    ]);
    expect(groups.map((group) => group.key)).toEqual(['working', 'saved', 'recent']);
    const ids = groups.flatMap((group) => group.sessions.map((session) => session.session_id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(groups[0].sessions[0].session_id).toBe('work');
  });

  it('omits empty group headings', () => {
    expect(groupSessions([{ ...base, live_state: 'ready' }]).map((group) => group.key)).toEqual([
      'recent',
    ]);
    expect(groupSessions([])).toEqual([]);
  });

  it('freezes ordering by saved then recency', () => {
    const groups = groupSessions([
      { ...base, session_id: 'old', updated_at_ms: 10 },
      { ...base, session_id: 'new', updated_at_ms: 20 },
      { ...base, session_id: 'saved-old', updated_at_ms: 1, saved: true },
    ]);
    expect(groups[0].sessions.map((session) => session.session_id)).toEqual(['saved-old']);
    expect(groups[1].sessions.map((session) => session.session_id)).toEqual(['new', 'old']);
  });
});

describe('small formatters', () => {
  it('uses the final path segment, never the full path', () => {
    expect(basename('/home/you/project/')).toBe('project');
    expect(basename('project')).toBe('project');
    expect(basename(null)).toBe('');
  });

  it('formats recent times without fabricating a date', () => {
    const now = new Date('2026-11-08T12:00:00Z').getTime();
    expect(formatTime(now, now)).toMatch(/^\d{2}:\d{2}$/);
    expect(formatTime(now - 86_400_000, now)).toBe('Yesterday');
  });
});

describe('0.2.2 selector regressions', () => {
  it('anchors tool images to the absolute message before the boundary', () => {
    const messages = [
      message(7, 'prompt', 'user'),
      { index: 8, role: 'tool', content: 'result', tool_data: { id: 'call_1', name: 'read' } },
      message(9, 'answer'),
    ];
    const result = attachHistoryImages(messages, [
      {
        media_type: 'image/png',
        data: 'AAAA',
        history_message_index: 9,
        anchor: { kind: 'tool_call', id: 'call_1' },
      },
    ]);
    expect(result[1].images).toHaveLength(1);
    expect(result[2].images).toBeUndefined();
  });

  it('uses zero-based prompt ordinals', () => {
    const messages = [
      message(2, 'first', 'user'),
      message(3, 'answer'),
      message(8, 'second', 'user'),
    ];
    const result = attachHistoryImages(messages, [
      { media_type: 'image/png', data: 'AAAA', anchor: { kind: 'user_prompt', ordinal: 1 } },
    ]);
    expect(result[2].images).toHaveLength(1);
    expect(result[0].images).toBeUndefined();
  });

  it('never clamps an out-of-window anchor onto the last answer', () => {
    const result = attachHistoryImages([message(20, 'answer')], [
      { media_type: 'image/png', data: 'AAAA', history_message_index: 5 },
    ]);
    expect(result[0].images).toBeUndefined();
  });

  it('marks history-only edits as attempts and leaves failed live calls alone', () => {
    const tools = [
      {
        callId: 'call_failed',
        name: 'edit',
        state: 'failed' as const,
        startedAt: 0,
        input: { path: '/x', old_string: 'a', new_string: 'b' },
      },
    ];
    const changes = deriveChanges(
      [
        { index: 1, role: 'assistant', content: '' },
        {
          index: 2,
          role: 'tool',
          content: 'permission denied',
          tool_data: { id: 'call_failed', name: 'edit', input: { path: '/x' } },
        },
        {
          index: 3,
          role: 'tool',
          content: 'ok',
          tool_data: { id: 'call_history', name: 'edit', input: { path: '/y' } },
        },
      ],
      tools,
    );
    expect(changes.some((change) => change.callId === 'call_failed')).toBe(false);
    expect(changes.find((change) => change.callId === 'call_history')?.status).toBe('attempted');
  });
});
