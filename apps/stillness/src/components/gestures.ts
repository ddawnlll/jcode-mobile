/**
 * Touch-first gesture engine.
 *
 * Three primitives, all built on pointer events and one shared spring:
 * - `useAxisDrag` locks to one axis after a small threshold so vertical
 *   scrolling and text selection keep working.
 * - `useBackGuard` is the predictive-back stack. It installs a history guard
 *   only while something is open, so a plain back press outside an overlay is
 *   never intercepted.
 * - `usePullToRefresh` uses native non-passive touch listeners at scrollTop 0.
 */
import { useEffect, useRef, useState } from 'react';
import { prefersReducedMotion, resistance, spring, VelocityTracker } from './motion';

export type DragAxis = 'none' | 'x' | 'y';

export interface DragInfo {
  dx: number;
  dy: number;
  /** Velocity on the locked axis, px/ms. */
  vx: number;
  vy: number;
  axis: DragAxis;
  elapsed: number;
  pointerType: string;
}

export interface AxisDragOptions {
  /** Distance before an axis is claimed. Defaults to 8 CSS px. */
  threshold?: number;
  /** Axis to claim. Defaults to horizontal. */
  axis?: 'x' | 'y';
  /** Return false to ignore this pointer down. */
  shouldStart?: (event: React.PointerEvent) => boolean;
  onStart?: (info: DragInfo) => void;
  onMove?: (info: DragInfo) => void;
  onEnd?: (info: DragInfo) => void;
  onCancel?: () => void;
  onLongPress?: (info: DragInfo) => void;
  longPressMs?: number;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * Axis-locked pointer drag. Handlers are installed on `window` only while a
 * gesture is alive, so no global listener is leaked between gestures.
 */
export function useAxisDrag(options: AxisDragOptions) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const cleanupRef = useRef<(() => void) | null>(null);
  useEffect(() => () => cleanupRef.current?.(), []);

  const start = (event: React.PointerEvent) => {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    const opts = optionsRef.current;
    if (opts.shouldStart && !opts.shouldStart(event)) return;
    cleanupRef.current?.();

    const target = event.currentTarget as HTMLElement;
    const originX = event.clientX;
    const originY = event.clientY;
    const startedAt = now();
    const threshold = opts.threshold ?? 8;
    const claimedAxis = opts.axis ?? 'x';
    const xTracker = new VelocityTracker();
    const yTracker = new VelocityTracker();
    xTracker.reset(originX);
    yTracker.reset(originY);
    let axis: DragAxis = 'none';
    let moved = false;
    let last: DragInfo = {
      dx: 0,
      dy: 0,
      vx: 0,
      vy: 0,
      axis,
      elapsed: 0,
      pointerType: event.pointerType,
    };
    let longPressTimer: number | null = null;
    let longPressFired = false;
    let clickGuardTimer: number | null = null;
    const longPressMs = opts.longPressMs ?? 460;

    const info = (): DragInfo => {
      const dx = (last.dx = xTracker.last() - originX);
      const dy = (last.dy = yTracker.last() - originY);
      return {
        dx,
        dy,
        vx: xTracker.velocity(),
        vy: yTracker.velocity(),
        axis,
        elapsed: now() - startedAt,
        pointerType: event.pointerType,
      };
    };

    const clearLongPress = () => {
      if (longPressTimer != null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
    };

    if (opts.onLongPress) {
      longPressTimer = window.setTimeout(() => {
        longPressTimer = null;
        if (axis === 'none' && !moved) {
          // Wait for release before opening anything. Opening under the finger
          // would let the same gesture's click land on the new menu item.
          longPressFired = true;
        }
      }, longPressMs);
    }

    const onPointerMove = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== event.pointerId) return;
      xTracker.add(pointerEvent.clientX);
      yTracker.add(pointerEvent.clientY);
      const dx = pointerEvent.clientX - originX;
      const dy = pointerEvent.clientY - originY;
      if (axis === 'none') {
        const travel = Math.max(Math.abs(dx), Math.abs(dy));
        if (travel < threshold) return;
        const horizontal = Math.abs(dx) > Math.abs(dy);
        axis = horizontal ? (claimedAxis === 'x' ? 'x' : 'none') : claimedAxis === 'y' ? 'y' : 'none';
        if (axis === 'none') {
          clearLongPress();
          return;
        }
        moved = true;
        clearLongPress();
        opts.onStart?.(info());
      }
      if (last.axis !== axis) last.axis = axis;
      last = info();
      opts.onMove?.(last);
    };

    let pointerEventActive = true;
    const finish = (cancelled: boolean) => {
      if (pointerEventActive === false) return;
      pointerEventActive = false;
      clearLongPress();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
      cleanupRef.current = null;
      if (axis !== 'none' && moved) {
        suppressNextClick(target, clickGuardTimer, (value) => {
          clickGuardTimer = value;
        });
      }
      if (cancelled) opts.onCancel?.();
      else if (axis !== 'none' && moved) opts.onEnd?.(info());
      else if (longPressFired) {
        suppressNextClick(target, clickGuardTimer, (value) => {
          clickGuardTimer = value;
        });
        opts.onLongPress?.(info());
      }
    };

