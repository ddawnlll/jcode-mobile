/**
 * Bridge to optional controller session mutations.
 *
 * The coordinator owns `controller.ts`. Archive, delete and favorite verbs are
 * not on the public controller today, so this module feature-detects them at
 * runtime. When a method exists the UI calls it; when it does not, the UI says
 * so instead of mutating the server or inventing success.
 *
 * Expected shapes for the coordinator (documented in docs/STILLNESS_UX_0_4.md):
 *   archiveSession(sessionId: string): Promise<boolean>
 *   restoreSession(sessionId: string): Promise<boolean>
 *   deleteSession(sessionId: string): Promise<boolean>
 *   toggleFavorite(sessionId: string): Promise<boolean>
 */
import { controller } from './controller';

export interface SessionMutationApi {
  archiveSession?: (sessionId: string) => Promise<boolean>;
  restoreSession?: (sessionId: string) => Promise<boolean>;
  deleteSession?: (sessionId: string) => Promise<boolean>;
  toggleFavorite?: (sessionId: string) => Promise<boolean>;
}

export type MutationResult = 'ok' | 'unavailable' | 'failed';

export function sessionMutationApi(): SessionMutationApi {
  return controller as unknown as SessionMutationApi;
}

async function invoke(
  name: keyof SessionMutationApi,
  sessionId: string,
): Promise<MutationResult> {
  const api = sessionMutationApi();
  const method = api[name];
  if (typeof method !== 'function') return 'unavailable';
  try {
    const result = await method.call(controller, sessionId);
    return result === false ? 'failed' : 'ok';
  } catch {
    return 'failed';
  }
}

export function archiveSessionOnServer(sessionId: string): Promise<MutationResult> {
  return invoke('archiveSession', sessionId);
}

export function restoreSessionOnServer(sessionId: string): Promise<MutationResult> {
  return invoke('restoreSession', sessionId);
}

export function deleteSessionOnServer(sessionId: string): Promise<MutationResult> {
  return invoke('deleteSession', sessionId);
}

export function favoriteSessionOnServer(sessionId: string): Promise<MutationResult> {
  return invoke('toggleFavorite', sessionId);
}

export function mutationMessage(result: MutationResult, verb: 'Archive' | 'Restore' | 'Delete'): string {
  if (result === 'unavailable') {
    return `${verb} is not available from this adapter build. Nothing changed on the server.`;
  }
  if (result === 'failed') {
    return `${verb} was rejected by the adapter. Nothing was removed.`;
  }
  return `${verb} requested.`;
}
