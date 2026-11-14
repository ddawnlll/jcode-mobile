/**
 * Shared content that arrived before a session surface existed.
 *
 * The controller clears drafts and attachments when a session opens, so a share
 * received while no session is active is held here until the next session
 * screen mounts. The payload is scoped to the paired server: a share received
 * on server A is never applied to a session on server B.
 */
import { useSyncExternalStore } from 'react';
import type { AttachmentDraft } from './attachments';

export interface PendingShare {
  /** Paired server this share belongs to; null until the phone is paired. */
  serverId: string | null;
  text: string;
  attachments: AttachmentDraft[];
}

let pending: PendingShare | null = null;
let revision = 0;
const listeners = new Set<() => void>();

function emit() {
  revision += 1;
  for (const listener of listeners) listener();
}

export function holdPendingShare(share: PendingShare | null) {
  pending = share && (share.text || share.attachments.length) ? share : null;
  emit();
}

/**
 * Takes the pending share for `serverId`. A share already scoped to another
 * server stays queued so switching back can still deliver it.
 */
export function takePendingShare(serverId: string | null | undefined): PendingShare | null {
  if (!pending) return null;
  if (pending.serverId && serverId && pending.serverId !== serverId) return null;
  const value = pending;
  pending = null;
  emit();
  return value;
}

export function hasPendingShare(serverId?: string | null): boolean {
  if (!pending) return false;
  // An unscoped share (received before pairing) belongs to the first server.
  if (serverId === undefined || !pending.serverId || !serverId) return true;
  return pending.serverId === serverId;
}

/**
 * A monotonic signal for session surfaces. It changes when a share is held or
 * taken so a mounted Session screen can consume content that arrived later.
 */
export function usePendingShareRevision(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => revision,
    () => 0,
  );
}
