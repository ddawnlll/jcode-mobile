/**
 * Session shelf actions shared by swipe rows, the row menu and the archived
 * shelf.
 *
 * The adapter is authoritative for archive and favorite. Local preferences are
 * mirrored only as an offline fallback. Delete is attempted and its refusal is
 * reported without pretending anything was removed.
 */
import { useSyncExternalStore } from 'react';
import { controller } from './controller';
import type { SessionSummary } from './protocol';
import { sessionTitle } from './format';
import { haptic } from '../components/motion';
import {
  archiveSessionPref,
  favoriteView,
  getSessionPrefs,
  restoreSessionPref,
  setPinnedPref,
  togglePinned,
} from './sessionPrefs';
import {
  archiveSessionOnServer,
  deleteSessionOnServer,
  favoriteSessionOnServer,
  mutationMessage,
  restoreSessionOnServer,
  type MutationResult,
  type MutationVerb,
} from './sessionActions';

export interface UndoEntry {
  id: number;
  message: string;
  undo: () => void | Promise<void>;
}

let entry: UndoEntry | null = null;
let sequence = 0;
let timer: number | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function clearTimer() {
  if (timer != null) {
    window.clearTimeout(timer);
    timer = null;
  }
}

export function dismissUndo() {
  clearTimer();
  entry = null;
  emit();
}

export function pushUndo(message: string, undo: () => void | Promise<void>) {
  clearTimer();
  entry = { id: ++sequence, message, undo };
  emit();
  timer = window.setTimeout(() => {
    entry = null;
    emit();
  }, 6500);
}

export function useUndoEntry(): UndoEntry | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => entry,
    () => null,
  );
}

export function runUndo() {
  const current = entry;
  if (!current) return;
  dismissUndo();
  haptic('select');
  void Promise.resolve(current.undo()).catch(() => {
    controller.setToast('Undo could not be completed.');
  });
}

/**
 * Runs a controller mutation and only adds a generic message when the
 * controller did not already report the adapter's own refusal. The row list is
 * never changed here; it updates only when the adapter acknowledges and the
 * controller applies the returned session summary.
 */
async function runMutation(
  verb: MutationVerb,
  run: () => Promise<MutationResult>,
): Promise<MutationResult> {
  const before = controller.getSnapshot().toast;
  const result = await run();
  if (result !== 'ok' && controller.getSnapshot().toast === before) {
    controller.setToast(mutationMessage(result, verb));
  }
  return result;
}

/**
 * Server favorite when connected. Offline, a phone pin is toggled and labelled
 * as saved on this phone. A cached server favorite cannot be changed offline.
 */
export async function favoriteSession(
  serverId: string | null | undefined,
  session: Pick<SessionSummary, 'session_id' | 'title' | 'favorite'>,
): Promise<boolean | null> {
  const online = controller.getSnapshot().connection.status === 'connected';
  const prefs = getSessionPrefs(serverId);
  const current = favoriteView(session, prefs, online);
  if (!online) {
    if (current.source === 'server') {
      controller.setToast('Favorites are stored on the server. Reconnect to change this one.');
      return null;
    }
    const pinned = togglePinned(serverId, session.session_id);
    haptic('select');
    controller.setToast(pinned ? 'Pinned on this phone.' : 'Unpinned on this phone.');
    return pinned;
  }

  const result = await runMutation('Favorite', () =>
    favoriteSessionOnServer(session.session_id),
  );
  if (result !== 'ok') {
    return null;
  }
  const updated = controller
    .getSnapshot()
    .sessions.find((item) => item.session_id === session.session_id);
  const favorite = updated?.favorite === true;
  // Mirror the acknowledged state so the offline fallback matches the server.
  setPinnedPref(serverId, session.session_id, favorite);
  haptic('select');
  controller.setToast(
    favorite ? 'Added to favorites on this server.' : 'Removed from favorites on this server.',
  );
  return favorite;
}

/** Archives on the server, then offers an undo that restores on the server. */
export async function archiveSession(
  serverId: string | null | undefined,
  session: Pick<SessionSummary, 'session_id' | 'title'>,
): Promise<boolean> {
  const title = sessionTitle(session);
  const result = await runMutation('Archive', () =>
    archiveSessionOnServer(session.session_id),
  );
  if (result !== 'ok') {
    return false;
  }
  // Mirror the acknowledged state for offline lists, never as a success claim.
  archiveSessionPref(serverId, session.session_id);
  haptic('warn');
  pushUndo(`Archived “${title}”.`, async () => {
    const restored = await runMutation('Restore', () =>
      restoreSessionOnServer(session.session_id),
    );
    if (restored === 'ok') {
      restoreSessionPref(serverId, session.session_id);
      controller.setToast('Restored to the session list.');
    }
  });
  return true;
}

export async function restoreArchived(
  serverId: string | null | undefined,
  sessionId: string,
): Promise<boolean> {
  const result = await runMutation('Restore', () => restoreSessionOnServer(sessionId));
  if (result !== 'ok') {
    return false;
  }
  restoreSessionPref(serverId, sessionId);
  controller.setToast('Restored to the session list.');
  return true;
}

export async function deleteSession(
  serverId: string | null | undefined,
  session: Pick<SessionSummary, 'session_id' | 'title'>,
) {
  const online = controller.getSnapshot().connection.status === 'connected';
  if (!online) {
    controller.setToast('The adapter is offline. Nothing was removed.');
    return false;
  }
  const result = await runMutation('Delete', () =>
    deleteSessionOnServer(session.session_id),
  );
  if (result === 'ok') {
    controller.setToast('The adapter deleted the session.');
    restoreSessionPref(serverId, session.session_id);
    return true;
  }
  return false;
}
