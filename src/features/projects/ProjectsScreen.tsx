import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Divider, IconButton, TextAction } from '../../design/controls';
import { BackIcon, FolderIcon } from '../../design/icons';
import { useTheme } from '../../design/theme';
import { space, target } from '../../design/tokens';
import { Text } from '../../design/typography';
import { controller } from '../../core/app-controller';
import { basename } from '../../core/session/selectors';
import { useAppStore, type ProjectRecord } from '../../core/state/store';
import { NewSessionSheet } from '../newSession/NewSessionSheet';
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
  const [newFolder, setNewFolder] = useState<string | null>(null);

  const projects = useMemo(() => {
    const map = new Map<string, ProjectRecord>();
    for (const project of stored) map.set(project.path, project);
    for (const session of sessions) {
      if (!session.working_dir || map.has(session.working_dir)) continue;
      map.set(session.working_dir, {
        id: `derived-${session.working_dir}`,
        serverId: serverId ?? 'local',
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

  useEffect(() => {
    if (stored.length === 0 && projects.length > 0) {
      void controller.saveProjects(projects);
    }
  }, [projects, stored.length]);

  const togglePin = (project: ProjectRecord) => {
    void controller.saveProjects(
      projects.map((entry) =>
        entry.path === project.path ? { ...entry, pinned: !entry.pinned } : entry,
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
          <Text variant="title" accessibilityRole="header">
            Projects
          </Text>
          <Text variant="small" color="muted" style={{ marginTop: space.xxs }}>
            Canonical folders on this server. Pinning is local to this phone.
          </Text>
        </View>
        <Divider />
        {projects.length === 0 ? (
          <View style={styles.empty}>
            <Text variant="body" color="muted">
              No projects yet. Start a session with a server folder.
            </Text>
            <Button
              label="New session"
              onPress={() => setNewFolder('')}
              style={{ marginTop: space.md }}
            />
          </View>
        ) : (
          projects.map((project) => {
            const count = sessions.filter((session) => session.working_dir === project.path).length;
            return (
              <View key={project.path} style={styles.project}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`${project.name}, ${count} sessions`}
                  onPress={() => typedNavigation.navigate('Sessions', { scope: project.path })}
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
                    label="New session here"
                    onPress={() => setNewFolder(project.path)}
                  />
                </View>
              </View>
            );
          })
        )}
      </ScrollView>
      <NewSessionSheet
        visible={newFolder !== null}
        initialFolder={newFolder ?? undefined}
        onClose={() => setNewFolder(null)}
        onStarted={(sessionId) => {
          setNewFolder(null);
          typedNavigation.navigate('Conversation', { sessionId });
        }}
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
