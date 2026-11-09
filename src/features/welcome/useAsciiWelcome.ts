import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Platform } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

import {
  ASCII_IDLE_FRAME_MS,
  ASCII_OPEN_FRAME_MS,
  ASCII_OPEN_MS,
  paintAscii,
  type AsciiPaint,
  type AsciiScene,
} from './asciiTorus';
import { recordWelcomePaint, resetWelcomePerf, welcomePerfSnapshot } from './welcomePerf';

function now(): number {
  const perf = typeof globalThis !== 'undefined' ? globalThis.performance : undefined;
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
}

export interface AsciiWelcomeState {
  paint: AsciiPaint | null;
  opening: boolean;
  paused: boolean;
  skip: () => void;
  togglePause: () => void;
}

/**
 * Owns the welcome clock. The art pauses when the screen is unfocused or the
 * app is not active, resumes from the current position, and never counts the
 * time spent away as elapsed animation. Reduce Motion paints the settled frame
 * once and does not schedule a timer.
 */
export function useAsciiWelcome(scene: AsciiScene | null, reduceMotion: boolean): AsciiWelcomeState {
  const focused = useIsFocused();
  const [active, setActive] = useState(AppState.currentState === 'active');
  const [paint, setPaint] = useState<AsciiPaint | null>(null);
  const [opening, setOpening] = useState(!reduceMotion);
  const [paused, setPaused] = useState(false);
  const elapsedRef = useRef(reduceMotion ? ASCII_OPEN_MS : 0);
  const tickRef = useRef(0);
  const sceneKeyRef = useRef<string | null>(null);
  const reduceMotionRef = useRef(reduceMotion);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      setActive(next === 'active');
    });
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!scene) {
      setPaint(null);
      sceneKeyRef.current = null;
      return;
    }
    // A layout measurement can rebuild the scene a few frames after mount.
    // Keep the clock running across that change instead of restarting the
    // opening; only a fresh screen or a motion-preference change resets it.
    const restart =
      sceneKeyRef.current === null || reduceMotionRef.current !== reduceMotion;
    sceneKeyRef.current = scene.key;
    reduceMotionRef.current = reduceMotion;
    if (restart) {
      resetWelcomePerf();
      elapsedRef.current = reduceMotion ? ASCII_OPEN_MS : 0;
      tickRef.current = 0;
    }
    const next = paintAscii(scene, elapsedRef.current, tickRef.current, reduceMotion);
    setPaint(next);
    setOpening(next.opening);
    setPaused(false);
    recordWelcomePaint(next.opening, next.progress);
    if (Platform.OS === 'web' && typeof globalThis !== 'undefined') {
      (globalThis as unknown as Record<string, unknown>).__JCODE_WELCOME_SCENE__ = {
        cols: scene.cols,
        rows: scene.rows,
        donutStart: scene.donutStart,
        donutEnd: scene.donutEnd,
        titleMasked: scene.titleMasked,
      };
    }
    if (__DEV__ && process.env.NODE_ENV !== 'test') {
      const snapshot = welcomePerfSnapshot();
      console.info(
        `[welcome] layout ${scene.cols}x${scene.rows} cells, torus rows ${scene.donutStart}-${scene.donutEnd}, title mask ${scene.titleMasked ? 'on' : 'off'}, first paint ${Math.round(snapshot.worstFrameMs)} ms`,
      );
    }
  }, [scene, reduceMotion]);

  useEffect(() => {
    if (!scene || !focused || !active || paused || reduceMotion) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let last = now();

    const step = () => {
      if (cancelled) return;
      const stamp = now();
      const delta = Math.max(0, stamp - last);
      last = stamp;
      elapsedRef.current += delta;
      tickRef.current += 1;
      const next = paintAscii(scene, elapsedRef.current, tickRef.current, false);
      setPaint(next);
      setOpening(next.opening);
      recordWelcomePaint(next.opening, next.progress);
      timer = setTimeout(step, next.opening ? ASCII_OPEN_FRAME_MS : ASCII_IDLE_FRAME_MS);
    };

    step();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [scene, focused, active, paused, reduceMotion]);

  const skip = useCallback(() => {
    if (!scene) return;
    elapsedRef.current = Math.max(elapsedRef.current, ASCII_OPEN_MS);
    tickRef.current += 1;
    const next = paintAscii(scene, elapsedRef.current, tickRef.current, false);
    setPaint(next);
    setOpening(false);
    recordWelcomePaint(false, 1);
  }, [scene]);

  const togglePause = useCallback(() => {
    setPaused((value) => !value);
  }, []);

  return { paint, opening, paused, skip, togglePause };
}
