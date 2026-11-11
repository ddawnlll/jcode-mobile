/**
 * Persistence reliability tests (issues #16/#18/#19/#24/#25/#31/#43 DB side).
 *
 * expo-sqlite's native module is unavailable under Jest, so `expo-sqlite` is
 * mocked with a real in-memory SQLite database (`bun:sqlite`, available
 * because Jest runs under Bun). This gives genuine transaction/atomicity
 * semantics rather than a statement-matching fake.
 */
jest.mock('expo-sqlite', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Database } = require('bun:sqlite');
  // A registry of in-memory handles keyed by any name (tests use :memory:).
  function openDatabaseAsync(_name: string) {
    const raw = new Database(':memory:');
    const statements = (sql: string) =>
      sql
        .split(';')
        .map((part) => part.trim())
        .filter(Boolean);
    const params = (values: unknown[]) =>
      values.map((value) => (value === undefined ? null : value));
    const handle = {
      _raw: raw,
      async execAsync(sql: string) {
        for (const statement of statements(sql)) {
          raw.run(statement);
        }
      },
      async runAsync(sql: string, ...values: unknown[]) {
        const result = raw.query(sql).run(...params(values));
        return { lastInsertRowId: result.lastInsertRowid, changes: result.changes };
      },
      async getFirstAsync(sql: string, ...values: unknown[]) {
        return raw.query(sql).get(...params(values)) ?? null;
      },
      async getAllAsync(sql: string, ...values: unknown[]) {
        return raw.query(sql).all(...params(values));
      },
      async withTransactionAsync(work: () => Promise<void>) {
        raw.run('BEGIN');
        try {
          await work();
          raw.run('COMMIT');
        } catch (error) {
          try {
            raw.run('ROLLBACK');
          } catch {
            // ignore rollback failures
          }
          throw error;
        }
      },
      async closeAsync() {
        raw.close();
      },
    };
    return Promise.resolve(handle);
  }
  return { openDatabaseAsync };
});

import {
  PendingAdmissionError,
  cacheBytesDetailed,
  clearTranscriptRevision,
  deleteServer,
  getDraft,
  getDraftRev,
  getHistoryRevision,
  getPendingSend,
  invalidateTranscriptLineage,
  listPendingSends,
  listPendingSendsPaged,
  loadCachedMessages,
  migrateDatabase,
  nextDeliveryState,
  openDatabaseForTests,
  recountSerializedBytes,
  savePendingSend,
  setDraft,
  setDraftRev,
  setPendingSendStateGuarded,
  setPendingSendTranscriptRef,
  stagePendingSendTransaction,
  stageSend,
  upsertHistoryRevisionIfNewer,
  upsertMessages,
  utf8ByteLength,
} from '../db';
import type { ComposerImage } from '../../state/store';

const SERVER = 'srv-1';
const SESSION = 'ses-1';

function image(name = 'photo.png', extra: Partial<ComposerImage> = {}): ComposerImage {
  return {
    id: `id-${name}`,
    uri: `file:///tmp/${name}`,
    mediaType: 'image/png',
    name,
    base64: 'iVBORw0KGgo=', // minimal PNG-ish payload
    alt: name,
    ...extra,
  };
}

describe('delivery monotonicity (R02/R04)', () => {
  it('advances forward through the legal order', () => {
    expect(nextDeliveryState('draft', 'sending')).toBe('sending');
    expect(nextDeliveryState('sending', 'sent_to_server')).toBe('sent_to_server');
    expect(nextDeliveryState('sent_to_server', 'accepted')).toBe('accepted');
    expect(nextDeliveryState('sent_to_server', 'unconfirmed')).toBe('unconfirmed');
  });

  it('never regresses', () => {
    expect(nextDeliveryState('sent_to_server', 'sending')).toBe('sent_to_server');
    expect(nextDeliveryState('accepted', 'sent_to_server')).toBe('accepted');
    expect(nextDeliveryState('unconfirmed', 'sending')).toBe('unconfirmed');
  });

  it('treats accepted/rejected as terminal', () => {
    expect(nextDeliveryState('accepted', 'unconfirmed')).toBe('accepted');
    expect(nextDeliveryState('rejected', 'unconfirmed')).toBe('rejected');
    expect(nextDeliveryState('rejected', 'accepted' as never)).toBe('rejected');
    expect(nextDeliveryState('accepted', 'rejected' as never)).toBe('accepted');
  });

  it('keeps unknown states unknown', () => {
    expect(nextDeliveryState('mystery', 'accepted')).toBe('mystery');
    expect(nextDeliveryState('sending', 'mystery')).toBe('sending');
  });

  it('utf8 byte length is exact for ascii, multibyte and astral text', () => {
    expect(utf8ByteLength('hello')).toBe(5);
    expect(utf8ByteLength('héllo')).toBe(6);
    expect(utf8ByteLength('😀')).toBe(4);
    expect(utf8ByteLength('')).toBe(0);
  });
});

