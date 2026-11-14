/**
 * Discrete reasoning-effort slider.
 *
 * The thumb snaps to labelled stops, vibrates on each snap (no-op where the
 * platform has no vibration), and commits only on release or keyboard change.
 */
import { useEffect, useRef, useState } from 'react';
import { controller, type AppState } from '../lib/controller';
import { haptic } from './motion';
import { BottomSheet } from './BottomSheet';

const EFFORTS = ['minimal', 'low', 'medium', 'high', 'xhigh', 'max'] as const;

export function ReasoningSlider({ state }: { state: AppState }) {
  const current = state.runtime?.reasoning_effort ?? null;
  const initialIndex = current ? EFFORTS.indexOf(current as (typeof EFFORTS)[number]) : -1;
  const [index, setIndex] = useState(initialIndex);
  const [dragging, setDragging] = useState(false);
  const [pending, setPending] = useState(false);
  const trackRef = useRef<HTMLDivElement>(null);
  const indexRef = useRef(initialIndex);
  indexRef.current = index;

  useEffect(() => {
    const next = current ? EFFORTS.indexOf(current as (typeof EFFORTS)[number]) : -1;
    if (next >= 0) setIndex(next);
  }, [current]);

  const commit = async (next: number) => {
    if (next < 0 || next >= EFFORTS.length) return;
    setPending(true);
    await controller.setReasoning(EFFORTS[next]);
    setPending(false);
  };

  const snapTo = (next: number, shouldCommit: boolean) => {
    if (next === indexRef.current) return;
    indexRef.current = next;
    setIndex(next);
    haptic('select');
    if (shouldCommit) void commit(next);
  };

  const positionToIndex = (clientX: number): number => {
    const track = trackRef.current;
    if (!track) return 0;
    const rect = track.getBoundingClientRect();
    const ratio = rect.width ? (clientX - rect.left) / rect.width : 0;
    return Math.round(Math.min(1, Math.max(0, ratio)) * (EFFORTS.length - 1));
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (pending) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDragging(true);
    snapTo(positionToIndex(event.clientX), false);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragging || pending) return;
    snapTo(positionToIndex(event.clientX), false);
  };

  const endDrag = () => {
    if (!dragging) return;
    setDragging(false);
    if (indexRef.current >= 0) void commit(indexRef.current);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    let next: number | null = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = Math.min(EFFORTS.length - 1, indexRef.current + 1);
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = Math.max(0, indexRef.current - 1);
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = EFFORTS.length - 1;
    if (next == null) return;
    event.preventDefault();
    snapTo(next, true);
  };

  const percent = index >= 0 ? (index / (EFFORTS.length - 1)) * 100 : 0;

  return (
    <BottomSheet
      title="Reasoning effort"
      onClose={() => controller.openSheet(null)}
      testId="reasoning-sheet"
    >
      <p className="form-help">
        Stops snap. Providers that do not support the chosen level reject it; the adapter re-reads
        runtime state instead of assuming the change took effect.
      </p>
      <div className="reason-current">
        <span>Current</span>
        <strong>{current ?? 'Not reported'}</strong>
        {pending ? <span className="model-pending">Setting…</span> : null}
      </div>
      <div
        className={`reason-slider ${index < 0 ? 'is-unknown' : ''} ${dragging ? 'is-dragging' : ''}`}
        role="slider"
        tabIndex={0}
        aria-label="Reasoning effort"
        aria-valuemin={0}
        aria-valuemax={EFFORTS.length - 1}
        aria-valuenow={index >= 0 ? index : undefined}
        aria-valuetext={index >= 0 ? EFFORTS[index] : 'Not reported'}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        data-testid="reasoning-slider"
      >
        <div className="reason-track" ref={trackRef}>
          <span className="reason-fill" style={{ width: `${percent}%` }} />
          {EFFORTS.map((effort, stop) => (
            <span
              key={effort}
              className={`reason-stop ${stop <= index ? 'is-past' : ''} ${stop === index ? 'is-current' : ''}`}
              style={{ left: `${(stop / (EFFORTS.length - 1)) * 100}%` }}
              aria-hidden="true"
            />
          ))}
          {index >= 0 ? (
            <span className="reason-thumb" style={{ left: `${percent}%` }} aria-hidden="true" />
          ) : null}
        </div>
        <div className="reason-labels">
          {EFFORTS.map((effort, stop) => (
            <button
              key={effort}
              type="button"
              tabIndex={-1}
              className={`reason-label ${stop === index ? 'is-current' : ''}`}
              onClick={() => {
                snapTo(stop, true);
              }}
            >
              {effort}
            </button>
          ))}
        </div>
      </div>
      {index < 0 ? (
        <p className="inspector-note">
          JCode has not reported a current effort for this session. The slider starts with no claim
          until you choose a stop.
        </p>
      ) : null}
      <div className="context-note">
        Provider: {state.runtime?.provider ?? 'unknown'} · account {state.runtime?.account_label ?? 'unknown'}
      </div>
    </BottomSheet>
  );
}
