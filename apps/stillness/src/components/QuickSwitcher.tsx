/**
 * Command-palette session switcher.
 *
 * Runs entirely on the cached session inventory for the paired server, so it
 * works offline and never invents unread counts. Pinned sessions come from the
 * phone-local shelf and are labelled as such.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { controller, type AppState } from '../lib/controller';
import { relativeTime, sessionTitle, isRunning } from '../lib/format';
import { useSessionPrefs, visibleSessions } from '../lib/sessionPrefs';
import { IconSearch } from './Icons';
import { useBackGuard } from './gestures';

let switcherOpen = false;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function openSwitcher() {
  if (switcherOpen) return;
  switcherOpen = true;
  emit();
}

export function closeSwitcher() {
  if (!switcherOpen) return;
  switcherOpen = false;
  emit();
}

export function useSwitcherOpen(): boolean {
  const [open, setOpen] = useState(switcherOpen);
  useEffect(() => {
    const listener = () => setOpen(switcherOpen);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        if (switcherOpen) closeSwitcher();
        else openSwitcher();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return open;
}

export function QuickSwitcher({ state }: { state: AppState }) {
  const open = useSwitcherOpen();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const serverId = state.credential?.serverId ?? null;
  const prefs = useSessionPrefs(serverId);
  const login = state.connection.status === 'connected' && state.jcodeConnected;

  useBackGuard(open, closeSwitcher, 'quick-switcher');

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setSelected(0);
    const timer = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(timer);
  }, [open]);

  const results = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const ordered = visibleSessions(state.sessions, prefs);
    const pinned = new Set(prefs.pinned);
    const matches = ordered.filter((session) => {
      if (!needle) return true;
      return (
        sessionTitle(session).toLowerCase().includes(needle) ||
        (session.working_dir ?? '').toLowerCase().includes(needle) ||
        (session.project_id ?? '').toLowerCase().includes(needle)
      );
    });
    return matches.map((session) => ({
      session,
      pinned: pinned.has(session.session_id),
    }));
  }, [prefs, query, state.sessions]);

  useEffect(() => {
    setSelected((value) => Math.min(value, Math.max(0, results.length - 1)));
  }, [results.length]);

  if (!open) return null;

  const choose = (sessionId: string) => {
    closeSwitcher();
    void controller.openSession(sessionId);
  };

  const pinnedResults = results.filter((item) => item.pinned);
  const otherResults = results.filter((item) => !item.pinned);
  let rowIndex = -1;

  return (
    <div className="switcher-scrim" onClick={closeSwitcher} data-testid="quick-switcher">
      <div
        className="switcher"
        role="dialog"
        aria-modal="true"
        aria-label="Session switcher"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="switcher-search">
          <IconSearch size={18} />
          <input
            ref={inputRef}
            type="search"
            value={query}
            placeholder="Switch to a session…"
            aria-label="Search sessions to switch"
            aria-controls="switcher-list"
            aria-activedescendant={
              results[selected] ? `switcher-${results[selected].session.session_id}` : undefined
            }
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                closeSwitcher();
              } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                setSelected((value) => Math.min(results.length - 1, value + 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setSelected((value) => Math.max(0, value - 1));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                const item = results[selected];
                if (item) choose(item.session.session_id);
              }
            }}
          />
          <button className="tiny-action" onClick={closeSwitcher} aria-label="Close session switcher">
            Esc
          </button>
        </div>
        {!login ? (
          <div className="switcher-note" role="status">
            Offline. Showing sessions saved on this phone for this server.
          </div>
        ) : null}
        <div className="switcher-list" id="switcher-list" role="listbox" aria-label="Sessions">
          {results.length === 0 ? (
            <p className="switcher-empty">
              {state.sessions.length === 0
                ? 'No sessions are cached for this server yet.'
                : 'No session matches that search.'}
            </p>
          ) : null}
          {pinnedResults.length ? (
            <div className="switcher-group" role="group" aria-label="Pinned on this phone">
              <span className="switcher-label">Pinned on this phone</span>
              {pinnedResults.map(({ session }) => {
                rowIndex += 1;
                return (
                  <SwitcherRow
                    key={session.session_id}
                    session={session}
                    index={rowIndex}
                    selected={rowIndex === selected}
                    pinned
                    onHover={setSelected}
                    onChoose={choose}
                  />
                );
              })}
            </div>
          ) : null}
          {otherResults.length ? (
            <div className="switcher-group" role="group" aria-label="Other sessions">
              <span className="switcher-label">
                {state.savedOnPhone ? 'Saved on this phone' : 'On this server'}
              </span>
              {otherResults.map(({ session }) => {
                rowIndex += 1;
                return (
                  <SwitcherRow
                    key={session.session_id}
                    session={session}
                    index={rowIndex}
                    selected={rowIndex === selected}
                    pinned={false}
                    onHover={setSelected}
                    onChoose={choose}
                  />
                );
              })}
            </div>
          ) : null}
        </div>
        <footer className="switcher-foot">
          <span>{results.length} sessions · {state.server?.name ?? 'JCode server'}</span>
          <span>↑↓ move · Enter open · Esc close</span>
        </footer>
      </div>
    </div>
  );
}

function SwitcherRow({
  session,
  index,
  selected,
  pinned,
  onHover,
  onChoose,
}: {
  session: AppState['sessions'][number];
  index: number;
  selected: boolean;
  pinned: boolean;
  onHover: (index: number) => void;
  onChoose: (sessionId: string) => void;
}) {
  return (
    <button
      type="button"
      id={`switcher-${session.session_id}`}
      role="option"
      aria-selected={selected}
      className={`switcher-item ${selected ? 'is-selected' : ''}`}
      onMouseEnter={() => onHover(index)}
      onFocus={() => onHover(index)}
      onClick={() => onChoose(session.session_id)}
      data-testid="switcher-item"
    >
      <span className="switcher-item-main">
        <span className="switcher-title">
          {sessionTitle(session)}
          {pinned ? <span className="switcher-pin">Pinned</span> : null}
        </span>
        <small>
          {isRunning(session.status) ? 'Working · ' : ''}
          {session.status}
          {session.working_dir ? ` · ${session.working_dir.split('/').filter(Boolean).slice(-1)[0]}` : ''}
        </small>
      </span>
      <span className="switcher-time">{relativeTime(session.updated_at_ms)}</span>
    </button>
  );
}