    const onPointerUp = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== event.pointerId) return;
      xTracker.add(pointerEvent.clientX);
      yTracker.add(pointerEvent.clientY);
      finish(false);
    };
    const onPointerCancel = (pointerEvent: PointerEvent) => {
      if (pointerEvent.pointerId !== event.pointerId) return;
      finish(true);
    };

    window.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerCancel);
    cleanupRef.current = () => finish(true);
  };

  return { onPointerDown: start };
}

function suppressNextClick(
  target: HTMLElement,
  existingTimer: number | null,
  setTimer: (value: number | null) => void,
) {
  if (existingTimer != null) window.clearTimeout(existingTimer);
  const swallow = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    target.removeEventListener('click', swallow, true);
  };
  target.addEventListener('click', swallow, true);
  const timer = window.setTimeout(() => {
    target.removeEventListener('click', swallow, true);
    setTimer(null);
  }, 420);
  setTimer(timer);
}

/* ------------------------------------------------------------------ */
/* Predictive back                                                      */
/* ------------------------------------------------------------------ */

interface BackLayer {
  id: string;
  close: () => void;
  consumed: boolean;
}

const backLayers: BackLayer[] = [];
let backSequence = 0;
let backInstalled = false;

function topLayer(): BackLayer | null {
  return backLayers.length ? backLayers[backLayers.length - 1] : null;
}

function onPopState() {
  const layer = topLayer();
  if (!layer) return;
  // The history entry that was carrying the guard is the one we just left, so
  // cleanup must not call history.back() a second time.
  layer.consumed = true;
  layer.close();
}

function onKeyDown(event: KeyboardEvent) {
  if (event.key !== 'Escape' && event.key !== 'Esc') return;
  const layer = topLayer();
  if (!layer) return;
  const target = event.target as HTMLElement | null;
  // Escape inside a text field or an expanded native control belongs to it.
  if (target && target.closest('input, textarea, select, [contenteditable="true"]')) return;
  event.preventDefault();
  event.stopPropagation();
  layer.consumed = true;
  layer.close();
}

function onNativeBack() {
  const layer = topLayer();
  if (!layer) return;
  layer.consumed = true;
  layer.close();
}

function installBack() {
  if (backInstalled) return;
  backInstalled = true;
  window.addEventListener('popstate', onPopState);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('jcode:back', onNativeBack as EventListener);
}

function uninstallBack() {
  if (!backInstalled || backLayers.length) return;
  backInstalled = false;
  window.removeEventListener('popstate', onPopState);
  window.removeEventListener('keydown', onKeyDown);
  window.removeEventListener('jcode:back', onNativeBack as EventListener);
}

/**
 * Closes the topmost overlay on Android back (via the WebView history stack),
 * the native shell's `jcode:back` event, or Escape. Inactive layers install
 * nothing at all, so back keeps its normal meaning when the surface is clear.
 */
export function useBackGuard(active: boolean, close: () => void, id?: string) {
  const closeRef = useRef(close);
  closeRef.current = close;
  useEffect(() => {
    if (!active) return;
    const layer: BackLayer = {
      id: id ?? `layer-${++backSequence}`,
      close: () => closeRef.current(),
      consumed: false,
    };
    backLayers.push(layer);
    installBack();
    let pushed = false;
    let armed = false;
    const armTimer = window.setTimeout(() => {
      armed = true;
    }, 320);
    try {
      window.history.pushState(
        { ...(window.history.state ?? {}), jcodeBackGuard: layer.id },
        '',
      );
      pushed = true;
    } catch {
      // A sandboxed WebView may refuse state pushes; Escape and the native
      // event still work.
    }
    return () => {
      window.clearTimeout(armTimer);
      const index = backLayers.indexOf(layer);
      if (index >= 0) backLayers.splice(index, 1);
      if (pushed && !layer.consumed) {
        try {
          if (window.history.state?.jcodeBackGuard === layer.id) {
            if (armed) {
              // Closing one overlay must never consume the guard of an overlay
              // that opened while this one was animating out. Give the next
              // task a moment, then consume only if this guard is still alone
              // and current.
              window.setTimeout(() => {
                if (backLayers.length) return;
                if (window.history.state?.jcodeBackGuard === layer.id) {
                  window.history.back();
                }
              }, 260);
            } else {
              // A development StrictMode remount closes immediately. Remove
              // the guard flag instead of navigating back over a newer guard.
              window.history.replaceState(
                { ...(window.history.state ?? {}), jcodeBackGuard: undefined },
                '',
              );
            }
          }
        } catch {
          // ignore
        }
      }
      uninstallBack();
    };
  }, [active, id]);
}

