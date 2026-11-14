/**
 * Bridge to the controller session mutations.
 *
 * The integrated controller exposes archive/restore/delete/favorite. Feature
 * detection is kept so an older controller build fails honestly instead of
 * throwing. `true` means the adapter acknowledged the mutation.
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

export type MutationVerb = 'Archive' | 'Restore' | 'Favorite' | 'Delete';

export function mutationMessage(result: MutationResult, verb: MutationVerb): string {
  if (result === 'unavailable') {
    return `${verb} is not available from this adapter build. Nothing changed.`;
  }
  if (result === 'failed') {
    return `${verb} was not acknowledged. Nothing changed on the server.`;
  }
  return `${verb} requested.`;
}
