import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';

import type { RootStackParamList } from '../../shell/navigation';
import { BottomSheet } from '../../design/BottomSheet';
import { Button, Field, IconButton, TextAction } from '../../design/controls';
import {
  BackIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  FolderIcon,
  MoreIcon,
  SendIcon,
  StopIcon,
  WorkIcon,
} from '../../design/icons';
import { useTheme } from '../../design/theme';
import { budgets, geometry, radius, space, target } from '../../design/tokens';
import { Text } from '../../design/typography';
import { controller } from '../../core/app-controller';
import { useAppStore, type DeliveryRecord } from '../../core/state/store';
import type { HistoryMessage } from '../../core/protocol/frames';
import { Markdown } from './Markdown';
import { WorkSheet } from '../work/WorkSheet';
import { SessionSwitcherSheet } from '../sessions/SessionSwitcherSheet';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Conversation'>;
type Route = RouteProp<RootStackParamList, 'Conversation'>;

type ConversationItem =
  | { kind: 'seam'; key: string; count: number | null }
  | { kind: 'message'; key: string; message: HistoryMessage; roleStart: boolean }
  | { kind: 'delivery'; key: string; record: DeliveryRecord }
  | { kind: 'provisional'; key: string }
  | { kind: 'error'; key: string; message: string };

const DELIVERY_LABELS: Record<DeliveryRecord['state'], string> = {
  draft: 'Draft saved',
  sending: 'Sending…',
  sent_to_server: 'Sent to server',
  accepted: 'Accepted',
  queued: 'Queued for the next safe point',
  added: 'Added to this turn',
  unconfirmed: 'Delivery unconfirmed',
  rejected: 'Not sent',
};

function isSystemReminder(message: HistoryMessage): boolean {
  return message.role === 'user' && message.content.trimStart().startsWith('<system-reminder>');
}

