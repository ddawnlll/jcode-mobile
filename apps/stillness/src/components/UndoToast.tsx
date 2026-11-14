import { useUndoEntry, runUndo, dismissUndo } from '../lib/sessionShelf';
import { IconClose } from './Icons';

/** Action toast for undoable phone-local changes (archive). */
export function UndoToast() {
  const entry = useUndoEntry();
  if (!entry) return <div className="undo-toast" aria-hidden="true" />;
  return (
    <div className="undo-toast is-visible" role="status" aria-live="polite">
      <span>{entry.message}</span>
      <button type="button" className="undo-action" onClick={runUndo}>
        Undo
      </button>
      <button
        type="button"
        className="icon-btn small undo-dismiss"
        aria-label="Dismiss notification"
        onClick={dismissUndo}
      >
        <IconClose size={16} />
      </button>
    </div>
  );
}
