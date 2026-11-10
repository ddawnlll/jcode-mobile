/**
 * Last-request context observed by the adapter, persisted per session.
 *
 * The daemon's in-memory `last_usage` resets when an agent is reloaded or
 * hibernated. The adapter still knows the last measurement it saw on the wire,
 * so it can show an honest last-known snapshot instead of "unavailable" after
 * a reconnect. The observation time and model travel with the values.
 */
import { readJson, writeJsonAtomic } from './util.ts';

export interface CachedContext {
  model: string | null;
  contextWindow: number | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreate: number;
  at: number;
}

interface StoredState {
  sessions: Record<string, CachedContext>;
}

export class ContextCache {
  private readonly path: string;
  private state: StoredState = { sessions: {} };
  private loaded = false;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(path: string) {
    this.path = path;
  }

  async load(): Promise<void> {
    if (this.loaded) return;
    this.loaded = true;
    const stored = await readJson<StoredState>(this.path, { sessions: {} });
    if (stored && stored.sessions && typeof stored.sessions === 'object') {
      this.state = { sessions: stored.sessions };
    }
  }

  get(sessionId: string): CachedContext | null {
    return this.state.sessions[sessionId] ?? null;
  }

  remember(sessionId: string, value: CachedContext): void {
    if (!sessionId) return;
    this.state.sessions[sessionId] = value;
    // Bound the cache; recent sessions are the only ones that can be reopened.
    const entries = Object.entries(this.state.sessions).sort((a, b) => b[1].at - a[1].at);
    if (entries.length > 200) {
      this.state.sessions = Object.fromEntries(entries.slice(0, 200));
    }
    this.scheduleWrite();
  }

  private scheduleWrite(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void writeJsonAtomic(this.path, this.state).catch(() => undefined);
    }, 300);
    this.timer.unref?.();
  }
}