export function ConversationScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const { fontScale } = useWindowDimensions();
  const textScale = Math.min(Math.max(fontScale, 1), 2);

  const conversation = useAppStore((state) => state.conversation);
  const connection = useAppStore((state) => state.connection);
  const sessions = useAppStore((state) => state.inventory.sessions);

  const listRef = useRef<FlatList<ConversationItem>>(null);
  const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
  const nearBottomRef = useRef(true);
  const draggingRef = useRef(false);
  const anchorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const restoredScroll = useRef(false);
  const [draft, setDraft] = useState('');
  const [workVisible, setWorkVisible] = useState(false);
  const [switcherVisible, setSwitcherVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [decision, setDecision] = useState<DeliveryRecord | null>(null);
  const [composerError, setComposerError] = useState<string | null>(null);
  const [renameVisible, setRenameVisible] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renameError, setRenameError] = useState<string | null>(null);

  useEffect(() => {
    if (route.params?.sessionId && conversation.sessionId !== route.params.sessionId) {
      const session = sessions.find((entry) => entry.session_id === route.params.sessionId);
      if (session) void controller.openSession(session);
    }
  }, [route.params?.sessionId, conversation.sessionId, sessions]);

  useEffect(() => {
    if (!conversation.sessionId) return;
    restoredScroll.current = false;
    void controller.draft(conversation.sessionId).then((value) => setDraft(value));
    return () => {
      controller.flushDraft();
    };
  }, [conversation.sessionId]);

  const messages = useMemo(
    () =>
      conversation.messages.filter(
        (message) =>
          message.role !== 'tool' &&
          !isSystemReminder(message) &&
          !(message.tool_data && message.content.trim().length === 0),
      ),
    [conversation.messages],
  );

  const items = useMemo<ConversationItem[]>(() => {
    const result: ConversationItem[] = [];
    let previousRole: string | null = null;
    const seamIndex = conversation.seam?.index ?? null;
    let seamPlaced = false;

    if (conversation.hasOlder) {
      result.push({
        kind: 'message',
        key: 'older-loader',
        message: { index: -1, role: 'system', content: '' },
        roleStart: false,
      });
    }
    for (const message of messages) {
      if (!seamPlaced && seamIndex !== null && message.index >= seamIndex) {
        result.push({ kind: 'seam', key: `seam-${seamIndex}`, count: conversation.seam?.count ?? null });
        seamPlaced = true;
      }
      result.push({
        kind: 'message',
        key: `m-${message.index}`,
        message,
        roleStart: message.role !== previousRole,
      });
      previousRole = message.role;
    }
    if (!seamPlaced && seamIndex !== null && seamIndex >= conversation.totalMessages) {
      result.push({ kind: 'seam', key: `seam-${seamIndex}`, count: conversation.seam?.count ?? null });
    }
    for (const record of conversation.delivery) {
      if (record.state === 'accepted') continue;
      if (record.guidance && record.state === 'added') continue;
      result.push({ kind: 'delivery', key: `d-${record.clientMessageId}`, record });
    }
    if (conversation.provisionalText) {
      result.push({ kind: 'provisional', key: 'provisional' });
    }
    if (conversation.lastError) {
      result.push({ kind: 'error', key: 'error', message: conversation.lastError });
    }
    return result;
  }, [messages, conversation.seam, conversation.delivery, conversation.provisionalText, conversation.totalMessages, conversation.hasOlder, conversation.lastError]);

  const scrollToEnd = useCallback((animated = true) => {
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated }));
  }, []);

  useEffect(() => {
    if (!restoredScroll.current && messages.length > 0) {
      restoredScroll.current = true;
      const bookmark = conversation.seam?.index ?? null;
      if (bookmark !== null && bookmark < conversation.totalMessages - 2) {
        const targetIndex = Math.max(
          0,
          items.findIndex((item) => item.kind === 'seam'),
        );
        if (targetIndex >= 0) {
          listRef.current?.scrollToIndex({ index: targetIndex, animated: false, viewPosition: 0.15 });
          return;
        }
      }
      scrollToEnd(false);
    }
  }, [messages.length, conversation.seam, conversation.totalMessages, items, scrollToEnd]);

  useEffect(() => {
    if (nearBottomRef.current) scrollToEnd(true);
  }, [conversation.totalMessages, conversation.provisionalText, conversation.delivery.length, scrollToEnd]);

  const onScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    const distance = contentSize.height - (contentOffset.y + layoutMeasurement.height);
    const near = distance < budgets.autofollowSlop;
    if (near !== nearBottomRef.current) {
      nearBottomRef.current = near;
      controller.setNearBottom(near);
    }
  };

  const onViewableItemsChanged = useRef(
    (info: { viewableItems: Array<{ item?: ConversationItem | null }> }) => {
      if (anchorTimer.current) return;
      const first = info.viewableItems.find((token) => token.item?.kind === 'message');
      if (!first || !first.item || first.item.kind !== 'message') return;
      const index = first.item.message.index;
      anchorTimer.current = setTimeout(() => {
        anchorTimer.current = null;
        if (index >= 0) controller.noteReadingAnchor(index);
      }, 1000);
    },
  ).current;

  const send = async () => {
    const text = draft.trim();
    if (!text) return;
    setComposerError(null);
    const result = await controller.send(text);
    if (!result.ok) {
      setComposerError(result.error ?? 'Could not send this message.');
      return;
    }
    setDraft('');
    controller.setNearBottom(true);
    nearBottomRef.current = true;
    scrollToEnd(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => undefined);
  };

  const stop = async () => {
    const result = await controller.stopTurn();
    if (!result.ok) setComposerError(result.error ?? 'Could not stop this turn.');
  };

  const working = conversation.execution.kind === 'working';
  const stopping = working && conversation.execution.label === 'Stopping…';
  const sendGate = controller.canSend();
  const disabledReason =
    connection.state !== 'current' && connection.state !== 'reconciling'
      ? 'Reconnect to send.'
      : !sendGate.ok
        ? sendGate.reason
        : undefined;
  const hasHistoricalTools = conversation.messages.some((message) => message.tool_data);
  const showDock =
    conversation.tools.length > 0 ||
    hasHistoricalTools ||
    working ||
    conversation.execution.kind === 'stopped' ||
    conversation.pendingSoftInterrupts > 0 ||
    conversation.plan !== null;
  const dockLabel = working
    ? conversation.execution.label
    : conversation.execution.kind === 'stopped'
      ? conversation.execution.label
      : conversation.tools.length > 0 || hasHistoricalTools
        ? 'View work'
        : 'Ready';

  const title = conversation.title || 'Session';
  const statusLabel =
    conversation.execution.kind === 'working'
      ? conversation.execution.label
      : conversation.execution.kind === 'ready'
        ? 'Ready'
        : conversation.execution.kind === 'stopped'
          ? conversation.execution.label
          : 'Status unavailable';

  const markSeamSeen = async () => {
    // The user explicitly acknowledged the boundary, so everything currently
    // committed from that point on counts as seen.
    await controller.markSeenThrough(conversation.totalMessages);
  };

  const renderItem = ({ item }: { item: ConversationItem }) => {
    if (item.kind === 'seam') {
      return (
        <SeamRow
          count={item.count}
          onSeen={() => void markSeamSeen()}
          onViewWork={() => {
            setWorkVisible(true);
            void controller.loadPlan();
          }}
        />
      );
    }
    if (item.kind === 'message' && item.key === 'older-loader') {
      return (
        <View style={styles.olderLoader}>
          {conversation.loadingOlder ? (
            <ActivityIndicator color={colors.muted} />
          ) : (
            <TextAction label="Load older messages" onPress={() => void controller.loadOlder()} align="center" />
          )}
        </View>
      );
    }
    if (item.kind === 'message') {
      const message = item.message;
      if (message.role === 'user') {
        return <UserMessage message={message} />;
      }
      if (message.role === 'assistant') {
        return <AssistantMessage message={message} showRole={item.roleStart} />;
      }
      return null;
    }
    if (item.kind === 'delivery') {
      return (
        <DeliveryRow
          record={item.record}
          onReview={() => setDecision(item.record)}
          onDismiss={() => void controller.dismissDelivery(item.record.clientMessageId)}
        />
      );
    }
    if (item.kind === 'provisional') {
      return (
        <View style={styles.assistantBlock}>
          <Text variant="caption" color="muted" style={{ marginBottom: space.xxs }}>
            jcode
          </Text>
          <Markdown content={conversation.provisionalText} />
        </View>
      );
    }
    return (
      <View style={[styles.errorRow, { borderColor: colors.error }]}>
        <Text variant="small" color="error" accessibilityLiveRegion="polite">
          {item.message}
        </Text>
      </View>
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.appBar}>
        <IconButton
          label="Back to sessions"
          onPress={() => {
            Keyboard.dismiss();
            controller.flushDraft();
            navigation.goBack();
          }}
        >
          {({ size, color }) => <BackIcon size={size} color={color} />}
        </IconButton>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Session: ${title}. Switch session`}
          onPress={() => setSwitcherVisible(true)}
          style={({ pressed }) => [styles.titleButton, pressed && { opacity: 0.7 }]}
        >
          <Text variant="body" weight="semibold" numberOfLines={1} style={{ maxWidth: 220 }}>
            {title}
          </Text>
          <ChevronDownIcon size={16} color={colors.muted} />
        </Pressable>
        <IconButton label="Session menu" onPress={() => setMenuVisible(true)}>
          {({ size, color }) => <MoreIcon size={size} color={color} />}
        </IconButton>
      </View>

      {conversation.interrupted ? (
        <View style={[styles.interrupted, { backgroundColor: colors.accentSoft }]}>
          <Text variant="small" style={{ color: colors.onAccent }}>
            The server session was interrupted. Saved history is below; continue only if the server
            offers a recovery path.
          </Text>
        </View>
      ) : null}

      {connection.state !== 'current' ? (
        <View style={[styles.connectionNotice, { backgroundColor: colors.raised }]} accessibilityLiveRegion="polite">
          <Text variant="small" color="muted" style={{ flex: 1 }}>
            {connection.state === 'reconnecting'
              ? `Reconnecting. Last checked at ${controller.formatChecked() || '—'}. Work continues on your server.`
              : connection.state === 'offline'
                ? `Offline. Last checked at ${controller.formatChecked() || '—'}. Saved history only.`
                : connection.state === 'pair_again'
                  ? 'This phone is no longer authorized. Cached content remains readable.'
                  : connection.state === 'incompatible'
                    ? 'This server needs mobile continuation support.'
                    : conversation.historyFreshness.status === 'cached'
                      ? 'Saved on this phone. Catching up…'
                      : 'Connecting…'}
          </Text>
          {connection.state === 'offline' || connection.state === 'reconnecting' ? (
            <TextAction label="Retry" onPress={() => void controller.reconnect()} />
          ) : null}
        </View>
      ) : null}

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={0}
      >
        <FlatList
          ref={listRef}
          data={items}
          keyExtractor={(item) => item.key}
          renderItem={renderItem}
          onScroll={onScroll}
          scrollEventThrottle={16}
          onScrollBeginDrag={() => {
            draggingRef.current = true;
          }}
          onScrollEndDrag={() => {
            draggingRef.current = false;
          }}
          onViewableItemsChanged={onViewableItemsChanged as never}
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
          }}
          viewabilityConfig={{ itemVisiblePercentThreshold: 40 }}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          contentContainerStyle={[
            styles.transcriptContent,
            { paddingHorizontal: geometry.gutterCompact, paddingBottom: space.xl },
          ]}
          ListHeaderComponent={
            <View style={styles.identity}>
              <Text variant="title" accessibilityRole="header">
                {title}
              </Text>
              <View style={styles.identityMeta}>
                {conversation.workingDir ? (
                  <>
                    <FolderIcon size={16} color={colors.muted} />
                    <Text
                      variant="caption"
                      color="muted"
                      numberOfLines={1}
                      style={{ marginLeft: space.xxs, marginRight: space.xs, flexShrink: 1 }}
                    >
                      {conversation.workingDir}
                    </Text>
                  </>
                ) : null}
                <View style={{ flex: 1 }} />
                <Text
                  variant="caption"
                  color={conversation.execution.kind === 'working' ? 'success' : 'muted'}
                  tabular
                >
                  {statusLabel}
                </Text>
              </View>
              {conversation.historyFreshness.status === 'cached' ? (
                <Text variant="caption" color="muted" style={{ marginTop: space.xs }}>
                  Showing saved history until the server catches up.
                </Text>
              ) : null}
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyTranscript}>
              <Text variant="body" color="muted" style={{ textAlign: 'center' }}>
                {conversation.historyFreshness.status === 'none'
                  ? 'This session isn’t saved on this phone yet.'
                  : 'No messages yet.'}
              </Text>
            </View>
          }
        />

        {conversation.hasNewActivity ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="New activity. Go to the latest unread boundary"
            onPress={() => {
              const index = Math.max(0, items.findIndex((item) => item.kind === 'seam'));
              if (index >= 0) listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.2 });
              else scrollToEnd(true);
              controller.setNearBottom(true);
            }}
            style={[styles.newActivity, { backgroundColor: colors.accentSoft }]}
          >
            <Text variant="small" style={{ color: colors.onAccent }}>
              New activity
            </Text>
            <ChevronDownIcon size={16} color={colors.onAccent} />
          </Pressable>
        ) : null}

        {showDock ? (
          <View style={[styles.workDock, { borderTopColor: colors.line }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${dockLabel}. Open session work`}
              onPress={() => {
                setWorkVisible(true);
                void controller.loadPlan();
              }}
              style={({ pressed }) => [styles.workDockText, pressed && { opacity: 0.7 }]}
            >
              {working ? (
                <WorkIcon size={20} color={colors.success} />
              ) : conversation.execution.kind === 'stopped' ? (
                <StopIcon size={18} color={colors.error} />
              ) : (
                <CheckIcon size={20} color={colors.muted} />
              )}
              <View style={{ flex: 1, marginLeft: space.xs }}>
                <Text variant="small" numberOfLines={2} color={working ? 'ink' : 'muted'}>
                  {dockLabel}
                </Text>
                {conversation.execution.phase && working ? (
                  <Text variant="caption" color="muted" numberOfLines={1}>
                    {conversation.execution.phase}
                  </Text>
                ) : null}
              </View>
              <ChevronRightIcon size={18} color={colors.muted} />
            </Pressable>
            {working ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Stop this turn"
                onPress={() => void stop()}
                disabled={stopping}
                style={({ pressed }) => [
                  styles.stopTarget,
                  pressed && { backgroundColor: colors.raised },
                  stopping && { opacity: 0.5 },
                ]}
              >
                <StopIcon size={20} color={colors.error} />
              </Pressable>
            ) : null}
          </View>
        ) : null}

        <View
          style={[
            styles.composer,
            {
              borderBottomColor: colors.bg,
              paddingBottom: Math.max(insets.bottom, space.xs),
            },
          ]}
        >
          <Text variant="small" color="muted" style={{ marginBottom: space.xxs }}>
            {working ? 'Add instruction' : 'Message'}
          </Text>
          <View
            style={[
              styles.composerField,
              {
                borderColor: colors.control,
                backgroundColor: colors.surface,
                minHeight: Math.max(geometry.composerMin, 44 + 16 * textScale),
              },
            ]}
          >
            <TextInput
              ref={inputRef}
              allowFontScaling={false}
              accessibilityLabel={working ? 'Add an instruction' : 'Message'}
              value={draft}
              onChangeText={(value) => {
                setDraft(value);
                if (conversation.sessionId) controller.setDraftText(conversation.sessionId, value);
                if (composerError) setComposerError(null);
              }}
              onBlur={() => controller.flushDraft()}
              placeholder={
                textScale > 1.35
                  ? working
                    ? 'Instruct…'
                    : 'Write…'
                  : working
                    ? 'A thought, a question, a direction…'
                    : 'Write a message'
              }
              placeholderTextColor={colors.muted}
              selectionColor={colors.focus}
              multiline
              maxLength={32_000}
              textAlignVertical="top"
              style={[
                styles.input,
                {
                  color: colors.ink,
                  fontSize: 16 * textScale,
                  lineHeight: 24 * textScale,
                  minHeight: 26 * textScale + 20,
                  maxHeight: (geometry.composerMax - 16) * Math.min(textScale, 1.7),
                },
              ]}
              onKeyPress={(event) => {
                const native = event.nativeEvent as unknown as { key?: string; modifiers?: string[] };
                if (native.key === 'Enter' && native.modifiers?.some((value) => value === 'meta' || value === 'ctrl')) {
                  void send();
                }
              }}
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={working ? 'Add instruction to this turn' : 'Send message'}
              accessibilityState={{ disabled: !!disabledReason || !draft.trim() }}
              disabled={!!disabledReason || !draft.trim()}
              onPress={() => void send()}
              style={({ pressed }) => [
                styles.sendTarget,
                {
                  backgroundColor:
                    !!disabledReason || !draft.trim() ? colors.raised : colors.brand,
                },
                pressed && { opacity: 0.85 },
              ]}
            >
              <SendIcon
                size={20}
                color={!!disabledReason || !draft.trim() ? colors.muted : colors.onBrand}
              />
            </Pressable>
          </View>
          <Text variant="caption" color="muted" style={{ marginTop: space.xxs }}>
            {composerError ??
              disabledReason ??
              (working
                ? `Your server runs the work.${conversation.pendingSoftInterrupts > 0 ? ` ${conversation.pendingSoftInterrupts} queued.` : ''}`
                : 'Your server runs the work.')}
          </Text>
        </View>
      </KeyboardAvoidingView>

      <WorkSheet
        visible={workVisible}
        onClose={() => setWorkVisible(false)}
        onStop={() => void stop()}
      />

      <SessionSwitcherSheet
        visible={switcherVisible}
        onClose={() => setSwitcherVisible(false)}
        onSelect={async (session) => {
          setSwitcherVisible(false);
          await controller.openSession(session);
          navigation.setParams({ sessionId: session.session_id });
        }}
        onAllSessions={() => {
          setSwitcherVisible(false);
          navigation.goBack();
        }}
      />

      <BottomSheet
        visible={menuVisible}
        onClose={() => setMenuVisible(false)}
        accessibilityLabel="Session menu"
      >
        <View style={{ paddingHorizontal: space.lg }}>
          <Text variant="title" accessibilityRole="header">
            Session
          </Text>
          <View style={{ marginTop: space.md }}>
            <MenuRow
              label="Rename"
              onPress={() => {
                setMenuVisible(false);
                setRenameValue(title);
                setRenameError(null);
                setRenameVisible(true);
              }}
            />
            <MenuRow
              label={conversation.session?.saved ? 'Remove from saved' : 'Save session'}
              onPress={async () => {
                setMenuVisible(false);
                if (!conversation.sessionId) return;
                await controller.setSessionSaved(
                  conversation.sessionId,
                  !conversation.session?.saved,
                  conversation.session?.save_label ?? null,
                );
              }}
            />
            <MenuRow
              label="Copy session ID"
              onPress={async () => {
                setMenuVisible(false);
                if (conversation.sessionId) {
                  await Clipboard.setStringAsync(conversation.sessionId).catch(() => undefined);
                }
              }}
            />
            <MenuRow
              label="Server details"
              onPress={() => {
                setMenuVisible(false);
                navigation.navigate('ServerDetails');
              }}
            />
            <MenuRow
              label="Archive session"
              onPress={async () => {
                setMenuVisible(false);
                if (conversation.session) {
                  const result = await controller.archiveSession(conversation.session);
                  if (result.ok) navigation.goBack();
                  else setComposerError(result.error ?? 'Archive failed.');
                }
              }}
            />
          </View>
          <View style={{ height: space.lg }} />
        </View>
      </BottomSheet>

      <BottomSheet
        visible={renameVisible}
        onClose={() => setRenameVisible(false)}
        accessibilityLabel="Rename session"
      >
        <View style={{ paddingHorizontal: space.lg }}>
          <Text variant="title" accessibilityRole="header">
            Rename session
          </Text>
          <Field
            label="Title"
            value={renameValue}
            onChangeText={setRenameValue}
            containerStyle={{ marginTop: space.md }}
            error={renameError ?? undefined}
            autoFocus
          />
          <Button
            label="Save title"
            fullWidth
            style={{ marginTop: space.md }}
            onPress={async () => {
              if (!conversation.sessionId) return;
              const result = await controller.renameSession(conversation.sessionId, renameValue.trim() || null);
              if (!result.ok) setRenameError(result.error ?? 'Rename failed.');
              else setRenameVisible(false);
            }}
          />
          <View style={{ height: space.lg }} />
        </View>
      </BottomSheet>

      <DeliveryDecisionSheet
        record={decision}
        onClose={() => setDecision(null)}
      />
    </View>
  );
}

