import { memo, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  IconArchive,
  IconBack,
  IconCheck,
  IconCopy,
  IconCommand,
  IconMenu,
  IconMore,
  IconPin,
  IconTrash,
} from './Icons';
import { controller, type AppState, type Screen } from '../lib/controller';
import { relativeTime, sessionTitle, statusLabel, isRunning } from '../lib/format';
import type { SessionSummary } from '../lib/protocol';
import { Torus } from './Torus';
import { BottomSheet } from './BottomSheet';
import { SwipeableRow } from './SwipeableRow';
import { openSwitcher } from './QuickSwitcher';
import { copyText, haptic } from './motion';
import { useSessionPrefs } from '../lib/sessionPrefs';
import { archiveSession, deleteSession, pinSession } from '../lib/sessionShelf';

export { BottomSheet as Sheet } from './BottomSheet';
export { Drawer } from './GestureDrawer';
export { RichMarkdown as Markdown } from './RichMarkdown';

export function ScreenHeader({
  title,
  subtitle,
  back,
  menu = false,
  right,
  switcher = true,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  back?: Screen | null;
  menu?: boolean;
  right?: ReactNode;
  /** Command-palette affordance. On by default for every shell screen. */
  switcher?: boolean;
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
      <div className="head-actions">
        {switcher ? (
          <button
            className="icon-btn"
            aria-label="Open session switcher"
            title="Session switcher (⌘K)"
            data-testid="open-switcher"
            onClick={openSwitcher}
          >
            <IconCommand />
          </button>
        ) : null}
        {right ?? children}
      </div>
    </header>
  );
}

function SessionActionsMenu({
  session,
  serverId,
  pinned,
  onClose,
}: {
  session: SessionSummary;
  serverId: string | null;
  pinned: boolean;
  onClose: () => void;
}) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const finish = (action: () => void) => {
    onClose();
    window.setTimeout(action, 40);
  };
  return (
    <BottomSheet title={sessionTitle(session)} onClose={onClose} testId="session-menu">
      <div className="session-menu-id mono">{session.session_id}</div>
      <button
        className="overlay-row"
        onClick={() => finish(() => controller.openSession(session.session_id))}
      >
        <span>Open session</span>
      </button>
      <button
        className="overlay-row"
        onClick={() => finish(() => pinSession(serverId, session))}
      >
        <span>{pinned ? 'Unpin on this phone' : 'Pin on this phone'}</span>
      </button>
      <button
        className="overlay-row"
        onClick={() => finish(() => archiveSession(serverId, session))}
      >
        <span>Archive on this phone</span>
      </button>
      <button
        className="overlay-row"
        onClick={() =>
          finish(() => {
            void copyText(session.session_id);
            controller.setToast('Session id copied.');
          })
        }
      >
        <span>Copy session id</span>
      </button>
      {!confirmDelete ? (
        <button className="overlay-row danger-text" onClick={() => setConfirmDelete(true)}>
          <span>Delete session…</span>
        </button>
      ) : (
        <div className="confirm-row">
          <p>
            Delete is a server mutation. It is only sent when the controller exposes a delete verb;
            otherwise nothing is removed and the session stays exactly as it is.
          </p>
          <button
            className="danger-btn"
            onClick={() => finish(() => void deleteSession(serverId, session))}
          >
            Delete
          </button>
          <button className="tiny-action" onClick={() => setConfirmDelete(false)}>
            Cancel
          </button>
        </div>
      )}
    </BottomSheet>
  );
}

export const SessionRow = memo(function SessionRow({
  session,
  onOpen,
  active = false,
}: {
  session: SessionSummary;
  onOpen?: () => void;
  active?: boolean;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const serverId = controller.getSnapshot().credential?.serverId ?? null;
  const prefs = useSessionPrefs(serverId);
  const pinned = prefs.pinned.includes(session.session_id);
  const running = isRunning(session.status);
  const open = onOpen ?? (() => void controller.openSession(session.session_id));

  const leftActions = [
    {
      key: 'archive',
      label: 'Archive',
      icon: <IconArchive size={18} />,
      onAction: () => archiveSession(serverId, session),
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: <IconTrash size={18} />,
      tone: 'danger' as const,
      onAction: () => setMenuOpen(true),
    },
  ];
  const rightActions = [
    {
      key: 'pin',
      label: pinned ? 'Unpin' : 'Pin',
      icon: <IconPin size={18} />,
      tone: 'accent' as const,
      onAction: () => pinSession(serverId, session),
    },
  ];

  return (
    <>
      <SwipeableRow
        id={`session:${session.session_id}`}
        leftActions={leftActions}
        rightActions={rightActions}
        onLongPress={() => {
          haptic('open');
          setMenuOpen(true);
        }}
      >
        <div className={`session-row ${active ? 'is-active' : ''}`} data-pinned={pinned}>
          <button
            type="button"
            className="session-row-open"
            onClick={open}
            data-testid="session-row"
          >
            <span className="text">
              <strong>
                {pinned ? <IconPin size={13} className="row-pin" /> : null}
                {sessionTitle(session)}
              </strong>
              <small>
                {running ? (
                  <span className="running">
                    <span className="status-mark" /> {statusLabel(session.status)}
                  </span>
                ) : (
                  statusLabel(session.status)
                )}
                {session.working_dir
                  ? ` · ${session.working_dir.split('/').filter(Boolean).slice(-1)[0]}`
                  : ''}
              </small>
            </span>
            <span className="side">{relativeTime(session.updated_at_ms)}</span>
          </button>
          <button
            type="button"
            className="session-row-menu"
            aria-label={`Actions for ${sessionTitle(session)}`}
            aria-haspopup="dialog"
            onClick={() => setMenuOpen(true)}
          >
            <IconMore size={18} />
          </button>
        </div>
      </SwipeableRow>
      {menuOpen ? (
        <SessionActionsMenu
          session={session}
          serverId={serverId}
          pinned={pinned}
          onClose={() => setMenuOpen(false)}
        />
      ) : null}
    </>
  );
});

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

export function CopyButton({
  value,
  label = 'Copy',
  icon = false,
}: {
  value: string;
  label?: string;
  icon?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current);
    },
    [],
  );

  const run = async () => {
    const ok = await copyText(value);
    setCopied(ok);
    haptic('select');
    controller.setToast(ok ? 'Copied.' : 'Clipboard permission was denied.');
    if (timer.current != null) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  if (icon) {
    return (
      <button
        type="button"
        className={`copy-icon ${copied ? 'is-copied' : ''}`}
        aria-label={copied ? 'Copied' : label}
        title={label}
        onClick={() => void run()}
      >
        {copied ? <IconCheck size={15} /> : <IconCopy size={15} />}
      </button>
    );
  }
  return (
    <button type="button" className={`tiny-action copy-text ${copied ? 'is-copied' : ''}`} onClick={() => void run()}>
      {copied ? 'Copied' : label}
    </button>
  );
}
