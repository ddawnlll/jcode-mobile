/**
 * One-shot native shell wiring.
 *
 * Installed after credentials finish restoring. It consumes pending deep links
 * and shares, forwards insets, lock state and background sync state, and gives
 * Android the back handler. Off Android installNativeBridge returns null and
 * the shell publishes `unsupported` so Settings can label it instead of
 * pretending the bridge exists.
 *
 * Every failure here is named with its native error code. Event channels are
 * registered individually so one refused channel cannot hide the others.
 */
import { useEffect } from 'react';
import { controller } from '../lib/controller';
import {
  consumePendingShare,
  consumePendingDeepLink,
  installNativeBridge,
  layoutStatus,
  onNativeEvent,
  refreshShortcuts,
  type NativeBridgeSession,
} from '../lib/native';
import type {
  BackgroundSyncStatus,
  BiometricStatus,
  DeepLinkPending,
  LayoutStatus,
  NativeEventMap,
  NativeEventName,
  SharePending,
} from '../lib/native-types';
import { deepLinkIntent, sharePlan } from '../lib/nativeIntents';
import {
  attachmentErrorMessage,
  attachmentFromUri,
  type AttachmentDraft,
} from '../lib/attachments';
import { MAX_DRAFT_ATTACHMENTS } from '../lib/attachmentRules';
import { holdPendingShare } from '../lib/pendingShare';
import { closeSwitcher } from './QuickSwitcher';
import { hasOpenBackLayer, requestBack } from './gestures';
import {
  applyNativeInsets,
  nativeErrorLabel,
  publishBackgroundSync,
  publishLock,
  publishNativeShell,
  refreshLockStatus,
} from './nativeRuntime';

function shortList(items: string[]): string {
  return items.slice(0, 3).join(', ') + (items.length > 3 ? ` and ${items.length - 3} more` : '');
}

/**
 * React StrictMode mounts effects twice in development. A late install from
 * the discarded generation must not clear the live generation's back handler.
 */
let shellGeneration = 0;

