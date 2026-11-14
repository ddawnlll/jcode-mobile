/**
 * Session shelf actions shared by swipe rows and the row menu.
 *
 * Archive and pin are phone-local, immediate, scoped to the paired server, and
 * undoable. Delete is only attempted when the controller exposes a mutation;
 * otherwise the UI says it is unavailable and leaves the session alone.
 */
import { useSyncExternalStore } from 'react';
import { controller } from './controller';
import type { SessionSummary } from './protocol';
import { sessionTitle } from './format';
import { haptic } from '../components/motion';
import {
  archiveSessionPref,
  restoreSessionPref,
  togglePinned,
} from './sessionPrefs';
import { deleteSessionOnServer, mutationMessage } from './sessionActions';

export interface UndoEntry {
  id: number;
  message: string;
  undo: () => void;
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

export function pushUndo(message: string, undo: () => void) {
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
  current.undo();
  haptic('select');
}

export function pinSession(
  serverId: string | null | undefined,
  session: Pick<SessionSummary, 'session_id' | 'title'>,
) {
  const pinned = togglePinned(serverId, session.session_id);
  haptic('select');
  controller.setToast(pinned ? 'Pinned on this phone.' : 'Unpinned.');
  return pinned;
}

export function archiveSession(
  serverId: string | null | undefined,
  session: Pick<SessionSummary, 'session_id' | 'title'>,
) {
  if (!serverId) return;
  const title = sessionTitle(session);
  archiveSessionPref(serverId, session.session_id);
  haptic('warn');
  pushUndo(`Archived “${title}” on this phone.`, () => {
    restoreSessionPref(serverId, session.session_id);
    controller.setToast('Restored to the session list.');
  });
}

export function restoreArchived(
  serverId: string | null | undefined,
  sessionId: string,
) {
  restoreSessionPref(serverId, sessionId);
  controller.setToast('Restored to the session list.');
}

export async function deleteSession(
  serverId: string | null | undefined,
  session: Pick<SessionSummary, 'session_id' | 'title'>,
) {
  const result = await deleteSessionOnServer(session.session_id);
  controller.setToast(mutationMessage(result, 'Delete'));
  if (result === 'ok' && serverId) archiveSessionPref(serverId, session.session_id);
}
