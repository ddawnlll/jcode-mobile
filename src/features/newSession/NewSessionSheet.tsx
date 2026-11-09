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
  const [instruction, setInstruction] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [models, setModels] = useState<string[]>([]);
  const [model, setModel] = useState<string | null>(null);
  const [effort, setEffort] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [configuring, setConfiguring] = useState(false);
  const [browserVisible, setBrowserVisible] = useState(false);
  const serverLabel = useAppStore((state) => state.connection.serverLabel);
  const serverHost = useAppStore((state) => state.connection.host);
  const connectionState = useAppStore((state) => state.connection.state);
  const config = useAppStore((state) => state.conversation.config);

  useEffect(() => {
    if (!visible) return;
    setError(null);
    setNotice(null);
    setCreated(null);
    setStarting(false);
    setConfiguring(false);
    if (initialFolder) setFolder(initialFolder);
    else {
      void controller.lastFolder().then((value) => {
        setFolder((current) => current || value);
      });
    }
    void controller.recentFolders().then(setRecent);
  }, [initialFolder, visible]);

  useEffect(() => {
    if (!visible) {
      setInstruction('');
      setStarting(false);
      setCreated(null);
    }
  }, [visible]);

  const start = async () => {
    setError(null);
    setNotice(null);
    if (!folder.trim().startsWith('/')) {
      setError('Enter an absolute folder path on the server, starting with /.');
      return;
    }
    if (connectionState !== 'current' && connectionState !== 'reconciling') {
      setError('Reconnect before starting a session.');
      return;
    }
    if (created) {
      await finish(created);
      return;
    }
    setStarting(true);
    const result = await controller.createSession(folder, '');
    setStarting(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setCreated(result.sessionId);
    const catalog = await controller.refreshModels();
    setModels(catalog.models);
    setModel(catalog.current);
    setNotice('Session created. Confirm model and effort before the first instruction.');
  };

  const finish = async (sessionId: string) => {
    setConfiguring(true);
    setError(null);
    if (model || effort) {
      const applied = await controller.configureSession({ model, effort });
      if (!applied.ok) {
        setConfiguring(false);
        setError(
          `Session created. Model change needs attention. ${applied.error ?? ''} Retry configuration, choose another model, or use server defaults.`,
        );
        return;
      }
    }
    if (instruction.trim()) {
      const sent = await controller.send(instruction.trim());
      if (!sent.ok) {
        setConfiguring(false);
        setError(
          `Session created, but the first instruction was not confirmed. ${sent.error ?? ''}`,
        );
        return;
      }
    }
    setConfiguring(false);
    await controller.rememberFolder(folder);
    setInstruction('');
    onStarted(sessionId);
  };

  const offline = connectionState !== 'current' && connectionState !== 'reconciling';
  const confirmed = config.modelConfirmed && config.model !== null;

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
          editable={!created}
        />
        <TextAction
          label="Browse server folders"
          onPress={() => setBrowserVisible(true)}
          color="brand"
          disabled={!!created}
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

        <View style={[styles.configCard, { borderColor: colors.line }]}>
          <View style={styles.configHeader}>
            <Text variant="small" weight="semibold">
              Model & effort
            </Text>
            <Text variant="caption" color={confirmed ? 'success' : 'muted'}>
              {created
                ? confirmed
                  ? 'Server confirmed'
                  : 'Pending confirmation'
                : 'Server default until the session exists'}
            </Text>
          </View>
          {created ? (
            models.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.modelRow}>
                {models.slice(0, 12).map((entry) => (
                  <Pressable
                    key={entry}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: model === entry, checked: model === entry }}
                    aria-checked={model === entry}
                    accessibilityLabel={`Model ${entry}`}
                    onPress={() => {
                      setModel(entry);
                      setEffort(null);
                    }}
                    style={[
                      styles.chip,
                      {
                        borderColor: model === entry ? colors.brand : colors.line,
                        backgroundColor: model === entry ? colors.raised : colors.surface,
                      },
                    ]}
                    testID={`new-session-model-${entry}`}
                  >
                    <Text variant="caption" numberOfLines={1}>
                      {entry}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : (
              <Text variant="caption" color="muted">
                No model catalog was reported by this server.
              </Text>
            )
          ) : (
            <Text variant="caption" color="muted">
              The returned session identity is used to read the real catalog.
            </Text>
          )}
          {created && config.efforts.length > 0 ? (
            <View style={styles.modelRow}>
              {config.efforts.map((entry) => (
                <Pressable
                  key={entry}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: effort === entry, checked: effort === entry }}
                  aria-checked={effort === entry}
                  accessibilityLabel={`Effort ${entry}`}
                  onPress={() => setEffort(entry)}
                  style={[
                    styles.chip,
                    {
                      borderColor: effort === entry ? colors.brand : colors.line,
                      backgroundColor: effort === entry ? colors.raised : colors.surface,
                    },
                  ]}
                  testID={`new-session-effort-${entry}`}
                >
                  <Text variant="caption">{entry}</Text>
                </Pressable>
              ))}
            </View>
          ) : created ? (
            <Text variant="caption" color="muted">
              Effort options are unavailable for this route.
            </Text>
          ) : null}
          {created ? (
            <View style={styles.configActions}>
              <TextAction
                label="Use server defaults"
                onPress={() => {
                  setModel(null);
                  setEffort(null);
                  void finish(created);
                }}
                color="muted"
              />
            </View>
          ) : null}
        </View>

        <Field
          label="First instruction"
          value={instruction}
          onChangeText={setInstruction}
          placeholder="What should JCode do first?"
          multiline
          minHeight={96}
          textAlignVertical="top"
          helper="Optional. Sent only after the returned session and configuration are confirmed."
        />
        {notice ? (
          <Text variant="small" color="success" accessibilityLiveRegion="polite" style={{ marginTop: space.sm }}>
            {notice}
          </Text>
        ) : null}
        {error ? (
          <Text variant="small" color="error" accessibilityLiveRegion="polite" style={{ marginTop: space.sm }}>
            {error}
          </Text>
        ) : null}
        <Button
          label={
            created
              ? configuring
                ? 'Confirming configuration…'
                : 'Confirm and send'
              : starting
                ? 'Starting…'
                : 'Start session'
          }
          onPress={() => void start()}
          loading={starting || configuring}
          fullWidth
          disabled={offline}
          reason={offline ? 'Reconnect to start a session.' : undefined}
          style={{ marginTop: space.md }}
          testID="new-session-start"
        />
        {created ? (
          <Text variant="small" color="muted" style={{ marginTop: space.sm }}>
            Session {created.slice(0, 18)}… is already created. Closing this sheet keeps it in
            Sessions; starting again will not create a duplicate.
          </Text>
        ) : (
          <Text variant="small" color="muted" style={{ marginTop: space.sm }}>
            The server validates the folder. A created session keeps its returned identity even if
            configuration or delivery needs attention.
          </Text>
        )}
        <View style={{ height: space.xl }} />
      </ScrollView>

      <DirectoryBrowser
        visible={browserVisible}
        initialPath={folder}
        onClose={() => setBrowserVisible(false)}
        onSelect={(path) => {
          setFolder(path);
          setBrowserVisible(false);
        }}
      />
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
    minHeight: target,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.xs,
  },
  configCard: { borderWidth: 1, borderRadius: radius.control, padding: space.sm, gap: space.xs },
  configHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  modelRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xxs, marginTop: space.xxs },
  chip: {
    minHeight: target,
    paddingHorizontal: space.sm,
    borderWidth: 1,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    maxWidth: 220,
  },
  configActions: { flexDirection: 'row', justifyContent: 'flex-end' },
});