export function useNativeShell(active: boolean) {
  useEffect(() => {
    if (!active) return;
    const generation = ++shellGeneration;
    let disposed = false;
    let session: NativeBridgeSession | null = null;
    let disposers: Array<() => void> = [];
    let processingShare = false;
    let shareQueued = false;
    const stale = () => disposed || generation !== shellGeneration;

    const applyDeepLink = (link: DeepLinkPending | null | undefined) => {
      if (stale()) return;
      const intent = deepLinkIntent(link);
      if (intent.kind === 'none') return;
      if (intent.kind === 'unhandled') {
        controller.setToast(intent.message);
        return;
      }
      let phase = controller.getSnapshot().phase;
      if (phase === 'loading' || phase === 'pairing') {
        controller.setToast('Still connecting to the server. Try the link again when the list appears.');
        return;
      }
      if (phase === 'unpaired') {
        controller.setToast('Pair a server before opening this link.');
        return;
      }
      if (phase === 'ready') {
        controller.enterApp();
        phase = controller.getSnapshot().phase;
      }
      if (phase !== 'app') {
        controller.setToast('This link arrived before the app was ready.');
        return;
      }
      controller.openDrawer(false);
      controller.openSheet(null);
      closeSwitcher();
      if (intent.kind === 'new') {
        controller.go('new-session');
        return;
      }
      if (intent.kind === 'sessions') {
        controller.go('sessions');
        return;
      }
      void controller.openSession(intent.sessionId);
    };

    const applyShare = async (pending: SharePending, dropped = 0): Promise<void> => {
      if (stale()) return;
      const plan = sharePlan(pending.items);
      const notes: string[] = [];
      if (plan.unsupported || pending.discarded || dropped) {
        notes.push('Some shared files were not added. Stillness accepts text and images.');
      }

      let phase = controller.getSnapshot().phase;
      if (phase === 'ready') {
        controller.enterApp();
        phase = controller.getSnapshot().phase;
      }
      if (phase === 'loading' || phase === 'pairing' || phase === 'unpaired') {
        const heldServerId =
          phase === 'unpaired' ? null : (controller.getSnapshot().credential?.serverId ?? null);
        holdPendingShare({
          serverId: heldServerId,
          text: plan.text,
          attachments: [],
        });
        controller.setToast(
          phase === 'unpaired'
            ? 'Pair a server, then the shared text is ready in a new session.'
            : 'Still connecting. The shared text is ready for the next session.',
        );
        return;
      }

      const supportedImages = controller.getSnapshot().capabilities.includes('attachments.images');
      if (plan.imageUris.length && !supportedImages) {
        notes.push('Shared images were not added. Image attachments need a v3 adapter.');
      }
      const remaining = Math.max(
        0,
        MAX_DRAFT_ATTACHMENTS - controller.getSnapshot().attachments.length,
      );
      const targetUris = supportedImages ? plan.imageUris.slice(0, remaining) : [];
      if (supportedImages && plan.imageUris.length > remaining) {
        notes.push(`Only ${MAX_DRAFT_ATTACHMENTS} images can be attached.`);
      }

      const attachments: AttachmentDraft[] = [];
      for (const uri of targetUris) {
        if (stale()) return;
        try {
          attachments.push(await attachmentFromUri(uri));
        } catch (error) {
          notes.push(`A shared image was not read: ${attachmentErrorMessage(error)}`);
        }
      }

      const snapshot = controller.getSnapshot();
      const onSession = snapshot.screen === 'session' && Boolean(snapshot.activeSessionId);
      if (!onSession) {
        if (plan.text || attachments.length) {
          holdPendingShare({
            serverId: snapshot.credential?.serverId ?? null,
            text: plan.text,
            attachments,
          });
          notes.unshift('Shared content is ready for the next session.');
        }
        if (snapshot.activeSessionId) {
          void controller.openSession(snapshot.activeSessionId);
        } else if (phase === 'app') {
          notes.push('Choose a project to create a session.');
          controller.go('new-session');
        }
        if (notes.length) controller.setToast(notes.join(' '));
        return;
      }

      let added = 0;
      if (plan.text) {
        const current = controller.getSnapshot().composerText;
        controller.setComposerText(current.trim() ? `${current}\n\n${plan.text}` : plan.text);
      }
      for (const attachment of attachments) {
        if (controller.addAttachment(attachment)) added += 1;
        else notes.push('A shared image could not be attached.');
      }
      if (plan.text || added) {
        notes.unshift('Shared content added to the draft.');
      } else if (!notes.length) {
        notes.push('This share did not contain text or an image that could be added.');
      }
      controller.setToast(notes.join(' '));
    };

    const consumeShare = async (dropped = 0): Promise<void> => {
      if (processingShare) {
        shareQueued = true;
        return;
      }
      processingShare = true;
      try {
        do {
          shareQueued = false;
          try {
            const pending = await consumePendingShare();
            if (pending.items.length || pending.discarded) {
              await applyShare(pending, dropped);
            } else if (dropped) {
              controller.setToast(`${dropped} shared item(s) could not be read.`);
            }
          } catch (error) {
            controller.setToast(`Shared content could not be read: ${nativeErrorLabel(error)}`);
          }
          // A later share may have arrived while this one was being read.
          dropped = 0;
        } while (shareQueued && !stale());
      } finally {
        processingShare = false;
      }
    };

    const listenerErrors: string[] = [];
    const subscribe = async <K extends NativeEventName>(
      event: K,
      handler: (payload: NativeEventMap[K]) => void,
    ): Promise<void> => {
      try {
        const dispose = await onNativeEvent(event, handler);
        if (stale()) {
          dispose();
          return;
        }
        disposers.push(dispose);
      } catch (error) {
        listenerErrors.push(`${event} (${nativeErrorLabel(error)})`);
      }
    };

    void (async () => {
      publishNativeShell({ state: 'checking', error: null, listenerErrors: [] });
      try {
        const installed = await installNativeBridge({
          onBack: () => {
            if (!hasOpenBackLayer()) return false;
            requestBack();
            return true;
          },
        });
        if (stale()) {
          // Only the live generation owns the global back handler.
          if (generation === shellGeneration) installed?.dispose();
          return;
        }
        if (!installed) {
          publishNativeShell({ state: 'unsupported', error: null, listenerErrors: [] });
          return;
        }
        session = installed;
        // Publish only generic shortcuts. Recent-session links need a
        // server-scoped identity before they can safely be exposed.
        void refreshShortcuts().catch(() => {});
        publishNativeShell({
          state: 'ready',
          platform: installed.platform,
          capabilities: installed.capabilities,
          error: null,
        });
        applyNativeInsets(installed.layout);

        await Promise.all([
          subscribe('deepLink', applyDeepLink),
          subscribe('shareInbound', (payload) => {
            void consumeShare(payload.dropped ?? 0);
          }),
          subscribe('lockStateChanged', (status: BiometricStatus) => publishLock(status)),
          subscribe('insetsChanged', (status: LayoutStatus) => applyNativeInsets(status)),
          subscribe('backgroundSyncChanged', (status: BackgroundSyncStatus) =>
            publishBackgroundSync(status),
          ),
        ]);
        if (stale()) return;
        if (listenerErrors.length) {
          publishNativeShell({ listenerErrors });
          controller.setToast(`Some native events are unavailable: ${shortList(listenerErrors)}.`);
        }

        applyDeepLink(installed.pendingDeepLink);
        // installNativeBridge drains pending intents and layout with internal
        // catch blocks (that file is bridge-owned). Re-read them here so a
        // refused drain is surfaced instead of silently dropping content.
        try {
          applyNativeInsets(await layoutStatus());
        } catch (error) {
          controller.setToast(`Native insets unavailable: ${nativeErrorLabel(error)}`);
        }
        try {
          applyDeepLink(await consumePendingDeepLink());
        } catch (error) {
          controller.setToast(
            `A pending deep link could not be read: ${nativeErrorLabel(error)}`,
          );
        }
        if (installed.pendingShare.items.length || installed.pendingShare.discarded) {
          processingShare = true;
          try {
            await applyShare(installed.pendingShare);
          } finally {
            processingShare = false;
          }
        }
        void consumeShare();
        if (stale()) return;

        const lock = await refreshLockStatus();
        if (!lock.status && !stale()) {
          controller.setToast(
            `Biometric lock status is unavailable: ${lock.error ?? 'no native answer'}.`,
          );
        }
      } catch (error) {
        if (stale()) return;
        const label = nativeErrorLabel(error);
        publishNativeShell({ state: 'failed', error: label });
        controller.setToast(`Native bridge unavailable: ${label}`);
      }
    })();

    return () => {
      disposed = true;
      if (generation === shellGeneration) session?.dispose();
      session = null;
      for (const dispose of disposers) dispose();
      disposers = [];
    };
  }, [active]);
}