function SeamRow({ count, onSeen, onViewWork }: { count: number | null; onSeen: () => void; onViewWork: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={styles.seamWrap}>
      <View style={styles.seamRuleRow}>
        <View style={[styles.seamRule, { backgroundColor: colors.accent }]} />
        <Text variant="small" weight="semibold" style={{ marginHorizontal: space.sm }}>
          Since you left
        </Text>
        <View style={[styles.seamRule, { backgroundColor: colors.accent }]} />
      </View>
      <View style={styles.seamBody}>
        <Text variant="caption" color="muted">
          {count !== null
            ? `${count} ${count === 1 ? 'update' : 'updates'}`
            : 'New activity since your last visit'}
        </Text>
        <View style={styles.seamActions}>
          <TextAction label="Mark seen" onPress={onSeen} />
          <TextAction label="View work" onPress={onViewWork} />
        </View>
      </View>
    </View>
  );
}

function UserMessage({ message }: { message: HistoryMessage }) {
  const { colors } = useTheme();
  return (
    <View
      style={styles.userRow}
      accessible
      accessibilityLabel={`You said: ${message.content}`}
    >
      <View style={[styles.userBubble, { backgroundColor: colors.raised }]}>
        <Text variant="caption" color="muted" style={{ marginBottom: space.xxs }}>
          You
        </Text>
        <Text variant="body">{message.content}</Text>
      </View>
    </View>
  );
}

