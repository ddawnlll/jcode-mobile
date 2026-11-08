import React, { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { BottomSheet } from '../../design/BottomSheet';
import { Button, Divider, Field, TextAction } from '../../design/controls';
import { ChevronRightIcon, FolderIcon } from '../../design/icons';
import { useTheme } from '../../design/theme';
import { space } from '../../design/tokens';
import { Text } from '../../design/typography';
import { controller } from '../../core/app-controller';
import { useAppStore } from '../../core/state/store';

export function NewSessionSheet({
  visible,
  onClose,
  onStarted,
}: {
  visible: boolean;
  onClose: () => void;
  onStarted: (sessionId: string) => void;
}) {
  const { colors } = useTheme();
  const headingRef = useRef<React.ComponentRef<typeof View> | null>(null);
  const [folder, setFolder] = useState('');
  const [instruction, setInstruction] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const serverLabel = useAppStore((state) => state.connection.serverLabel);
  const serverHost = useAppStore((state) => state.connection.host);
  const connectionState = useAppStore((state) => state.connection.state);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    void controller.lastFolder().then((value) => {
      setFolder((current) => current || value);
    });
    void controller.recentFolders().then(setRecent);
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      setInstruction('');
      setStarting(false);
    }
  }, [visible]);

  const start = async () => {
    setError(null);
    if (!folder.trim().startsWith('/')) {
      setError('Enter an absolute folder path on the server, starting with /.');
      return;
    }
    if (connectionState !== 'current' && connectionState !== 'reconciling') {
      setError('Reconnect before starting a session.');
      return;
    }
    setStarting(true);
    const result = await controller.createSession(folder, instruction);
    setStarting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    await controller.rememberFolder(folder);
    setInstruction('');
    onStarted(result.sessionId);
  };

  const offline = connectionState !== 'current' && connectionState !== 'reconciling';

  return (
    <BottomSheet visible={visible} onClose={onClose} headingRef={headingRef} accessibilityLabel="New session">
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
          returnKeyType="next"
          leading={<FolderIcon size={20} color={colors.muted} />}
          helper="An absolute path on the server, not on this phone."
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
        <Field
          label="Instruction"
          value={instruction}
          onChangeText={setInstruction}
          placeholder="What should JCode do first?"
          multiline
          minHeight={96}
          textAlignVertical="top"
          helper="Optional. Sent to the returned session, never to a guessed one."
        />
        {error ? (
          <Text variant="small" color="error" accessibilityLiveRegion="polite" style={{ marginTop: space.sm }}>
            {error}
          </Text>
        ) : null}
        <Button
          label={starting ? 'Starting…' : 'Start session'}
          onPress={start}
          loading={starting}
          fullWidth
          disabled={offline}
          reason={offline ? 'Reconnect to start a session.' : undefined}
          style={{ marginTop: space.md }}
          testID="new-session-start"
        />
        <Text variant="small" color="muted" style={{ marginTop: space.sm }}>
          The server validates the folder. A created session keeps its returned identity even if this
          request looks slow.
        </Text>
        <View style={{ height: space.xl }} />
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space.lg,
    paddingBottom: space.sm,
  },
  content: { paddingHorizontal: space.lg, gap: space.md },
  serverRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.sm,
    minHeight: 48,
  },
  recent: { gap: space.xxs },
  recentRow: {
    minHeight: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
});
