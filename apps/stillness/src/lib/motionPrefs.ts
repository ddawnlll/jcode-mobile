/** Motion preference resolution shared by the app shell and tests. */

export type MotionPreference = 'system' | 'full' | 'subtle' | 'off';
export type EffectiveMotion = 'full' | 'subtle' | 'off';

export const MOTION_PREFERENCES: MotionPreference[] = ['system', 'full', 'subtle', 'off'];

/** Migrate the 0.5.0 "reduced" value and reject unknown stored values. */
export function normalizeMotionPreference(value: unknown): MotionPreference {
  if (value === 'system' || value === 'full' || value === 'subtle' || value === 'off') {
    return value;
  }
  if (value === 'reduced' || value === 'reduce') return 'off';
  return 'system';
}

/**
 * System follows the OS reduce-motion signal. An explicit Full/Subtle choice
 * is a deliberate override; Off always disables nonessential motion.
 */
export function resolveMotion(
  preference: MotionPreference,
  systemPrefersReduced: boolean,
): EffectiveMotion {
  if (preference === 'system') return systemPrefersReduced ? 'off' : 'full';
  return preference;
}
