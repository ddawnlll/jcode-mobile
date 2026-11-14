/**
 * Stillness motion primitives.
 *
 * One dependency-free spring/rAF helper shared by every gesture surface. It
 * animates `transform` and `opacity` only, keeps one animation frame loop per
 * gesture, and degrades to an instant jump (crossfade only) when the app asks
 * for reduced motion.
 */
import { useEffect, useRef, useState } from 'react';

export const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  if (document.documentElement.dataset.motion === 'reduced') return true;
  return typeof window.matchMedia === 'function' && window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export interface SpringOptions {
  stiffness?: number;
  damping?: number;
  mass?: number;
  /** Initial velocity in px per millisecond (positive = toward larger values). */
  velocity?: number;
  onFrame: (value: number) => void;
  onRest?: (value: number) => void;
}

export interface SpringHandle {
  setTarget: (value: number, velocity?: number) => void;
  cancel: () => void;
}

interface SpringInternal {
  frame: number;
  value: number;
  target: number;
  velocity: number;
  cancelled: boolean;
}

/**
 * A critically-damped-ish numerical spring. Retargeting keeps the current
 * position and velocity, which is what makes gestures interruptible: the
 * animation never restarts from a synthetic origin.
 */
export function spring(initial: number, target: number, options: SpringOptions): SpringHandle {
  const stiffness = options.stiffness ?? 320;
  const damping = options.damping ?? 34;
  const mass = options.mass ?? 1;
  // Velocity arrives in px/ms so gestures and the integration agree on units.
  const state: SpringInternal = {
    frame: 0,
    value: initial,
    target,
    velocity: (options.velocity ?? 0) * 1000,
    cancelled: false,
  };

  if (prefersReducedMotion() || typeof requestAnimationFrame !== 'function') {
    state.value = state.target;
    options.onFrame(state.value);
    options.onRest?.(state.value);
    return {
      setTarget(value, velocity) {
        state.value = value;
        state.target = value;
        state.velocity = 0;
        options.onFrame(value);
        options.onRest?.(value);
      },
      cancel() {
        state.cancelled = true;
      },
    };
  }

  let last = performance.now();
  const step = (now: number) => {
    if (state.cancelled) return;
    const dt = Math.min(Math.max((now - last) / 1000, 0.001), 1 / 30);
    last = now;
    const force = -stiffness * (state.value - state.target) - damping * state.velocity;
    state.velocity += (force / mass) * dt;
    state.value += state.velocity * dt;
    if (Math.abs(state.value - state.target) < 0.35 && Math.abs(state.velocity) < 8) {
      state.value = state.target;
      options.onFrame(state.value);
      state.frame = 0;
      options.onRest?.(state.value);
      return;
    }
    options.onFrame(state.value);
    state.frame = requestAnimationFrame(step);
  };
  options.onFrame(state.value);
  state.frame = requestAnimationFrame(step);

  return {
    setTarget(value, velocity) {
      state.target = value;
      if (velocity != null) state.velocity = velocity * 1000;
      if (state.frame === 0 && !state.cancelled) {
        last = performance.now();
        state.frame = requestAnimationFrame(step);
      }
    },
    cancel() {
      state.cancelled = true;
      if (state.frame) cancelAnimationFrame(state.frame);
      state.frame = 0;
    },
  };
}

/** Tracks horizontal velocity from the most recent pointer samples. */
export class VelocityTracker {
  private samples: Array<{ at: number; x: number }> = [];

  reset(x: number, at = performance.now()) {
    this.samples = [{ x, at }];
  }

  add(x: number, at = performance.now()) {
    this.samples.push({ x, at });
    const cutoff = at - 110;
    while (this.samples.length > 2 && this.samples[0].at < cutoff) this.samples.shift();
  }

  last(): number {
    return this.samples.length ? this.samples[this.samples.length - 1].x : 0;
  }

  /** px per millisecond. */
  velocity(): number {
    if (this.samples.length < 2) return 0;
    const first = this.samples[0];
    const last = this.samples[this.samples.length - 1];
    const dt = Math.max(1, last.at - first.at);
    return (last.x - first.x) / dt;
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Rubber-band resistance for pulls past a natural boundary. */
export function resistance(offset: number, dimension: number, coefficient = 0.55): number {
  if (dimension <= 0) return offset;
  return (offset * dimension * coefficient) / (dimension + coefficient * Math.abs(offset));
}

export function prefersCoarsePointer(): boolean {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}

export type HapticKind = 'select' | 'snap' | 'open' | 'warn';

/**
 * Tactile confirmation for snap events. Native shells map this to their
 * haptics engine; browsers without a vibration API (including iOS) no-op.
 */
export function haptic(kind: HapticKind = 'select'): void {
  try {
    if (typeof navigator === 'undefined' || typeof navigator.vibrate !== 'function') return;
    const pattern: Record<HapticKind, number | number[]> = {
      select: 8,
      snap: 12,
      open: 16,
      warn: [14, 40, 14],
    };
    navigator.vibrate(pattern[kind]);
  } catch {
    // Haptics are an enhancement, never a dependency.
  }
}

/** Clipboard write with a legacy fallback for non-secure contexts. */
export async function copyText(value: string): Promise<boolean> {
  if (!value) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch {
    // Fall through to the selection-based path.
  }
  try {
    const area = document.createElement('textarea');
    area.value = value;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}

/**
 * Returns a value that updates at most once per animation frame. Used to batch
 * streaming text so token deltas do not re-render the transcript per token.
 */
export function useRafValue<T>(value: T): T {
  const [frameValue, setFrameValue] = useState(value);
  const latest = useRef(value);
  const frame = useRef<number | null>(null);
  useEffect(() => {
    latest.current = value;
    if (frame.current != null) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = null;
      setFrameValue(latest.current);
    });
  }, [value]);
  useEffect(
    () => () => {
      if (frame.current != null) cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );
  return frameValue === value ? value : frameValue;
}

const scrollMemory = new Map<string, number>();

/** The remembered offset for a key, if the screen has been visited. */
export function savedScrollOffset(key: string): number | null {
  return scrollMemory.has(key) ? (scrollMemory.get(key) as number) : null;
}

/**
 * Restores a screen's scroll offset when it remounts after navigation. The
 * position is remembered per server + screen + session key by the caller.
 */
export function useScrollMemory<T extends HTMLElement>(key: string) {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const saved = scrollMemory.get(key);
    if (saved != null) {
      // Two frames so the first paint has laid out the restored transcript.
      const restore = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          element.scrollTop = saved;
        });
      });
      return () => cancelAnimationFrame(restore);
    }
    return;
  }, [key]);

  const onScroll = (event: React.UIEvent<T>) => {
    scrollMemory.set(key, event.currentTarget.scrollTop);
  };
  return { ref, onScroll };
}

export interface Curve {
  stiffness: number;
  damping: number;
}

export const SPRING: Record<'drawer' | 'sheet' | 'row' | 'prompt', Curve> = {
  drawer: { stiffness: 340, damping: 36 },
  sheet: { stiffness: 380, damping: 40 },
  row: { stiffness: 420, damping: 34 },
  prompt: { stiffness: 300, damping: 32 },
};
