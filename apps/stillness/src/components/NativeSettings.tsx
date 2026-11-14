/**
 * Android native controls. Every value comes from the bridge; unsupported or
 * failed calls show the native error code instead of a fabricated toggle.
 */
import { useEffect, useState } from 'react';
import { controller, type AppState } from '../lib/controller';
import { statusLabel } from '../lib/format';
import type { NotificationStatus } from '../lib/native-types';
import {
  backgroundSyncStatus,
  biometricStatus,
  getSettings,
  notificationStatus,
  postNotification,
  requestNotificationPermission,
  runBackgroundSyncNow,
  setBackgroundSync,
  setSettings,
} from '../lib/native';
import {
  disableNativeLock,
  enableNativeLock,
  lockNativeNow,
  nativeErrorLabel,
  publishBackgroundSync,
  publishLock,
  useNativeBackgroundSync,
  useNativeLock,
  useNativeShellStatus,
} from './nativeRuntime';

function syncLine(enabled: boolean, lastStatus: string | null, worker: string, queued: boolean): string {
  return [
    enabled ? 'On' : 'Off',
    statusLabel(lastStatus ?? 'unknown'),
    worker === 'periodic_work' ? 'periodic worker' : 'no worker',
    queued ? 'queued' : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

function readBoolean(value: unknown): boolean | null {
  if (value === true || value === 'true' || value === 1) return true;
  if (value === false || value === 'false' || value === 0) return false;
  return null;
}

function nativeError(scope: string, error: unknown): string {
  return `${scope}: ${nativeErrorLabel(error)}`;
}

export function NativeSettings({ state }: { state: AppState }) {
  const shell = useNativeShellStatus();
  const sync = useNativeBackgroundSync();
  const lock = useNativeLock();
  const [notifications, setNotifications] = useState<NotificationStatus | null>(null);
  const [haptics, setHaptics] = useState<boolean | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const ready = shell.state === 'ready';

  const recordError = (scope: string, error: unknown) => {
    const label = nativeError(scope, error);
    setErrors((previous) => [
      ...previous.filter((item) => !item.startsWith(`${scope}:`)),
      label,
    ]);
  };
  const clearError = (scope: string) => {
    setErrors((previous) => previous.filter((item) => !item.startsWith(`${scope}:`)));
  };

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    void (async () => {
      const [notificationResult, syncResult, hapticsResult, biometricResult] =
        await Promise.allSettled([
          notificationStatus(),
          backgroundSyncStatus(),
          getSettings(['hapticsEnabled']),
          biometricStatus(),
        ]);
      if (!alive) return;
      if (notificationResult.status === 'fulfilled') {
        setNotifications(notificationResult.value);
      } else {
        setErrors((previous) => [
          ...previous.filter((item) => !item.startsWith('Notifications:')),
          nativeError('Notifications', notificationResult.reason),
        ]);
      }
      if (syncResult.status === 'fulfilled') {
        publishBackgroundSync(syncResult.value);
      } else {
        setErrors((previous) => [
          ...previous.filter((item) => !item.startsWith('Background sync:')),
          nativeError('Background sync', syncResult.reason),
        ]);
      }
      if (hapticsResult.status === 'fulfilled') {
        setHaptics(readBoolean(hapticsResult.value.values.hapticsEnabled));
      } else {
        setErrors((previous) => [
          ...previous.filter((item) => !item.startsWith('Haptics:')),
          nativeError('Haptics', hapticsResult.reason),
        ]);
      }
      if (biometricResult.status === 'fulfilled') {
        publishLock(biometricResult.value);
      } else {
        setErrors((previous) => [
          ...previous.filter((item) => !item.startsWith('Privacy:')),
          nativeError('Privacy', biometricResult.reason),
        ]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [ready]);

  const requestPermission = async () => {
    setBusy('notifications');
    try {
      const status = await requestNotificationPermission();
      setNotifications(status);
      clearError('Notifications');
      controller.setToast(`Notification permission: ${statusLabel(status.permission)}.`);
    } catch (error) {
      recordError('Notifications', error);
      controller.setToast(nativeError('Notifications', error));
    } finally {
      setBusy(null);
    }
  };

  const postTest = async () => {
    setBusy('notifications');
    try {
      const result = await postNotification({
        kind: 'test',
        title: 'Stillness',
        body: 'Notifications from your JCode server are connected.',
      });
      if (result.posted) {
        clearError('Notifications');
        controller.setToast(
          `Test notification posted${result.channel ? ` on ${result.channel}` : ''}.`,
        );
      } else {
        const failure = new Error(result.error ?? 'The test notification was not posted.');
        recordError('Notifications', failure);
        controller.setToast(nativeError('Notifications', failure));
      }
    } catch (error) {
      recordError('Notifications', error);
      controller.setToast(nativeError('Notifications', error));
    } finally {
      setBusy(null);
    }
  };

  const toggleSync = async (enabled: boolean) => {
    setBusy('sync');
    try {
      const status = await setBackgroundSync({
        enabled,
        baseUrl: state.credential?.baseUrl ?? null,
      });
      publishBackgroundSync(status);
      clearError('Background sync');
    } catch (error) {
      recordError('Background sync', error);
      controller.setToast(nativeError('Background sync', error));
    } finally {
      setBusy(null);
    }
  };

  const runSyncNow = async () => {
    setBusy('sync');
    try {
      const status = await runBackgroundSyncNow();
      publishBackgroundSync(status);
      clearError('Background sync');
    } catch (error) {
      recordError('Background sync', error);
      controller.setToast(nativeError('Background sync', error));
    } finally {
      setBusy(null);
    }
  };

  const toggleHaptics = async (enabled: boolean) => {
    setBusy('haptics');
    try {
      const snapshot = await setSettings({ hapticsEnabled: enabled });
      setHaptics(readBoolean(snapshot.values.hapticsEnabled));
      clearError('Haptics');
    } catch (error) {
      recordError('Haptics', error);
      controller.setToast(nativeError('Haptics', error));
    } finally {
      setBusy(null);
    }
  };

  const enableLock = async () => {
    setBusy('privacy');
    try {
      const status = await enableNativeLock();
      clearError('Privacy');
      controller.setToast(status.message);
    } catch (error) {
      recordError('Privacy', error);
      controller.setToast(nativeError('Privacy', error));
    } finally {
      setBusy(null);
    }
  };

  const disableLock = async () => {
    setBusy('privacy');
    try {
      const status = await disableNativeLock();
      clearError('Privacy');
      controller.setToast(status.message);
    } catch (error) {
      recordError('Privacy', error);
      controller.setToast(nativeError('Privacy', error));
    } finally {
      setBusy(null);
    }
  };

  const lockNow = async () => {
    setBusy('privacy');
    try {
      const status = await lockNativeNow();
      clearError('Privacy');
      controller.setToast(status.message);
    } catch (error) {
      recordError('Privacy', error);
      controller.setToast(nativeError('Privacy', error));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="pref-group" data-testid="native-settings">
      <h2 className="pref-title">Android native</h2>
      {shell.state === 'inactive' || shell.state === 'checking' ? (
        <p className="inspector-empty">Checking the native bridge…</p>
      ) : shell.state === 'unsupported' ? (
        <div className="pref-row">
          <div>
            Native controls
            <small>
              Android only. The browser preview has no notification, background sync, haptics, or
              biometric bridge.
            </small>
          </div>
          <span className="note-sub">Android only</span>
        </div>
      ) : shell.state === 'failed' ? (
        <div className="pref-row" role="alert">
          <div>
            Native controls
            <small>The bridge did not install, so no native control is shown.</small>
          </div>
          <span className="note-sub danger-text">{shell.error ?? 'native_error'}</span>
        </div>
      ) : (
        <>
          {shell.platform ? (
            <p className="native-detail mono" data-testid="native-platform">
              {shell.platform.platform} API {shell.platform.apiLevel} · {shell.platform.deviceModel} ·
              app {shell.platform.appVersion}
            </p>
          ) : null}

          <div className="native-subhead">Notifications</div>
          <div className="pref-row">
            <div>
              Permission
              <small>
                {notifications
                  ? `${statusLabel(notifications.permission)} · ${
                      notifications.notificationsEnabled ? 'enabled' : 'disabled'
                    }`
                  : 'Status unavailable'}
              </small>
            </div>
            <div className="native-actions">
              <button
                className="tiny-action"
                onClick={() => void requestPermission()}
                disabled={busy === 'notifications'}
              >
                Request permission
              </button>
              <button
                className="tiny-action"
                onClick={() => void postTest()}
                disabled={busy === 'notifications'}
              >
                Post test
              </button>
            </div>
          </div>
          {notifications?.channels.length ? (
            <p className="native-detail">
              {notifications.channels
                .map((channel) => `${channel.name}: ${channel.enabled ? 'on' : 'off'}`)
                .join(' · ')}
            </p>
          ) : null}

          <div className="native-subhead">Background sync</div>
          <div className="pref-row">
            <div>
              Sync
              <small>
                {sync
                  ? syncLine(sync.enabled, sync.lastStatus, sync.worker, sync.queued)
                  : 'Status unavailable'}
              </small>
            </div>
            <div className="seg-switch" role="group" aria-label="Background sync">
              <button
                aria-pressed={sync?.enabled === true}
                disabled={!sync || busy === 'sync'}
                onClick={() => void toggleSync(true)}
              >
                On
              </button>
              <button
                aria-pressed={sync?.enabled === false}
                disabled={!sync || busy === 'sync'}
                onClick={() => void toggleSync(false)}
              >
                Off
              </button>
            </div>
          </div>
          <div className="pref-row">
            <div>
              Last run
              <small>
                {sync
                  ? [
                      sync.lastRunAt ? new Date(sync.lastRunAt).toLocaleString() : 'Never',
                      sync.lastHttpStatus != null ? `HTTP ${sync.lastHttpStatus}` : null,
                      sync.lastStatus ? statusLabel(sync.lastStatus) : null,
                      sync.lastError,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  : 'Status unavailable'}
              </small>
            </div>
            <button
              className="tiny-action"
              onClick={() => void runSyncNow()}
              disabled={!sync || busy === 'sync'}
            >
              Run now
            </button>
          </div>
          {sync?.lastCheckedBaseUrl ? (
            <p className="native-detail mono">{sync.lastCheckedBaseUrl}</p>
          ) : null}

          <div className="native-subhead">Haptics</div>
          <div className="pref-row">
            <div>
              Haptic feedback
              <small>{haptics === null ? 'Status unavailable' : haptics ? 'On' : 'Off'}</small>
            </div>
            <div className="seg-switch" role="group" aria-label="Haptics">
              <button
                aria-pressed={haptics === true}
                disabled={haptics === null || busy === 'haptics'}
                onClick={() => void toggleHaptics(true)}
              >
                On
              </button>
              <button
                aria-pressed={haptics === false}
                disabled={haptics === null || busy === 'haptics'}
                onClick={() => void toggleHaptics(false)}
              >
                Off
              </button>
            </div>
          </div>

          <div className="native-subhead">Privacy</div>
          <div className="pref-row">
            <div>
              Biometric lock
              <small>
                {lock
                  ? `${lock.enabled ? 'enabled' : 'disabled'} · ${
                      lock.locked ? 'locked' : 'unlocked'
                    } · ${statusLabel(lock.method)}`
                  : 'Status unavailable'}
              </small>
            </div>
            <span className="note-sub">
              {lock ? (lock.secretStored ? 'Secret stored' : 'No secret') : 'Status unknown'}
            </span>
          </div>
          {lock?.message ? <p className="native-detail">{lock.message}</p> : null}
          <div className="native-actions">
            <button
              className="tiny-action"
              onClick={() => void enableLock()}
              disabled={!lock || !lock.available || lock.enabled || busy === 'privacy'}
            >
              Enable lock
            </button>
            <button
              className="tiny-action"
              onClick={() => void disableLock()}
              disabled={!lock || !lock.enabled || busy === 'privacy'}
            >
              Disable lock
            </button>
            <button
              className="tiny-action"
              onClick={() => void lockNow()}
              disabled={!lock || !lock.enabled || lock.locked || busy === 'privacy'}
            >
              Lock now
            </button>
          </div>

          <p className="native-detail">
            These controls read real device state. A refused or unsupported call prints the native
            error code below, never a fabricated success.
          </p>
        </>
      )}
      {shell.listenerErrors.length ? (
        <p className="native-detail" role="status">
          Native events unavailable: {shell.listenerErrors.join(', ')}
        </p>
      ) : null}
      {errors.length ? (
        <div className="native-errors" role="alert">
          {errors.map((error) => (
            <span key={error}>{error}</span>
          ))}
        </div>
      ) : null}
    </section>
  );
}
