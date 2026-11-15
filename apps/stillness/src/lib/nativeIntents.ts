/** Pure interpretation of native deep links and share payloads. */
import type { DeepLinkPending, ShareItem } from './native-types';

export type DeepLinkIntent =
  | { kind: 'session'; sessionId: string }
  | { kind: 'new' }
  | { kind: 'sessions' }
  | { kind: 'none' }
  | { kind: 'unhandled'; message: string };

export function sessionIdFromUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const direct =
      parsed.searchParams.get('session_id') ??
      parsed.searchParams.get('session') ??
      parsed.searchParams.get('s');
    if (direct) return direct;
    const parts = parsed.pathname.split('/').filter(Boolean);
    const index = parts.findIndex((part) => part === 'session' || part === 'sessions');
    if (index >= 0 && parts[index + 1]) return decodeURIComponent(parts[index + 1]);
    if (parsed.host === 'session' && parts[0]) return decodeURIComponent(parts[0]);
    return null;
  } catch {
    return null;
  }
}

export function deepLinkIntent(
  link: DeepLinkPending | null | undefined,
): DeepLinkIntent {
  if (!link) return { kind: 'none' };
  if (link.sessionId) return { kind: 'session', sessionId: link.sessionId };
  if (link.action === 'new_session') return { kind: 'new' };
  if (link.action === 'sessions') return { kind: 'sessions' };
  const fromUrl = sessionIdFromUrl(link.url);
  if (fromUrl) return { kind: 'session', sessionId: fromUrl };
  if (link.action === 'open_session') {
    return { kind: 'unhandled', message: 'This link did not include a session id.' };
  }
  if (link.action === 'unknown') {
    return { kind: 'unhandled', message: 'Stillness does not recognize this link.' };
  }
  return { kind: 'none' };
}

export interface SharePlan {
  text: string;
  imageUris: string[];
  /** Items that are not text/url/image and will not be added. */
  unsupported: number;
}

export function sharePlan(items: ShareItem[] | null | undefined): SharePlan {
  const texts: string[] = [];
  const images = new Set<string>();
  let unsupported = 0;
  for (const item of items ?? []) {
    if (item.kind === 'text' || item.kind === 'url') {
      const value = (item.text ?? item.url ?? '').trim();
      if (value) texts.push(value);
      else unsupported += 1;
      continue;
    }
    const imageLike =
      item.kind === 'image' ||
      (item.kind === 'file' && (item.mimeType ?? '').toLowerCase().startsWith('image/'));
    if (imageLike && item.uri) {
      images.add(item.uri);
      continue;
    }
    unsupported += 1;
  }
  return { text: texts.join('\n\n'), imageUris: Array.from(images), unsupported };
}