const AssistantMessage = React.memo(function AssistantMessage({
  message,
  showRole,
}: {
  message: HistoryMessage;
  showRole: boolean;
}) {
  return (
    <View style={styles.assistantBlock} accessible accessibilityLabel={`jcode said: ${message.content}`}>
      {showRole ? (
        <Text variant="caption" color="muted" style={{ marginBottom: space.xxs }}>
          jcode
        </Text>
      ) : null}
      <Markdown content={message.content} />
    </View>
  );
});

function DeliveryRow({
  record,
  onReview,
  onDismiss,
}: {
  record: DeliveryRecord;
  onReview: () => void;
  onDismiss: () => void;
}) {
  const { colors } = useTheme();
  const uncertain = record.state === 'unconfirmed' || record.state === 'rejected';
  return (
    <View style={styles.userRow}>
      <View
        style={[
          styles.userBubble,
          {
            backgroundColor: uncertain ? colors.accentSoft : colors.raised,
            borderWidth: uncertain ? 1 : 0,
            borderColor: uncertain ? colors.accent : 'transparent',
          },
        ]}
      >
        <Text variant="caption" color="muted" style={{ marginBottom: space.xxs }}>
          {record.guidance ? 'Instruction' : 'You'}
        </Text>
        <Text variant="body">{record.content}</Text>
        <View style={styles.deliveryFooter}>
          <Text
            variant="caption"
            color={uncertain ? 'error' : record.state === 'added' ? 'success' : 'muted'}
            accessibilityLiveRegion="polite"
          >
            {DELIVERY_LABELS[record.state]}
          </Text>
          {uncertain ? (
            <View style={styles.deliveryActions}>
              <TextAction label="Review message" onPress={onReview} />
              <TextAction label="Dismiss" onPress={onDismiss} color="muted" />
            </View>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function DeliveryDecisionSheet({
  record,
  onClose,
}: {
  record: DeliveryRecord | null;
  onClose: () => void;
}) {
  const { colors } = useTheme();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    setBusy(false);
  }, [record]);
  if (!record) return null;
  return (
    <BottomSheet visible={!!record} onClose={onClose} accessibilityLabel="Delivery unconfirmed">
      <View style={{ paddingHorizontal: space.lg }}>
        <Text variant="title" accessibilityRole="header">
          Delivery unconfirmed
        </Text>
        <Text variant="body" color="muted" style={{ marginTop: space.xs }}>
          The connection was lost after this message was written. It may or may not have reached the
          server. Check the conversation before sending it again.
        </Text>
        <View style={[styles.decisionQuote, { backgroundColor: colors.raised }]}>
          <Text variant="body">{record.content}</Text>
        </View>
        {error ? (
          <Text variant="small" color="error" style={{ marginTop: space.sm }}>
            {error}
          </Text>
        ) : null}
        <Button
          label="Send again"
          fullWidth
          style={{ marginTop: space.md }}
          loading={busy}
          onPress={async () => {
            setBusy(true);
            const result = await controller.retryDelivery(record.clientMessageId);
            setBusy(false);
            if (!result.ok) setError(result.error ?? 'Could not send.');
            else onClose();
          }}
        />
        <Button
          label="Dismiss record"
          variant="secondary"
          fullWidth
          style={{ marginTop: space.xs }}
          onPress={async () => {
            await controller.dismissDelivery(record.clientMessageId);
            onClose();
          }}
        />
        <TextAction label="Close" onPress={onClose} align="center" />
        <View style={{ height: space.lg }} />
      </View>
    </BottomSheet>
  );
}

function MenuRow({ label, onPress }: { label: string; onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [styles.menuRow, { backgroundColor: pressed ? colors.raised : 'transparent' }]}
    >
      <Text variant="body">{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  appBar: {
    height: geometry.appBar,
    paddingHorizontal: space.xs,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  titleButton: {
    minHeight: target,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxs,
    flexShrink: 1,
    paddingHorizontal: space.xxs,
  },
  connectionNotice: {
    marginHorizontal: geometry.gutterCompact,
    marginBottom: space.xs,
    borderRadius: radius.control,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    flexDirection: 'row',
    alignItems: 'center',
  },
  interrupted: {
    marginHorizontal: geometry.gutterCompact,
    marginBottom: space.xs,
    borderRadius: radius.control,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
  },
  transcriptContent: { paddingTop: space.xs },
  identity: { paddingBottom: space.md },
  identityMeta: { flexDirection: 'row', alignItems: 'center', marginTop: space.xs, gap: 2 },
  assistantBlock: { marginTop: space.md },
  userRow: { alignItems: 'flex-end', marginTop: space.md },
  userBubble: {
    maxWidth: '86%',
    borderRadius: radius.control,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
  },
  deliveryFooter: { marginTop: space.xs, alignItems: 'flex-end' },
  deliveryActions: { flexDirection: 'row', marginTop: space.xxs, gap: space.xs },
  seamWrap: { marginTop: space.lg, marginBottom: space.xs, paddingVertical: space.xxs },
  seamRuleRow: { flexDirection: 'row', alignItems: 'center' },
  seamRule: { flex: 1, height: StyleSheet.hairlineWidth },
  seamBody: { paddingLeft: space.xxs, paddingTop: space.xxs },
  seamActions: { flexDirection: 'row', gap: space.md, marginTop: space.xxs },
  olderLoader: { paddingVertical: space.md, alignItems: 'center' },
  errorRow: {
    borderWidth: 1,
    borderRadius: radius.control,
    padding: space.sm,
    marginTop: space.sm,
  },
  emptyTranscript: { paddingVertical: space.xxl, alignItems: 'center' },
  newActivity: {
    alignSelf: 'center',
    minHeight: 36,
    borderRadius: 18,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxs,
    marginBottom: space.xs,
  },
  workDock: {
    minHeight: geometry.workDock,
    borderTopWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'stretch',
    paddingLeft: geometry.gutterCompact,
  },
  workDockText: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: geometry.workDock,
    gap: space.xxs,
  },
  stopTarget: {
    width: target,
    minHeight: geometry.workDock,
    alignItems: 'center',
    justifyContent: 'center',
  },
  composer: {
    paddingHorizontal: geometry.gutterCompact,
    paddingTop: space.xs,
  },
  composerField: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    borderRadius: radius.control,
    borderWidth: 1,
    paddingLeft: space.sm,
    paddingRight: space.xxs,
    paddingVertical: space.xxs,
    minHeight: geometry.composerMin,
  },
  input: {
    flex: 1,
    minHeight: 40,
    paddingTop: Platform.OS === 'ios' ? 8 : 6,
    paddingBottom: Platform.OS === 'ios' ? 8 : 6,
    includeFontPadding: false,
  },
  sendTarget: {
    width: target,
    height: target,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuRow: { minHeight: target, justifyContent: 'center' },
  decisionQuote: {
    borderRadius: radius.control,
    padding: space.sm,
    marginTop: space.md,
  },
});
