import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import MarkdownIt from 'markdown-it';
import { IconBack, IconClose, IconMenu, IconMore } from './Icons';
import { controller, type AppState, type Screen } from '../lib/controller';
import { relativeTime, sessionTitle, statusLabel, isRunning } from '../lib/format';
import type { SessionSummary } from '../lib/protocol';
import { Torus } from './Torus';

export function ScreenHeader({
  title,
  subtitle,
  back,
  menu = false,
  right,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: Screen | null;
  menu?: boolean;
  right?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <header className="header">
      <div className="left-head">
        {menu ? (
          <button className="icon-btn" aria-label="Open sidebar" onClick={() => controller.openDrawer(true)}>
            <IconMenu />
          </button>
        ) : back ? (
          <button className="icon-btn" aria-label={`Back to ${back}`} onClick={() => controller.go(back)}>
            <IconBack />
          </button>
        ) : null}
        <div className="head-copy">
          <div className="head-title">{title}</div>
          {subtitle ? <div className="head-sub">{subtitle}</div> : null}
        </div>
      </div>
      {right || children ? <div className="head-actions">{right ?? children}</div> : null}
    </header>
  );
}

export function SessionRow({
  session,
  onOpen,
  active = false,
}: {
  session: SessionSummary;
  onOpen?: () => void;
  active?: boolean;
}) {
  const running = isRunning(session.status);
  return (
    <button
      type="button"
      className={`session-row ${active ? 'is-active' : ''}`}
      onClick={onOpen ?? (() => controller.openSession(session.session_id))}
      data-testid="session-row"
    >
      <span className="text">
        <strong>{sessionTitle(session)}</strong>
        <small>
          {running ? (
            <span className="running">
              <span className="status-mark" /> {statusLabel(session.status)}
            </span>
          ) : (
            statusLabel(session.status)
          )}
          {session.working_dir ? ` · ${session.working_dir.split('/').filter(Boolean).slice(-1)[0]}` : ''}
        </small>
      </span>
      <span className="side">{relativeTime(session.updated_at_ms)}</span>
    </button>
  );
}

