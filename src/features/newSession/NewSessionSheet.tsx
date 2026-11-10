import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BottomSheet } from '../../design/BottomSheet';
import { Button, Divider, Field, TextAction } from '../../design/controls';
import { ChevronRightIcon, FolderIcon } from '../../design/icons';
import { useTheme } from '../../design/theme';
import { radius, space, target } from '../../design/tokens';
import { Text } from '../../design/typography';
import { controller } from '../../core/app-controller';
import { useAppStore } from '../../core/state/store';
import { DirectoryBrowser } from './DirectoryBrowser';

/**
 * Create an empty session in one server folder, then open its composer.
 *
 * Model/effort and the first instruction belong to the conversation, not to
 * session creation: asking for them here made creation a multi-step
 * transaction that could lose the created session. Selecting the folder is
 * the only required input.
 */
export function NewSessionSheet({
  visible,
  onClose,
  onStarted,
  initialFolder,
}: {
  visible: boolean;
  onClose: () => void;
  onStarted: (sessionId: string) => void;
  initialFolder?: string;
}) {
  const { colors } = useTheme();
  const headingRef = useRef<React.ComponentRef<typeof View> | null>(null);
  const [folder, setFolder] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [browserVisible, setBrowserVisible] = useState(false);
  const serverLabel = useAppStore((state) => state.connection.serverLabel);
  const serverHost = useAppStore((state) => state.connection.host);
  const connectionState = useAppStore((state) => state.connection.state);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setStarting(false);
    if (initialFolder) setFolder(initialFolder);
    else {
      void controller.lastFolder().then((value) => {
        setFolder((current) => current || value);
      });
    }
    void controller.recentFolders().then(setRecent);
  }, [initialFolder, visible]);

  const start = async (targetFolder = folder) => {
    setError(null);
    if (!targetFolder.trim().startsWith('/')) {
      setError('Enter an absolute folder path on the server, starting with /.');
      return;
    }
    if (connectionState !== 'current' && connectionState !== 'reconciling') {
      setError('Reconnect before starting a session.');
      return;
    }
    setStarting(true);
    const result = await controller.createSession(targetFolder, '');
    setStarting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await controller.rememberFolder(targetFolder);
    onStarted(result.sessionId);
  };

  return (
    <BottomSheet visible={visible} onClose={onClose} headingRef={headingRef} accessibilityLabel="New session">
      <View style={{ paddingHorizontal: space.lg }} testID="new-session-sheet">
        <View style={styles.header}>
          <View ref={headingRef} collapsable={false}>
            <Text variant="title" accessibilityRole="header">
              New session
            </Text>
          </View>
          <TextAction label="Close" onPress={onClose} color="muted" />
        </View>
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
        >
          <View style={styles.serverRow}>
            <View style={{ flex: 1 }}>
              <Text variant="small" color="muted">
                Server
              </Text>
              <Text variant="body" numberOfLines={1}>
                {serverLabel || 'Current server'}
              </Text>
            </View>
            <Text variant="small" color="muted">
              {serverHost}
            </Text>
          </View>
          <Divider />

          <Field
            label="Folder on server"
            value={folder}
            onChangeText={setFolder}
            placeholder="/home/you/project"
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            returnKeyType="go"
            onSubmitEditing={() => void start()}
            leading={<FolderIcon size={20} color={colors.muted} />}
            helper="An absolute path on the server, not on this phone."
            testID="new-session-folder"
          />
          <TextAction
            label="Browse, search, or create a folder"
            onPress={() => setBrowserVisible(true)}
            color="brand"
          />
          {recent.length > 0 ? (
            <View style={styles.recent}>
              <Text variant="small" color="muted">
                Recent folders
              </Text>
              {recent.map((path) => (
                <Pressable
                  key={path}
                  accessibilityRole="button"
                  accessibilityLabel={`Use recent folder ${path}`}
                  onPress={() => setFolder(path)}
                  style={({ pressed }) => [
                    styles.recentRow,
                    { backgroundColor: pressed ? colors.raised : 'transparent' },
                  ]}
                >
                  <Text variant="code" numberOfLines={1} style={{ flex: 1 }}>
                    {path}
                  </Text>
                  <ChevronRightIcon size={18} color={colors.muted} />
                </Pressable>
              ))}
            </View>
          ) : null}

          <Text variant="small" color="muted" style={{ marginTop: space.md }}>
            The session opens empty. Choose model and effort from the conversation header, then
            write the first message there.
          </Text>

          {error ? (
            <Text variant="small" color="error" accessibilityLiveRegion="polite" style={{ marginTop: space.sm }}>
              {error}
            </Text>
          ) : null}

          <Button
            label={starting ? 'Creating session…' : 'Create session'}
            fullWidth
            loading={starting}
            disabled={starting || !folder.trim()}
            onPress={() => void start()}
            style={{ marginTop: space.md }}
            testID="create-session"
          />
          <View style={{ height: space.lg }} />
        </ScrollView>
      </View>
      <DirectoryBrowser
        visible={browserVisible}
        initialPath={folder || undefined}
        onClose={() => setBrowserVisible(false)}
        onSelect={(path) => {
          setBrowserVisible(false);
          setFolder(path);
          void start(path);
        }}
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  content: { paddingBottom: space.lg },
  serverRow: { flexDirection: 'row', alignItems: 'center', minHeight: target, gap: space.sm },
  recent: { marginTop: space.sm, gap: space.xxs },
  recentRow: {
    minHeight: target,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.control,
    paddingHorizontal: space.xs,
  },
});
