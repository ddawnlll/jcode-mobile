import { useEffect, useRef, useState } from 'react';
import { Torus } from './Torus';
import { nativeErrorLabel, unlockNative, useNativeLock } from './nativeRuntime';

/**
 * Full-surface privacy gate. It renders only when the native bridge reports a
 * locked vault. The server keeps working while the phone is locked.
 */
export function LockGate() {
  const status = useNativeLock();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const unlockButton = useRef<HTMLButtonElement>(null);
  const locked = Boolean(status?.locked);

  useEffect(() => {
    if (!locked) return;
    unlockButton.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const container = root.current;
      if (!container) return;
      const items = Array.from(
        container.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      );
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [locked]);

  if (!locked || !status) return null;

  const unlock = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await unlockNative();
      setMessage(result.unlocked ? null : result.message);
    } catch (error) {
      setMessage(nativeErrorLabel(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="lock-gate"
      role="dialog"
      aria-modal="true"
      aria-label="JCode is locked"
      ref={root}
    >
      <div className="lock-gate-inner">
        <div className="lock-gate-mark">
          <Torus size={74} animated={false} />
          <span>
            jcode<span className="mark-slash">/</span>
          </span>
        </div>
        <div>
          <p className="quiet-eyebrow">STILLNESS / LOCKED</p>
          <h1 className="page-heading">Your sessions are locked.</h1>
          <p className="page-sub">{status.message || 'Unlock to return to this server.'}</p>
        </div>
        <div className="lock-gate-status">
          <span>{status.enabled ? 'Lock enabled' : 'Lock not enabled'}</span>
          <span>{status.available ? 'Biometric available' : 'Biometric unavailable'}</span>
          <span>{String(status.method ?? 'none').replace(/_/g, ' ')}</span>
        </div>
        {message ? (
          <p className="lock-gate-error" role="alert">
            {message}
          </p>
        ) : null}
        <button
          ref={unlockButton}
          className="primary-btn"
          onClick={() => void unlock()}
          disabled={busy}
        >
          {busy ? 'Unlocking…' : 'Unlock'}
        </button>
        <p className="home-footnote">
          The server keeps working while this phone is locked. Locking never cancels a turn.
        </p>
      </div>
    </div>
  );
}