export function TorusWork({
  label,
  detail,
  active = true,
  size = 24,
}: {
  label: string;
  detail?: string;
  active?: boolean;
  size?: number;
}) {
  return (
    <div className="work-main static">
      <div className={`work-glyph ${active ? 'is-live' : ''}`} aria-hidden="true">
        <Torus size={size} animated={active} />
      </div>
      <div className="work-lines">
        <div className="work-state">
          {label}
          {active ? <span className="thinking-dots">…</span> : null}
        </div>
        {detail ? <div className="work-detail">{detail}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <Torus size={52} animated={false} className="empty-torus" />
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
    </div>
  );
}

export function ConnectionBanner({ state }: { state: AppState }) {
  if (state.phase !== 'app') return null;
  if (state.connection.status === 'connected' && state.jcodeConnected) return null;
  const message =
    state.connection.status !== 'connected'
      ? state.connection.message ?? 'Adapter unreachable. Showing data saved on this phone.'
      : 'Adapter connected, but the JCode harness is unavailable.';
  return (
    <div className={`connection-banner ${state.connection.status === 'offline' ? 'is-offline' : ''}`} role="status">
      <span className="status-mark" />
      <span>{message}</span>
      {state.savedOnPhone ? <span className="saved-tag">Saved on this phone</span> : null}
    </div>
  );
}

export function SavedTag({ state }: { state: AppState }) {
  if (!state.savedOnPhone) return null;
  return <span className="saved-tag">Saved on this phone</span>;
}

export function Toast({ message }: { message: string | null }) {
  return (
    <div className={`toast ${message ? 'visible' : ''}`} role="status" aria-live="polite">
      {message}
    </div>
  );
}

export function Sheet({
  title,
  onClose,
  children,
  testId,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <div className="modal-scrim open" onClick={onClose} data-testid={testId}>
      <div className="modal open" role="dialog" aria-modal="true" aria-label={title} onClick={(event) => event.stopPropagation()}>
        <div className="grab" />
        <header className="overlay-header">
          <div className="overlay-title">{title}</div>
          <button className="icon-btn" aria-label="Close" onClick={onClose}>
            <IconClose />
          </button>
        </header>
        <div className="overlay-body">{children}</div>
      </div>
    </div>
  );
}

const markdown = new MarkdownIt({
  html: false,
  linkify: true,
  breaks: true,
  typographer: true,
});

markdown.renderer.rules.link_open = (tokens, index, options, _env, self) => {
  tokens[index].attrSet('target', '_blank');
  tokens[index].attrSet('rel', 'noreferrer noopener');
  return self.renderToken(tokens, index, options);
};

export function Markdown({ text }: { text: string }) {
  const html = useMemo(() => markdown.render(text), [text]);
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

export function Drawer({ state }: { state: AppState }) {
  const recent = state.sessions.slice(0, 6);
  const nav: Array<{ screen: Screen; label: string; icon: ReactNode }> = [
    { screen: 'home', label: 'Home', icon: <Torus size={20} animated={false} /> },
    { screen: 'sessions', label: 'Sessions', icon: <IconMore /> },
    { screen: 'projects', label: 'Projects', icon: <IconMenu /> },
    { screen: 'plan', label: 'Plan', icon: <IconMore /> },
    { screen: 'activity', label: 'Activity', icon: <IconMore /> },
    { screen: 'changes', label: 'Changes', icon: <IconMore /> },
    { screen: 'settings', label: 'Settings', icon: <IconMore /> },
  ];
  useEffect(() => {
    if (!state.drawerOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') controller.openDrawer(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state.drawerOpen]);
  return (
    <>
      <div
        className={`drawer-scrim ${state.drawerOpen ? 'open' : ''}`}
        onClick={() => controller.openDrawer(false)}
        aria-hidden={!state.drawerOpen}
      />
      <aside className={`drawer ${state.drawerOpen ? 'open' : ''}`} aria-label="Sidebar" aria-hidden={!state.drawerOpen}>
        <div className="drawer-top">
          <div className="drawer-brand">
            <span className="mark">
              jcode<span className="mark-slash">/</span>
            </span>
          </div>
          <button className="icon-btn" aria-label="Close sidebar" onClick={() => controller.openDrawer(false)}>
            <IconClose />
          </button>
        </div>
        <div className="drawer-body">
          <p className="drawer-sub">{state.server?.name ?? 'JCode Mobile'} · {state.server?.healthy ? 'harness online' : 'harness offline'}</p>
          <nav className="drawer-nav">
            {nav.map((item) => (
              <button
                key={item.screen}
                aria-current={state.screen === item.screen ? 'page' : undefined}
                onClick={() => controller.go(item.screen)}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>
          <div className="drawer-recent">
            <h2>Recent sessions</h2>
            {recent.length === 0 ? <p className="drawer-empty">No sessions yet.</p> : null}
            {recent.map((session) => (
              <button
                key={session.session_id}
                className="drawer-thread"
                onClick={() => controller.openSession(session.session_id)}
              >
                {sessionTitle(session)}
                <small>{relativeTime(session.updated_at_ms)}</small>
              </button>
            ))}
          </div>
        </div>
        <div className="drawer-foot">
          <button onClick={() => controller.go('settings')}>
            <Torus size={18} animated={false} /> Preferences
          </button>
          <span className="preview">v0.3.0</span>
        </div>
      </aside>
    </>
  );
}

export function HeaderMenuButton() {
  return (
    <button className="icon-btn" aria-label="Session options" onClick={() => controller.go('settings')}>
      <IconMore />
    </button>
  );
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    if (title) document.title = `${title} · JCode`;
  }, [title]);
}

export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const button = useRef<HTMLButtonElement>(null);
  return (
    <button
      ref={button}
      type="button"
      className="tiny-action"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          controller.setToast('Copied.');
        } catch {
          controller.setToast('Clipboard permission was denied.');
        }
      }}
    >
      {label}
    </button>
  );
}
