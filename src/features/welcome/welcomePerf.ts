/**
 * Development-only pacing record for the welcome animation. The app never
 * claims a native frame rate from this; it records when a React paint commits
 * so the web e2e suite and a dev console can see the opening and idle cadence.
 */

import { Platform } from 'react-native';

export interface WelcomePerfSnapshot {
  frames: number;
  openingFrames: number;
  idleFrames: number;
  worstFrameMs: number;
  progress: number;
  openingDurationMs: number | null;
  settledAt: number | null;
}

const empty = (): WelcomePerfSnapshot => ({
  frames: 0,
  openingFrames: 0,
  idleFrames: 0,
  worstFrameMs: 0,
  progress: 0,
  openingDurationMs: null,
  settledAt: null,
});

let snapshot = empty();
let lastPaintAt: number | null = null;
let startedAt: number | null = null;

function now(): number {
  const perf = typeof globalThis !== 'undefined' ? globalThis.performance : undefined;
  return perf && typeof perf.now === 'function' ? perf.now() : Date.now();
}

function publish(): void {
  if (Platform.OS !== 'web' || typeof globalThis === 'undefined') return;
  (globalThis as unknown as Record<string, unknown>).__JCODE_WELCOME_PERF__ = {
    ...snapshot,
  };
}

export function resetWelcomePerf(): void {
  snapshot = empty();
  lastPaintAt = null;
  startedAt = now();
  publish();
}

export function recordWelcomePaint(opening: boolean, progress: number): void {
  const stamp = now();
  if (startedAt === null) startedAt = stamp;
  snapshot.progress = progress;
  snapshot.frames += 1;
  if (opening) snapshot.openingFrames += 1;
  else snapshot.idleFrames += 1;
  if (lastPaintAt !== null) {
    snapshot.worstFrameMs = Math.max(snapshot.worstFrameMs, stamp - lastPaintAt);
  }
  lastPaintAt = stamp;
  if (!opening && snapshot.settledAt === null) {
    snapshot.settledAt = stamp;
    snapshot.openingDurationMs = stamp - startedAt;
  }
  publish();
}

export function welcomePerfSnapshot(): WelcomePerfSnapshot {
  return { ...snapshot };
}
