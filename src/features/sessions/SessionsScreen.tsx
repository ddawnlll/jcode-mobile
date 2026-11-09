import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Pressable,
  RefreshControl,
  ScrollView,
  SectionList,
  StyleSheet,
  View,
} from 'react-native';
import { useFocusEffect, useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Haptics from 'expo-haptics';
import * as Clipboard from 'expo-clipboard';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import type { RootStackParamList } from '../../shell/navigation';
import { BottomSheet } from '../../design/BottomSheet';
import { Button, Divider, Field, IconButton, Row, TextAction } from '../../design/controls';
import {
  ChevronDownIcon,
  ChevronRightIcon,
  JCodeMark,
  LinkIcon,
  MoreIcon,
  SearchIcon,
  CloseIcon,
} from '../../design/icons';
import { useTheme } from '../../design/theme';
import { geometry, radius, space, target } from '../../design/tokens';
import { Text } from '../../design/typography';
import { controller } from '../../core/app-controller';
import { basename, formatTime, groupSessions } from '../../core/session/selectors';
import { useAppStore } from '../../core/state/store';
import type { SessionInfo } from '../../core/protocol/frames';
import { NewSessionSheet } from '../newSession/NewSessionSheet';

type Nav = NativeStackNavigationProp<RootStackParamList, 'Sessions'>;
type Route = RouteProp<RootStackParamList, 'Sessions'>;

export function SessionsScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<Route>();
  const insets = useSafeAreaInsets();
  const { colors, typeStyle } = useTheme();
  const sessions = useAppStore((state) => state.inventory.sessions);
  const loading = useAppStore((state) => state.inventory.loading);
  const error = useAppStore((state) => state.inventory.error);
  const partial = useAppStore((state) => state.inventory.partial);
  const fetchedAt = useAppStore((state) => state.inventory.fetchedAt);
  const includeArchived = useAppStore((state) => state.inventory.includeArchived);
  const pendingRestore = useAppStore((state) => state.inventory.pendingRestore);
  const pinnedSessionIds = useAppStore((state) => state.inventory.pinnedSessionIds);
  const projects = useAppStore((state) => state.inventory.projects);
  const demo = useAppStore((state) => state.demo);
  const connection = useAppStore((state) => state.connection);
  const serverLabel = useAppStore((state) => state.connection.serverLabel);
  const [search, setSearch] = useState('');
  const [scope, setScope] = useState<string | null>(null);
  const [appMenuVisible, setAppMenuVisible] = useState(false);
  const [actionSession, setActionSession] = useState<SessionInfo | null>(null);
  const [newSessionVisible, setNewSessionVisible] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const restored = useRef(false);
  const headingSize = useMemo(() => typeStyle(sessions.length === 0 ? 'screen' : 'display'), [typeStyle, sessions.length]);

  useEffect(() => {
    if (route.params?.scope) setScope(route.params.scope);
  }, [route.params?.scope]);

  useFocusEffect(
    useCallback(() => {
      controller.startInventoryPolling();
      void controller.refreshSessions();
      return () => controller.stopInventoryPolling();
    }, []),
  );

  useEffect(() => {
    if (restored.current) return;
    if (sessions.length === 0) return;
    restored.current = true;
    const open = async () => {
      const state = useAppStore.getState();
      // A labelled preview always starts on the list. An in-progress creation
      // owns the conversation state until its sheet explicitly confirms.
      if (state.demo || newSessionVisible) return;
      if (state.conversation.sessionId) {
        const exists = sessions.some((session) => session.session_id === state.conversation.sessionId);
        if (exists) {
          navigation.navigate('Conversation', { sessionId: state.conversation.sessionId });
        }
        return;
      }
      const intent = await controller.restoreIntent();
      if (!intent) return;
      const target = sessions.find((session) => session.session_id === intent);
      if (!target) return;
      await controller.openSession(target);
      navigation.navigate('Conversation', { sessionId: target.session_id });
    };
    void open();
  }, [newSessionVisible, sessions, navigation]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    const scoped = scope ? sessions.filter((session) => session.working_dir === scope) : sessions;
    if (!query) return scoped;
    return scoped.filter((session) => {
      const haystack = [
        session.title ?? '',
        session.save_label ?? '',
        session.working_dir ?? '',
        basename(session.working_dir),
      ]
        .join(' ')
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [scope, sessions, search]);

  const groups = useMemo(
    () => {
      const pinned = filtered.filter((session) => pinnedSessionIds.includes(session.session_id));
      const rest = filtered.filter((session) => !pinnedSessionIds.includes(session.session_id));
      const derived: Array<{ key: string; title: string; data: SessionInfo[] }> = groupSessions(
        rest,
      ).map((group) => ({ title: group.title, key: group.key, data: group.sessions }));
      return [
        ...(pinned.length ? [{ key: 'pinned', title: 'Pinned', data: pinned }] : []),
        ...derived,
      ];
    },
    [filtered, pinnedSessionIds],
  );

  const scopes = useMemo(() => {
    const paths = new Set<string>();
    for (const session of sessions) if (session.working_dir) paths.add(session.working_dir);
    for (const project of projects) paths.add(project.path);
    return Array.from(paths)
      .map((path) => ({
        path,
        name: projects.find((project) => project.path === path)?.name ?? basename(path),
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
      .slice(0, 12);
  }, [projects, sessions]);

  const openSession = (session: SessionInfo) => {
    // Show the cached route immediately; attachment reconciles inside it.
    navigation.navigate('Conversation', { sessionId: session.session_id });
    void Haptics.selectionAsync().catch(() => undefined);
    void controller.openSession(session);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await controller.refreshSessions({ force: true });
    setRefreshing(false);
  };

  const connectionLabel =
    connection.state === 'current'
      ? serverLabel
      : connection.state === 'reconnecting'
        ? 'Reconnecting'
        : connection.state === 'connecting'
          ? 'Connecting'
          : connection.state === 'offline'
            ? 'Offline'
            : connection.state === 'pair_again'
              ? 'Pair again'
              : 'Saved on this phone';

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg, paddingTop: insets.top }]}>
      <View style={styles.appBar}>
        <View style={styles.brand}>
          <JCodeMark size={22} />
          <Text variant="subhead" style={{ marginLeft: space.xs }}>
            jcode
          </Text>
        </View>
        <View style={styles.appBarActions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Server: ${connectionLabel}. Open server details`}
            onPress={() => navigation.navigate('ServerDetails')}
            style={({ pressed }) => [styles.serverSelector, pressed && { opacity: 0.7 }]}
          >
            <LinkIcon size={18} color={connection.state === 'current' ? colors.success : colors.muted} />
            <Text
              variant="small"
              color={connection.state === 'current' ? 'ink' : 'muted'}
              numberOfLines={1}
              style={{ marginLeft: space.xxs, maxWidth: 120 }}
            >
              {connectionLabel}
            </Text>
            <ChevronDownIcon size={16} color={colors.muted} />
          </Pressable>
          <IconButton label="App menu" onPress={() => setAppMenuVisible(true)} testID="sessions-menu">
            {({ size, color }) => <MoreIcon size={size} color={color} />}
          </IconButton>
        </View>
      </View>

      {demo ? (
        <View style={[styles.previewBanner, { backgroundColor: colors.accentSoft }]} testID="preview-banner">
          <Text variant="caption" style={{ color: colors.onAccent, flex: 1 }}>
            Preview · sample data. Nothing runs.
          </Text>
          <TextAction
            label="Exit preview"
            color="onAccent"
            onPress={() => {
              controller.exitDemo();
              navigation.reset({ index: 0, routes: [{ name: 'Welcome' }] });
            }}
          />
        </View>
      ) : null}

      <View style={styles.pageHeader}>
        <Text variant="display" style={[headingSize, { color: colors.ink }]} accessibilityRole="header">
          Your sessions
        </Text>
      </View>

      {connection.state !== 'current' ? (
        <View
          style={[styles.connectionRow, { backgroundColor: colors.raised }]}
          accessibilityLiveRegion="polite"
        >
          <Text variant="small" color="muted" style={{ flex: 1 }}>
            {connection.state === 'offline'
              ? `Offline. Last checked at ${controller.formatChecked() || '—'}.`
              : connection.state === 'pair_again'
                ? 'This phone is no longer authorized. Pair again in server details.'
                : connection.state === 'reconnecting'
                  ? `Reconnecting. Last checked at ${controller.formatChecked() || '—'}.`
                  : connection.state === 'incompatible'
                    ? 'This server needs mobile continuation support.'
                    : 'Saved on this phone. Reconnecting…'}
          </Text>
          {connection.state === 'offline' ? (
            <TextAction
              label="Retry now"
              testID="sessions-retry"
              onPress={() => void controller.reconnect()}
            />
          ) : connection.state === 'pair_again' ? (
            <TextAction
              label="Pair again"
              onPress={() => navigation.navigate('ServerDetails')}
            />
          ) : null}
        </View>
      ) : null}

      <ScrollView
        horizontal
        style={styles.scopeScroll}
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scopeRow}
        testID="project-scope"
      >
        <ScopeChip
          label="All projects"
          selected={scope === null}
          onPress={() => setScope(null)}
        />
        {scopes.map((item) => (
          <ScopeChip
            key={item.path}
            label={item.name}
            selected={scope === item.path}
            onPress={() => setScope(scope === item.path ? null : item.path)}
          />
        ))}
        <TextAction
          label="Projects"
          onPress={() => navigation.navigate('Projects' as never)}
          align="center"
        />
      </ScrollView>

      <View style={styles.searchWrap}>
        <Field
          label="Search sessions"
          placeholder="Title, label, or folder"
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          leading={<SearchIcon size={20} color={colors.muted} />}
          trailing={
            search ? (
              <IconButton label="Clear search" onPress={() => setSearch('')} size={18}>
                {({ size, color }) => <CloseIcon size={size} color={color} />}
              </IconButton>
            ) : null
          }
        />
      </View>

      {error && sessions.length === 0 ? (
        <View style={styles.center}>
          <Text variant="subhead">Can’t reach {serverLabel || 'your server'}.</Text>
          <Text variant="body" color="muted" style={{ marginTop: space.xs, textAlign: 'center' }}>
            {error}
          </Text>
          <Button label="Retry" onPress={() => void controller.reconnect()} style={{ marginTop: space.md }} />
          <TextAction label="Connection details" onPress={() => navigation.navigate('ServerDetails')} />
        </View>
      ) : loading && sessions.length === 0 ? (
        <View style={styles.skeletons}>
          {[0, 1, 2].map((index) => (
            <View key={index} style={[styles.skeleton, { backgroundColor: colors.raised }]} />
          ))}
        </View>
      ) : sessions.length === 0 ? (
        <View style={styles.center}>
          <Text variant="subhead" style={{ textAlign: 'center' }}>
            Start with one session.
          </Text>
          <Text variant="body" color="muted" style={{ marginTop: space.xs, textAlign: 'center' }}>
            Choose a folder on your server and tell JCode what you want to do.
          </Text>
          <Button label="New session" onPress={() => setNewSessionVisible(true)} style={{ marginTop: space.md }} />
        </View>
      ) : filtered.length === 0 ? (
        <View style={styles.center}>
          <Text variant="subhead">No matching sessions.</Text>
          <TextAction label="Clear search" onPress={() => setSearch('')} align="center" />
        </View>
      ) : (
        <SectionList
          style={{ flex: 1 }}
          sections={groups}
          keyExtractor={(item) => item.session_id}
          stickySectionHeadersEnabled={false}
          contentContainerStyle={{ paddingBottom: 96 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.muted}
              colors={[colors.brand]}
            />
          }
          renderSectionHeader={({ section }) => (
            <Text variant="small" color="muted" style={styles.groupHeading}>
              {section.title}
            </Text>
          )}
          renderItem={({ item, index, section }) => (
            <SessionRow
              session={item}
              live={connection.state === 'current'}
              first={index === 0}
              last={index === section.data.length - 1}
              onPress={() => openSession(item)}
              onLongPress={() => setActionSession(item)}
            />
          )}
          ListFooterComponent={
            <View style={styles.loadMore}>
              {partial || sessions.length >= 50 ? (
                <TextAction
                  label="Load more sessions"
                  onPress={() => controller.loadMoreSessions()}
                  align="center"
                />
              ) : null}
              <TextAction
                label={includeArchived ? 'Hide archived sessions' : 'Show archived sessions'}
                onPress={() =>
                  controller.refreshSessions({ force: true, includeArchived: !includeArchived })
                }
                align="center"
              />
              {fetchedAt ? (
                <Text variant="caption" color="muted">
                  Loaded {sessions.length}. Fetched {formatTime(fetchedAt)}.
                </Text>
              ) : null}
            </View>
          }
        />
      )}

      {pendingRestore ? (
        <View style={[styles.restoreNotice, { backgroundColor: colors.raised }]}>
          <Text variant="small" color="muted" style={{ flex: 1 }} numberOfLines={2}>
            Session archived.
          </Text>
          <TextAction
            label="Undo"
            onPress={() => {
              void controller.restoreSession(pendingRestore.session);
            }}
          />
        </View>
      ) : null}

      <View style={[styles.dock, { backgroundColor: colors.bg, paddingBottom: Math.max(insets.bottom, space.sm) }]}>
        <Button
          label="New session"
          onPress={() => setNewSessionVisible(true)}
          fullWidth
          testID="sessions-new"
          accessibilityHint="Choose a server folder and start a session"
        />
      </View>

      <NewSessionSheet
        visible={newSessionVisible}
        onClose={() => setNewSessionVisible(false)}
        onStarted={(sessionId) => {
          setNewSessionVisible(false);
          navigation.navigate('Conversation', { sessionId });
        }}
      />

      <BottomSheet
        visible={appMenuVisible}
        onClose={() => setAppMenuVisible(false)}
        accessibilityLabel="App menu"
      >
        <View style={{ paddingHorizontal: space.lg }} testID="app-menu">
          <Text variant="title" accessibilityRole="header">
            Commands
          </Text>
          <Text variant="small" color="muted" style={{ marginTop: space.xxs }}>
            {serverLabel || 'This server'}
          </Text>
          <View style={{ marginTop: space.md }}>
            <ActionRow
              label="New session"
              onPress={() => {
                setAppMenuVisible(false);
                setNewSessionVisible(true);
              }}
            />
            <ActionRow
              label="Projects"
              onPress={() => {
                setAppMenuVisible(false);
                navigation.navigate('Projects' as never);
              }}
            />
            <ActionRow
              label={includeArchived ? 'Hide archived sessions' : 'Archived sessions'}
              onPress={() => {
                setAppMenuVisible(false);
                void controller.refreshSessions({ force: true, includeArchived: !includeArchived });
              }}
            />
            <ActionRow
              label="Appearance"
              onPress={() => {
                setAppMenuVisible(false);
                navigation.navigate('Appearance');
              }}
            />
            <ActionRow
              label="Server details"
              onPress={() => {
                setAppMenuVisible(false);
                navigation.navigate('ServerDetails');
              }}
            />
            <ActionRow
              label="Connect another server"
              onPress={() => {
                setAppMenuVisible(false);
                navigation.navigate('Connect');
              }}
            />
          </View>
          <View style={{ height: space.lg }} />
        </View>
      </BottomSheet>

      <SessionActionsSheet
        session={actionSession}
        onClose={() => setActionSession(null)}
        onArchived={(session) => {
          setActionSession(null);
          void controller.archiveSession(session);
        }}
        onRestored={(session) => {
          setActionSession(null);
          void controller.restoreSession(session);
        }}
        onOpen={(session) => {
          setActionSession(null);
          void openSession(session);
        }}
      />
    </View>
  );
}

function ScopeChip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected, checked: selected }}
      aria-checked={selected}
      accessibilityLabel={`Project ${label}`}
      onPress={onPress}
      style={[
        styles.scopeChip,
        {
          borderColor: selected ? colors.brand : colors.line,
          backgroundColor: selected ? colors.raised : 'transparent',
        },
      ]}
      testID={`scope-${label}`}
    >
      <Text variant="caption" weight={selected ? 'semibold' : 'medium'}>
        {label}
      </Text>
    </Pressable>
  );
}

const SessionRow = React.memo(function SessionRow({
  session,
  live,
  first,
  last,
  onPress,
  onLongPress,
}: {
  session: SessionInfo;
  live: boolean;
  first: boolean;
  last: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const { colors } = useTheme();
  const directory = basename(session.working_dir);
  const status = session.archived
    ? 'Archived'
    : !live
      ? 'Saved'
      : session.live_state === 'working'
        ? 'Working'
        : session.live_state === 'ready'
          ? 'Ready'
          : session.user_connected
            ? 'Open elsewhere'
            : null;
  const time = formatTime(session.updated_at_ms);
  return (
    <View style={{ paddingHorizontal: geometry.gutterCompact }}>
      {!first ? null : null}
      <Row
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityLabel={[session.title ?? 'Untitled session', directory, status, time]
          .filter(Boolean)
          .join(', ')}
        accessibilityHint="Opens this session"
        style={styles.row}
        testID={`session-${session.session_id}`}
      >
        <View style={{ flex: 1 }}>
          <Text variant="subhead" numberOfLines={2}>
            {session.title?.trim() || session.save_label || 'Untitled session'}
          </Text>
          <View style={styles.metaRow}>
            {directory ? (
              <Text variant="caption" color="muted" numberOfLines={1} style={{ flexShrink: 1 }}>
                {directory}
              </Text>
            ) : null}
            {directory && status ? <Text variant="caption" color="muted"> · </Text> : null}
            {status ? (
              <Text variant="caption" color={live && session.live_state === 'working' ? 'success' : 'muted'}>
                {status}
              </Text>
            ) : null}
          </View>
        </View>
        <View style={styles.rowTrailing}>
          <Text variant="caption" color="muted" tabular>
            {time}
          </Text>
          <ChevronRightIcon size={18} color={colors.control} />
        </View>
      </Row>
      {!last ? <Divider inset={0} /> : null}
    </View>
  );
});

function SessionActionsSheet({
  session,
  onClose,
  onArchived,
  onRestored,
  onOpen,
}: {
  session: SessionInfo | null;
  onClose: () => void;
  onArchived: (session: SessionInfo) => void;
  onRestored: (session: SessionInfo) => void;
  onOpen: (session: SessionInfo) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const pinned = useAppStore((state) => state.inventory.pinnedSessionIds);
  const headingRef = useRef<React.ComponentRef<typeof View> | null>(null);

  useEffect(() => {
    if (session) {
      setCopied(false);
      setError(null);
    }
  }, [session]);

  if (!session) return null;
  return (
    <BottomSheet visible={!!session} onClose={onClose} headingRef={headingRef} accessibilityLabel="Session actions">
      <View style={{ paddingHorizontal: space.lg }}>
        <View ref={headingRef} collapsable={false}>
          <Text variant="title" numberOfLines={2} accessibilityRole="header">
            {session.title?.trim() || 'Session'}
          </Text>
        </View>
        <Text variant="small" color="muted" style={{ marginTop: space.xxs }} numberOfLines={1}>
          {session.working_dir ?? ''}
        </Text>
        {error ? (
          <Text variant="small" color="error" style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <View style={{ marginTop: space.md }}>
          <ActionRow label="Open session" onPress={() => onOpen(session)} />
          <ActionRow
            label={pinned.includes(session.session_id) ? 'Unpin session' : 'Pin session'}
            detail="Keeps it at the top of this list"
            onPress={() => {
              void controller.togglePinnedSession(session.session_id);
              onClose();
            }}
          />
          <ActionRow
            label="Copy session ID"
            onPress={async () => {
              try {
                await Clipboard.setStringAsync(session.session_id);
                setCopied(true);
              } catch {
                setError('Could not copy the session ID.');
              }
            }}
            detail={copied ? 'Copied' : session.session_id.slice(0, 18) + '…'}
          />
          <ActionRow
            label={session.archived ? 'Restore session' : 'Archive session'}
            detail={
              session.archived
                ? 'Reversible'
                : session.live_state === 'working'
                  ? 'Running turn'
                  : undefined
            }
            onPress={() => {
              if (session.archived) {
                onRestored(session);
                return;
              }
              if (session.live_state === 'working') {
                setError('Stop or wait for this turn before archiving.');
                return;
              }
              onArchived(session);
            }}
            destructive={false}
          />
        </View>
        <View style={styles.sheetFooter}>
          <Button label="Close" onPress={onClose} variant="secondary" fullWidth />
        </View>
      </View>
    </BottomSheet>
  );
}

function ActionRow({
  label,
  detail,
  onPress,
  destructive,
}: {
  label: string;
  detail?: string;
  onPress: () => void;
  destructive?: boolean;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => [
        styles.actionRow,
        { backgroundColor: pressed ? colors.raised : 'transparent' },
      ]}
    >
      <Text variant="body" color={destructive ? 'error' : 'ink'}>
        {label}
      </Text>
      {detail ? (
        <Text variant="caption" color="muted" numberOfLines={1} style={{ marginLeft: space.sm, flexShrink: 1 }}>
          {detail}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  appBar: {
    height: geometry.appBar,
    paddingHorizontal: geometry.gutterCompact,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  brand: { flexDirection: 'row', alignItems: 'center' },
  appBarActions: { flexDirection: 'row', alignItems: 'center' },
  previewBanner: {
    marginHorizontal: geometry.gutterCompact,
    marginBottom: space.xs,
    borderRadius: radius.control,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  scopeRow: {
    paddingHorizontal: geometry.gutterCompact,
    gap: space.xs,
    alignItems: 'center',
    paddingBottom: space.sm,
  },
  scopeScroll: { flexGrow: 0, flexShrink: 0, maxHeight: 64 },
  scopeChip: {
    minHeight: target,
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  serverSelector: {
    minHeight: target,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xxs,
    paddingLeft: space.xs,
  },
  pageHeader: { paddingHorizontal: geometry.gutterCompact, paddingBottom: space.md },
  connectionRow: {
    marginHorizontal: geometry.gutterCompact,
    marginBottom: space.sm,
    borderRadius: radius.control,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchWrap: { paddingHorizontal: geometry.gutterCompact, marginBottom: space.sm },
  groupHeading: {
    paddingHorizontal: geometry.gutterCompact,
    paddingTop: space.md,
    paddingBottom: space.xs,
  },
  row: {
    minHeight: geometry.sessionRowMin,
    paddingVertical: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  metaRow: { flexDirection: 'row', alignItems: 'center', marginTop: space.xxs, flexWrap: 'wrap' },
  rowTrailing: { alignItems: 'flex-end', gap: space.xs, minWidth: 56 },
  skeletons: { paddingHorizontal: geometry.gutterCompact, gap: space.sm, marginTop: space.lg },
  skeleton: { height: geometry.sessionRowMin, borderRadius: radius.control, opacity: 0.7 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: space.xl, paddingBottom: 80 },
  dock: {
    paddingHorizontal: geometry.gutterCompact,
    paddingTop: space.sm,
    backgroundColor: 'transparent',
  },
  loadMore: { paddingVertical: space.md, alignItems: 'center', gap: space.xs },
  restoreNotice: {
    marginHorizontal: geometry.gutterCompact,
    marginBottom: space.xs,
    borderRadius: radius.control,
    paddingHorizontal: space.sm,
    paddingVertical: space.xs,
    flexDirection: 'row',
    alignItems: 'center',
  },
  actionRow: {
    minHeight: target,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xs,
  },
  sheetFooter: { marginTop: space.md, marginBottom: space.lg },
});