/** Imperative access for a native shell that cannot dispatch DOM events. */
export function requestBack(): boolean {
  const layer = topLayer();
  if (!layer) return false;
  layer.consumed = true;
  layer.close();
  return true;
}

export function hasOpenBackLayer(): boolean {
  return backLayers.length > 0;
}

/* ------------------------------------------------------------------ */
/* Swipe row registry: only one row is open at a time                   */
/* ------------------------------------------------------------------ */

const openSwipeRows = new Map<string, () => void>();

export function requestSwipeRow(id: string, close: () => void) {
  for (const [key, closeOther] of openSwipeRows) {
    if (key !== id) closeOther();
  }
  openSwipeRows.set(id, close);
}

export function releaseSwipeRow(id: string) {
  openSwipeRows.delete(id);
}

export function closeSwipeRows() {
  for (const close of openSwipeRows.values()) close();
  openSwipeRows.clear();
}

/* ------------------------------------------------------------------ */
/* Pull to refresh                                                      */
/* ------------------------------------------------------------------ */

export interface PullToRefreshOptions {
  containerRef: React.RefObject<HTMLElement | null>;
  onRefresh: () => Promise<boolean>;
  threshold?: number;
  maxDistance?: number;
  disabled?: boolean;
}

export interface PullToRefreshState {
  distance: number;
  progress: number;
  refreshing: boolean;
}

/**
 * Native pull-to-refresh. The indicator follows the finger with resistance,
 * and only calls `onRefresh` after the threshold is crossed. Completion is
 * whatever the caller's real request returned, never a timer.
 */
export function usePullToRefresh({
  containerRef,
  onRefresh,
  threshold = 64,
  maxDistance = 132,
  disabled = false,
}: PullToRefreshOptions): PullToRefreshState {
  const [distance, setDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;
  const disabledRef = useRef(disabled);
  disabledRef.current = disabled;
  const distanceRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const animateRef = useRef<ReturnType<typeof spring> | null>(null);

  const paint = (value: number) => {
    distanceRef.current = value;
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setDistance(distanceRef.current);
    });
  };

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    let startY: number | null = null;
    let pulling = false;
    let busy = false;
    let activeId: number | null = null;

    const settle = (target: number) => {
      animateRef.current?.cancel();
      animateRef.current = spring(distanceRef.current, target, {
        stiffness: 360,
        damping: 40,
        onFrame: paint,
        onRest: (value) => paint(value),
      });
    };

    const onTouchStart = (event: TouchEvent) => {
      if (busy || disabledRef.current || event.touches.length !== 1) {
        startY = null;
        return;
      }
      if (element.scrollTop > 0) {
        startY = null;
        return;
      }
      activeId = event.touches[0].identifier;
      startY = event.touches[0].clientY;
      pulling = false;
      animateRef.current?.cancel();
    };

    const onTouchMove = (event: TouchEvent) => {
      if (startY == null || busy || disabledRef.current) return;
      const touch = Array.from(event.touches).find((item) => item.identifier === activeId);
      if (!touch) return;
      const dy = touch.clientY - startY;
      if (dy <= 0) {
        if (pulling) {
          pulling = false;
          paint(0);
        }
        return;
      }
      if (element.scrollTop > 0) {
        startY = null;
        paint(0);
        return;
      }
      if (!pulling && dy < 6) return;
      pulling = true;
      // The browser would otherwise claim the gesture as an overscroll.
      if (event.cancelable) event.preventDefault();
      paint(resistance(dy, maxDistance, 0.8));
    };

    const finish = async () => {
      if (startY == null) return;
      startY = null;
      if (!pulling) {
        paint(0);
        return;
      }
      pulling = false;
      if (distanceRef.current < threshold) {
        settle(0);
        return;
      }
      busy = true;
      setRefreshing(true);
      paint(threshold);
      try {
        await refreshRef.current();
      } catch {
        // The caller owns the honest failure message.
      } finally {
        busy = false;
        setRefreshing(false);
        // The refresh result decides the announcement, not a timer; the bar
        // simply returns to rest either way.
        paint(0);
        settle(0);
      }
    };

    const onTouchEnd = () => {
      void finish();
    };
    const onTouchCancel = () => {
      startY = null;
      pulling = false;
      paint(0);
    };

    element.addEventListener('touchstart', onTouchStart, { passive: true });
    element.addEventListener('touchmove', onTouchMove, { passive: false });
    element.addEventListener('touchend', onTouchEnd);
    element.addEventListener('touchcancel', onTouchCancel);
    return () => {
      element.removeEventListener('touchstart', onTouchStart);
      element.removeEventListener('touchmove', onTouchMove);
      element.removeEventListener('touchend', onTouchEnd);
      element.removeEventListener('touchcancel', onTouchCancel);
      animateRef.current?.cancel();
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
    };
  }, [containerRef, maxDistance, threshold]);

  return {
    distance,
    progress: Math.min(1, distance / threshold),
    refreshing,
  };
}

export { prefersReducedMotion };
