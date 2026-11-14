/**
 * Small runtime store for native state the app shell and settings share.
 *
 * The bridge itself lives in lib/native.ts (Android worker owned). This module
 * only publishes bridge install status, lock status, background sync status,
 * applies insets as CSS variables, and normalizes native errors for display.
 */
import { useSyncExternalStore } from 'react';
import type {
  BackgroundSyncStatus,
  BiometricStatus,
  CapabilityMatrix,
  LayoutStatus,
  PlatformStatus,
} from '../lib/native-types';
import {
  biometricStatus,
  disableBiometricLock,
  enableBiometricLock,
  isNativeBridgeError,
  lockNow,
  unlockWithBiometrics,
} from '../lib/native';

export type NativeShellState = 'inactive' | 'checking' | 'unsupported' | 'ready' | 'failed';

export interface NativeShellStatus {
  /** `unsupported` means the web target, not a broken bridge. */
  state: NativeShellState;
  platform: PlatformStatus | null;
  capabilities: CapabilityMatrix | null;
  /** `code: message` when install failed, otherwise null. */
  error: string | null;
  /** Event channels that could not be registered, each with its error code. */
  listenerErrors: string[];
}

const initialShell: NativeShellStatus = {
  state: 'inactive',
  platform: null,
  capabilities: null,
  error: null,
  listenerErrors: [],
};

let shellStatus: NativeShellStatus = initialShell;
let lockStatus: BiometricStatus | null = null;
let syncStatus: BackgroundSyncStatus | null = null;
const shellListeners = new Set<() => void>();
const lockListeners = new Set<() => void>();
const syncListeners = new Set<() => void>();

function emit(listeners: Set<() => void>) {
  for (const listener of listeners) listener();
}

export function publishNativeShell(patch: Partial<NativeShellStatus>) {
  shellStatus = { ...shellStatus, ...patch };
  emit(shellListeners);
}

export function useNativeShellStatus(): NativeShellStatus {
  return useSyncExternalStore(
    (listener) => {
      shellListeners.add(listener);
      return () => shellListeners.delete(listener);
    },
    () => shellStatus,
    () => initialShell,
  );
}

export function publishLock(status: BiometricStatus | null) {
  lockStatus = status;
  emit(lockListeners);
}

export function useNativeLock(): BiometricStatus | null {
  return useSyncExternalStore(
    (listener) => {
      lockListeners.add(listener);
      return () => lockListeners.delete(listener);
    },
    () => lockStatus,
    () => null,
  );
}

export function publishBackgroundSync(status: BackgroundSyncStatus | null) {
  syncStatus = status;
  emit(syncListeners);
}

export function useNativeBackgroundSync(): BackgroundSyncStatus | null {
  return useSyncExternalStore(
    (listener) => {
      syncListeners.add(listener);
      return () => syncListeners.delete(listener);
    },
    () => syncStatus,
    () => null,
  );
}

export function applyNativeInsets(status: LayoutStatus | null | undefined) {
  if (!status || typeof document === 'undefined') return;
  const root = document.documentElement;
  const insets = status.insets;
  const set = (name: string, value: number) => {
    root.style.setProperty(name, `${Math.max(0, Math.round(value))}px`);
  };
  set('--native-inset-top', insets.top);
  set('--native-inset-right', insets.right);
  set('--native-inset-bottom', insets.bottom);
  set('--native-inset-left', insets.left);
  set('--native-ime-bottom', status.imeVisible ? insets.imeBottom : 0);
  root.dataset.nativeInsets = 'on';
  root.dataset.nativeIme = status.imeVisible ? 'on' : 'off';
}

export interface LockRefresh {
  status: BiometricStatus | null;
  /** Native error code and message when the status call failed. */
  error: string | null;
}

export async function refreshLockStatus(): Promise<LockRefresh> {
  try {
    const status = await biometricStatus();
    publishLock(status);
    return { status, error: null };
  } catch (error) {
    return { status: null, error: nativeErrorLabel(error) };
  }
}

export async function enableNativeLock(): Promise<BiometricStatus> {
  const status = await enableBiometricLock();
  publishLock(status);
  return status;
}

export async function disableNativeLock(): Promise<BiometricStatus> {
  const status = await disableBiometricLock();
  publishLock(status);
  return status;
}

export async function lockNativeNow(): Promise<BiometricStatus> {
  const status = await lockNow();
  publishLock(status);
  return status;
}

export async function unlockNative(): Promise<{ unlocked: boolean; message: string }> {
  try {
    const result = await unlockWithBiometrics();
    const status = await biometricStatus().catch(() => null);
    if (status) publishLock(status);
    else if (result.unlocked && lockStatus) publishLock({ ...lockStatus, locked: false });
    return { unlocked: result.unlocked, message: result.message };
  } catch (error) {
    return { unlocked: false, message: nativeErrorLabel(error) };
  }
}

export function nativeErrorLabel(error: unknown): string {
  if (isNativeBridgeError(error)) return `${error.code}: ${error.message}`;
  if (error instanceof Error) return error.message;
  return String(error);
}