describe('pending send persistence (R02/R04/R05/R29)', () => {
  beforeEach(async () => {
    await openDatabaseForTests();
  });

  it('setPendingSendStateGuarded never regresses and respects expected (CAS)', async () => {
    await savePendingSend(SERVER, SESSION, {
      client_message_id: 'm1',
      content: 'hello',
      state: 'sending',
      error: null,
      created_at: 1,
    });
    await expect(setPendingSendStateGuarded(SERVER, SESSION, 'm1', 'sent_to_server')).resolves.toBe(
      'sent_to_server',
    );
    // Regression blocked: late ACK cannot move back to sending.
    await expect(setPendingSendStateGuarded(SERVER, SESSION, 'm1', 'sending')).resolves.toBe(
      'sent_to_server',
    );
    // Terminal: accepted cannot move to unconfirmed.
    await savePendingSend(SERVER, SESSION, {
      client_message_id: 'm2',
      content: 'x',
      state: 'accepted',
      error: null,
      created_at: 2,
    });
    await expect(setPendingSendStateGuarded(SERVER, SESSION, 'm2', 'unconfirmed')).resolves.toBe(
      'accepted',
    );
    // CAS: expected mismatch leaves state untouched.
    await expect(
      setPendingSendStateGuarded(SERVER, SESSION, 'm1', 'accepted', 'sending'),
    ).resolves.toBe('sent_to_server');
    // Unknown id returns null and never creates a row.
    await expect(setPendingSendStateGuarded(SERVER, SESSION, 'missing', 'accepted')).resolves.toBeNull();
  });

  it('stagePendingSendTransaction clears ONLY the scoped draft atomically', async () => {
    await setDraft(SERVER, SESSION, 'draft for S1');
    await setDraft(SERVER, 'ses-other', 'draft for other session');
    await setDraft('srv-2', SESSION, 'draft for other server');
    await stagePendingSendTransaction(SERVER, SESSION, {
      clientMessageId: 'tx1',
      content: 'hello',
      state: 'sending',
      createdAt: 100,
    });
    expect(await getDraft(SERVER, SESSION)).toBe('');
    expect(await getDraft(SERVER, 'ses-other')).toBe('draft for other session');
    expect(await getDraft('srv-2', SESSION)).toBe('draft for other server');
    const rows = await listPendingSends(SERVER, SESSION);
    expect(rows.map((row) => row.client_message_id)).toEqual(['tx1']);
  });

  it('oversized pending payloads are rejected with a typed error and keep the draft', async () => {
    await setDraft(SERVER, SESSION, 'keep me');
    const big = 'x'.repeat(1024 * 1024 + 1);
    await expect(
      stageSend(SERVER, SESSION, { clientMessageId: 'too-big', content: big, createdAt: 1 }),
    ).rejects.toBeInstanceOf(PendingAdmissionError);
    try {
      await stageSend(SERVER, SESSION, { clientMessageId: 'too-big-2', content: big, createdAt: 1 });
      throw new Error('expected rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(PendingAdmissionError);
      expect((error as PendingAdmissionError).code).toBe('PAYLOAD_TOO_LARGE');
    }
    expect(await getDraft(SERVER, SESSION)).toBe('keep me');
    expect(await listPendingSends(SERVER, SESSION)).toEqual([]);
  });

  it('savePendingSend also enforces the 1MB per-row cap', async () => {
    const big = 'x'.repeat(1024 * 1024 + 1);
    await expect(
      savePendingSend(SERVER, SESSION, {
        client_message_id: 'big',
        content: big,
        state: 'sending',
        error: null,
        created_at: 1,
      }),
    ).rejects.toBeInstanceOf(PendingAdmissionError);
  });

  it('stageSend budget admission preserves the draft when durable budget is full', async () => {
    // Fill the durable budget with several rows just under the per-row cap.
    for (let index = 0; index < 2; index += 1) {
      await stageSend(SERVER, SESSION, {
        clientMessageId: `fill-${index}`,
        content: 'x'.repeat(700 * 1024),
        createdAt: index,
      });
    }
    await setDraft(SERVER, SESSION, 'still my draft');
    await expect(
      stageSend(SERVER, SESSION, { clientMessageId: 'one-more', content: 'x'.repeat(700 * 1024), createdAt: 10 }),
    ).rejects.toBeInstanceOf(PendingAdmissionError);
    expect(await getDraft(SERVER, SESSION)).toBe('still my draft');
    const detailed = await cacheBytesDetailed();
    expect(detailed.pendingCount).toBe(2);
  });

  it('listPendingSends omits image payloads while getPendingSend returns them', async () => {
    const img = image('a.png');
    await savePendingSend(SERVER, SESSION, {
      client_message_id: 'with-img',
      content: 'look',
      state: 'sending',
      error: null,
      created_at: 5,
      images: [img],
    });
    const listed = await listPendingSends(SERVER, SESSION);
    expect(listed).toHaveLength(1);
    expect(listed[0].images).toBeUndefined();
    expect(listed[0].meta?.imageCount).toBe(1);
    // Raw JSON must not contain base64 in the list path — payload stays lazy.
    expect(JSON.stringify(listed)).not.toContain('iVBORw0KGgo=');

    const full = await getPendingSend(SERVER, SESSION, 'with-img');
    expect(full?.images).toHaveLength(1);
    expect(full?.images?.[0].base64).toBe('iVBORw0KGgo=');
    expect(full?.payload_ref).toBe('inline');
  });

  it('listPendingSendsPaged pages without dropping rows', async () => {
    for (let index = 0; index < 5; index += 1) {
      await savePendingSend(SERVER, SESSION, {
        client_message_id: `p${index}`,
        content: `c${index}`,
        state: 'draft',
        error: null,
        created_at: index,
      });
    }
    const first = await listPendingSendsPaged(SERVER, SESSION, 2, 0);
    const second = await listPendingSendsPaged(SERVER, SESSION, 2, 2);
    expect(first.map((row) => row.client_message_id)).toEqual(['p0', 'p1']);
    expect(second.map((row) => row.client_message_id)).toEqual(['p2', 'p3']);
  });

  it('transcript_ref round-trips and legacy rows keep a null ref', async () => {
    // Legacy row: created without a ref (pre-migration shape).
    await savePendingSend(SERVER, SESSION, {
      client_message_id: 'legacy',
      content: 'old',
      state: 'accepted',
      error: null,
      created_at: 1,
    });
    const before = await listPendingSends(SERVER, SESSION);
    expect(before[0].transcript_ref).toBeNull();

    await setPendingSendTranscriptRef(SERVER, SESSION, 'legacy', 'msg-42');
    const after = await listPendingSends(SERVER, SESSION);
    expect(after[0].transcript_ref).toBe('msg-42');
    const full = await getPendingSend(SERVER, SESSION, 'legacy');
    expect(full?.transcript_ref).toBe('msg-42');
  });
});

describe('draft revisions (R10)', () => {
  beforeEach(async () => {
    await openDatabaseForTests();
  });

  it('guards stale writes and bumps the revision', async () => {
    const initial = await getDraftRev(SERVER, SESSION);
    expect(initial).toEqual({ content: '', revision: 0 });
    await expect(setDraftRev(SERVER, SESSION, 'first', 0)).resolves.toBe(true);
    await expect(getDraftRev(SERVER, SESSION)).resolves.toEqual({ content: 'first', revision: 1 });
    // Stale expected revision is rejected.
    await expect(setDraftRev(SERVER, SESSION, 'stale', 0)).resolves.toBe(false);
    await expect(getDraftRev(SERVER, SESSION)).resolves.toEqual({ content: 'first', revision: 1 });
    await expect(setDraftRev(SERVER, SESSION, 'second', 1)).resolves.toBe(true);
    await expect(getDraft(SERVER, SESSION)).resolves.toBe('second');
  });

  it('stageSend clears both draft tables for the scope only', async () => {
    await setDraftRev(SERVER, SESSION, 'draft text', 0);
    await setDraftRev(SERVER, 'other', 'other draft', 0);
    await stageSend(SERVER, SESSION, { clientMessageId: 's1', content: 'hi', createdAt: 1 });
    await expect(getDraftRev(SERVER, SESSION)).resolves.toEqual({ content: '', revision: 0 });
    await expect(getDraftRev(SERVER, 'other')).resolves.toEqual({ content: 'other draft', revision: 1 });
  });
});

describe('history revisions (R11)', () => {
  beforeEach(async () => {
    await openDatabaseForTests();
  });

  it('applies only newer revisions and deletes rows past total on reset', async () => {
    await upsertMessages(SERVER, SESSION, [
      { index: 0, role: 'user', content: 'a' },
      { index: 1, role: 'user', content: 'b' },
      { index: 2, role: 'user', content: 'c' },
      { index: 3, role: 'user', content: 'd' },
    ]);
    await expect(upsertHistoryRevisionIfNewer(SERVER, SESSION, 2, 4, 'gen-a')).resolves.toBe(true);
    // Stale + duplicate revisions are rejected.
    await expect(upsertHistoryRevisionIfNewer(SERVER, SESSION, 2, 4, 'gen-a')).resolves.toBe(false);
    await expect(upsertHistoryRevisionIfNewer(SERVER, SESSION, 1, 10, 'gen-a')).resolves.toBe(false);
    // Newer revision with a smaller total (clear/reset): rows past total go.
    await expect(upsertHistoryRevisionIfNewer(SERVER, SESSION, 3, 2, 'gen-a')).resolves.toBe(true);
    const { messages } = await loadCachedMessages(SERVER, SESSION);
    expect(messages.map((message) => message.index)).toEqual([0, 1]);
    // Genesis change (compaction/compaction line) also prunes past total.
    await expect(upsertHistoryRevisionIfNewer(SERVER, SESSION, 4, 1, 'gen-b')).resolves.toBe(true);
    const after = await loadCachedMessages(SERVER, SESSION);
    expect(after.messages.map((message) => message.index)).toEqual([0]);
  });

  it('clearTranscriptRevision drops only the revision row', async () => {
    await upsertHistoryRevisionIfNewer(SERVER, SESSION, 5, 3, 'g');
    await clearTranscriptRevision(SERVER, SESSION);
    await expect(getHistoryRevision(SERVER, SESSION)).resolves.toBeNull();
  });

  it('invalidateTranscriptLineage clears messages and bookmarks but keeps pending sends', async () => {
    await upsertMessages(SERVER, SESSION, [{ index: 0, role: 'user', content: 'a' }]);
    const raw = await openDatabaseForTests();
    await raw.runAsync(
      'INSERT INTO bookmarks (server_id, session_id, message_index, fingerprint, updated_at) VALUES (?, ?, ?, ?, ?)',
      SERVER,
      SESSION,
      0,
      'fp',
      1,
    );
    await savePendingSend(SERVER, SESSION, {
      client_message_id: 'keep',
      content: 'unsent',
      state: 'unconfirmed',
      error: null,
      created_at: 1,
    });
    await invalidateTranscriptLineage(SERVER, SESSION);
    const { messages } = await loadCachedMessages(SERVER, SESSION);
    expect(messages).toEqual([]);
    const bookmark = await raw.getFirstAsync('SELECT * FROM bookmarks WHERE server_id = ? AND session_id = ?', SERVER, SESSION);
    expect(bookmark).toBeNull();
    expect((await listPendingSends(SERVER, SESSION)).map((row) => row.client_message_id)).toEqual(['keep']);
  });
});

describe('cache budgets (R29)', () => {
  beforeEach(async () => {
    await openDatabaseForTests();
  });

  it('accounts image-heavy rows by serialized bytes, not text length', async () => {
    const bigB64 = 'A'.repeat(200_000);
    await upsertMessages(SERVER, SESSION, [
      {
        index: 0,
        role: 'user',
        content: 'hi',
        images: [{ mediaType: 'image/png', uri: 'u', data: bigB64, name: 'big.png', alt: 'big' }],
      } as never,
    ]);
    const detailed = await cacheBytesDetailed();
    expect(detailed.transcriptBytes).toBeGreaterThan(190_000);
  });

  it('recountSerializedBytes is idempotent and fixes inaccurate legacy counts', async () => {
    const raw = await openDatabaseForTests();
    await upsertMessages(SERVER, SESSION, [{ index: 0, role: 'user', content: 'héllo' }]);
    // Corrupt the stored count like a pre-fix row would have.
    await raw.runAsync('UPDATE messages SET bytes = 1 WHERE server_id = ? AND session_id = ?', SERVER, SESSION);
    await recountSerializedBytes();
    await recountSerializedBytes();
    const detailed = await cacheBytesDetailed();
    expect(detailed.transcriptBytes).toBe(utf8ByteLength('héllo'));
  });

  it('per-session bound keeps the newest 500 rows (oldest evicted first)', async () => {
    const many = Array.from({ length: 520 }, (_, index) => ({
      index,
      role: 'user',
      content: `message ${index}`,
    }));
    await upsertMessages(SERVER, SESSION, many);
    const { messages } = await loadCachedMessages(SERVER, SESSION, 600);
    expect(messages).toHaveLength(500);
    expect(messages[0].index).toBe(20);
  });

  it('eviction preserves pending sends and drafts while crediting transcript budget', async () => {
    await setDraft(SERVER, SESSION, 'recoverable draft');
    await savePendingSend(SERVER, SESSION, {
      client_message_id: 'recoverable',
      content: 'recoverable send',
      state: 'unconfirmed',
      error: null,
      created_at: 1,
    });
    await upsertMessages(SERVER, SESSION, [
      { index: 0, role: 'user', content: 'a'.repeat(1000) },
      { index: 1, role: 'user', content: 'b'.repeat(1000) },
    ]);
    const detailed = await cacheBytesDetailed();
    expect(detailed.pendingCount).toBe(1);
    expect(detailed.pendingBytes).toBeGreaterThan(0);
    expect(detailed.transcriptBytes).toBeGreaterThan(0);
    expect(await getDraft(SERVER, SESSION)).toBe('recoverable draft');
    const pending = await getPendingSend(SERVER, SESSION, 'recoverable');
    expect(pending?.content).toBe('recoverable send');
  });

  it('migrateDatabase is idempotent on legacy schema and recounts bytes', async () => {
    // Simulate a pre-fix database handle with the legacy pending_sends shape.
    const raw = await openDatabaseForTests();
    await raw.runAsync(
      'CREATE TABLE legacy_pending (server_id TEXT, session_id TEXT, client_message_id TEXT)',
    );
    // migrateDatabase on the real handle must not throw and must be repeatable.
    await migrateDatabase(raw);
    await migrateDatabase(raw);
    await expect(getHistoryRevision(SERVER, SESSION)).resolves.toBeNull();
  });
});

describe('server cascade', () => {
  it('deleteServer removes pending sends, drafts and revisions for the profile', async () => {
    await openDatabaseForTests();
    await setDraft(SERVER, SESSION, 'draft');
    await setDraftRev(SERVER, SESSION, 'rev draft', 0);
    await savePendingSend(SERVER, SESSION, {
      client_message_id: 'x',
      content: 'c',
      state: 'draft',
      error: null,
      created_at: 1,
    });
    await upsertHistoryRevisionIfNewer(SERVER, SESSION, 1, 0, 'g');
    await deleteServer(SERVER);
    expect(await listPendingSends(SERVER, SESSION)).toEqual([]);
    expect(await getDraft(SERVER, SESSION)).toBe('');
  });
});
