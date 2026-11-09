/**
 * Native build: no e2e credential import.
 *
 * The web target has a compile-time-gated counterpart in `e2e-seed.web.ts`.
 * Keeping this file a no-op means the native bundle never contains the test
 * seam, even if `EXPO_PUBLIC_E2E` leaks into a build environment.
 */
export async function importE2ECredentials(): Promise<boolean> {
  return false;
}
