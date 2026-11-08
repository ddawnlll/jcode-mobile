import {
  deriveSeam,
  groupSessions,
  messageFingerprint,
  basename,
  formatTime,
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
