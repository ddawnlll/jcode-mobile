import { reconnect as policy } from '../../design/tokens';

/** Jittered backoff: 1, 2, 4, 8, 16, 30 s with ±20% and a 30 s cap. */
export function backoffDelay(attempt: number): number {
  const index = Math.min(Math.max(attempt, 0), policy.delaysMs.length - 1);
  const base = policy.delaysMs[index];
  const jitter = 1 + (Math.random() * 2 - 1) * policy.jitter;
  return Math.min(policy.capMs, Math.round(base * jitter));
}
