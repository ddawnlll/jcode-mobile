import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Divider, IconButton, TextAction } from '../../design/controls';
import { BackIcon, FolderIcon } from '../../design/icons';
import { useTheme } from '../../design/theme';
import { space, target } from '../../design/tokens';
import { Text } from '../../design/typography';
import { controller } from '../../core/app-controller';
import { basename } from '../../core/session/selectors';
import { useAppStore, type ProjectRecord } from '../../core/state/store';
import type { SessionInfo } from '../../core/protocol/frames';
import { DirectoryBrowser } from '../newSession/DirectoryBrowser';
import type { RootStackParamList } from '../../shell/navigation';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation as useTypedNavigation } from '@react-navigation/native';

export function ProjectsScreen() {
  const typedNavigation = useTypedNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();
  const sessions = useAppStore((state) => state.inventory.sessions);
  const stored = useAppStore((state) => state.inventory.projects);
  const serverId = useAppStore((state) => state.profileId);
  const [browserVisible, setBrowserVisible] = useState(false);
  const [query, setQuery] = useState('');
  const [startingPath, setStartingPath] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const projects = useMemo(() => {
    const map = new Map<string, ProjectRecord>();
    if (!serverId) return [];
    for (const project of stored) {
      if (project.serverId !== serverId) continue;
      map.set(`${project.serverId}:${project.path}`, project);
    }
    for (const session of sessions) {
      if (!session.working_dir) continue;
      const key = `${serverId}:${session.working_dir}`;
      if (map.has(key)) continue;
      map.set(key, {
        id: `derived-${session.working_dir}`,
        serverId,
        path: session.working_dir,
        name: basename(session.working_dir),
        pinned: false,
        addedAt: 0,
        lastUsedAt: session.updated_at_ms ?? 0,
      });
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return b.lastUsedAt - a.lastUsedAt;
    });
  }, [serverId, sessions, stored]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return projects;
    return projects.filter(
      (project) =>
        project.name.toLowerCase().includes(needle) ||
        project.path.toLowerCase().includes(needle),
    );
  }, [projects, query]);

  const addProject = async (path: string) => {
    if (!serverId) {
      setError('No server is selected.');
      return;
    }
    const name = basename(path);
    const now = Date.now();
    const next = [
      ...stored.filter((entry) => !(entry.serverId === serverId && entry.path === path)),
      {
        id: `project-${path}`,
        serverId,
        path,
        name,
        pinned: false,
        addedAt: now,
        lastUsedAt: now,
      },
    ];
    await controller.saveProjects(next);
    setBrowserVisible(false);
    setError(null);
  };

  const startHere = async (path: string) => {
    if (!serverId) {
      setError('No server is selected.');
      return;
    }
    setError(null);
    setStartingPath(path);
    const profileIdAtStart = serverId;
    const result = await controller.createSession(path, '');
    setStartingPath(null);
    // Profile changed before create returned: do not navigate into the new
    // profile with an intent that belonged to the old one.
    if ((useAppStore.getState().profileId ?? null) !== profileIdAtStart) return;
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await controller.rememberFolder(path);
    if ((useAppStore.getState().profileId ?? null) !== profileIdAtStart) return;
    typedNavigation.navigate('Conversation', { sessionId: result.sessionId });
  };

  const restoreExact = async (session: SessionInfo) => {
    if (!serverId) {
      setRestoreError('No server is selected.');
      return;
    }
    setRestoreError(null);
    const profileIdAtStart = serverId;
    // Exact restore: open regardless of whether the target is present in the
    // current inventory page. Controller handles scoped recovery when missing.
    await controller.openSession(session);
    if ((useAppStore.getState().profileId ?? null) !== profileIdAtStart) return;
    const conversation = useAppStore.getState().conversation;
    if (conversation.lastError) {
      setRestoreError(conversation.lastError);
      return;
    }
    typedNavigation.navigate('Conversation', { sessionId: session.session_id });
  };

  useEffect(() => {
    if (stored.length === 0 && projects.length > 0) {
      void controller.saveProjects(projects);
    }
  }, [projects, stored.length]);

  const togglePin = (project: ProjectRecord) => {
    void controller.saveProjects(
      projects.map((entry) =>
        entry.serverId === project.serverId && entry.path === project.path
          ? { ...entry, pinned: !entry.pinned }
          : entry,
      ),
    );
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg, paddingTop: insets.top }]} testID="projects-screen">
      <View style={styles.appBar}>
        <IconButton label="Back" onPress={() => typedNavigation.goBack()}>
          {({ size, color }) => <BackIcon size={size} color={color} />}
        </IconButton>
        <Text variant="body" weight="semibold">
          Projects
        </Text>
        <View style={{ width: target }} />
      </View>
      <ScrollView contentContainerStyle={{ paddingBottom: insets.bottom + space.xxl }}>
        <View style={styles.header}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
            <Text variant="title" accessibilityRole="header">
              Projects
            </Text>
            <TextAction label="Add project" onPress={() => setBrowserVisible(true)} color="brand" />
          </View>
          <Text variant="small" color="muted" style={{ marginTop: space.xxs }}>
            Canonical folders on this server. Pinning is local to this phone.
          </Text>
          {projects.length > 0 ? (
            <TextInput
              accessibilityLabel="Search projects"
              value={query}
              onChangeText={setQuery}
              placeholder="Search projects"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              style={[styles.search, { borderColor: colors.control, color: colors.ink }]}
            />
          ) : null}
          {error ? (
            <Text variant="small" color="error" style={{ marginTop: space.sm }}>
              {error}
            </Text>
          ) : null}
          {restoreError ? (
            <Text variant="small" color="error" style={{ marginTop: space.sm }} accessibilityLiveRegion="polite">
              {restoreError} Saved history is kept for this server; the session could not be opened.
            </Text>
          ) : null}
        </View>
        <Divider />
        {projects.length === 0 ? (
          <View style={styles.empty}>
            <Text variant="body" color="muted">
              No projects yet. Add a folder on your server to start sessions there.
            </Text>
            <Button
              label="Add project"
              onPress={() => setBrowserVisible(true)}
              style={{ marginTop: space.md }}
            />
          </View>
        ) : filtered.length === 0 ? (
          <Text variant="small" color="muted" style={{ padding: space.lg }}>
            No project matches “{query}”.
          </Text>
        ) : (
          filtered.map((project) => {
            const projectSessions = sessions.filter((session) => session.working_dir === project.path);
            const count = projectSessions.length;
            const latest = projectSessions[0];
            return (
              <View key={`${project.serverId}:${project.path}`} style={styles.project}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${project.name}, ${count} sessions`}
                  onPress={() => {
                    if (latest) {
                      void restoreExact(latest);
                    } else {
                      typedNavigation.navigate('Sessions', { scope: project.path });
                    }
                  }}
                  style={styles.projectRow}
                  testID={`project-${project.name}`}
                >
                  <FolderIcon size={22} color={colors.muted} />
                  <View style={{ flex: 1, marginLeft: space.sm }}>
                    <Text variant="subhead" numberOfLines={1}>
                      {project.name}
                    </Text>
                    <Text variant="code" color="muted" numberOfLines={1}>
                      {project.path}
                    </Text>
                    <Text variant="caption" color="muted">
                      {count} {count === 1 ? 'session' : 'sessions'}
                      {project.pinned ? ' · Pinned' : ''}
                    </Text>
                  </View>
                </Pressable>
                <View style={styles.projectActions}>
                  <TextAction
                    label={project.pinned ? 'Unpin' : 'Pin'}
                    onPress={() => togglePin(project)}
                    color={project.pinned ? 'muted' : 'brand'}
                  />
                  <TextAction
                    label={startingPath === project.path ? 'Starting…' : 'New session here'}
                    onPress={() => void startHere(project.path)}
                    color="brand"
                  />
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
      <DirectoryBrowser
        visible={browserVisible}
        initialPath={projects[0]?.path}
        onClose={() => setBrowserVisible(false)}
        onSelect={(path) => void addProject(path)}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  appBar: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.xs,
  },
  header: { paddingHorizontal: space.lg, paddingVertical: space.md },
  search: {
    minHeight: target,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: space.sm,
    marginTop: space.sm,
    fontSize: 16,
    fontFamily: 'HankenGrotesk-Regular',
  },
  empty: { padding: space.xl, alignItems: 'center' },
  project: {
    paddingHorizontal: space.lg,
    paddingVertical: space.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: 'rgba(127,127,127,0.25)',
  },
  projectRow: { flexDirection: 'row', alignItems: 'center', minHeight: target },
  projectActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: space.sm, marginTop: space.xs },
});
