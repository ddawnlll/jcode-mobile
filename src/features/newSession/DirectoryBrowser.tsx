import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';

import { BottomSheet } from '../../design/BottomSheet';
import { Button, Divider, TextAction } from '../../design/controls';
import { ChevronRightIcon, FolderIcon } from '../../design/icons';
import { useTheme } from '../../design/theme';
import { radius, space, target } from '../../design/tokens';
import { Text } from '../../design/typography';
import { controller } from '../../core/app-controller';
import type { DirectoryEntry } from '../../core/protocol/frames';

export function DirectoryBrowser({
  visible,
  initialPath,
  onClose,
  onSelect,
}: {
  visible: boolean;
  initialPath?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}) {
  const { colors } = useTheme();
  const [path, setPath] = useState(initialPath ?? '');
  const [canonical, setCanonical] = useState('');
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [roots, setRoots] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);
  const [manual, setManual] = useState('');
  const [recent, setRecent] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  const load = useCallback(
    async (target: string, append = false) => {
      const sequence = ++requestSeq.current;
      setLoading(true);
      setError(null);
      const result = await controller.listDirectories(target, {
        cursor: append ? cursor ?? undefined : undefined,
        showHidden,
      });
      if (sequence !== requestSeq.current) return;
      setLoading(false);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      setPath(result.canonicalPath);
      setCanonical(result.canonicalPath);
      setParent(result.parent);
      setRoots(result.roots);
      setEntries((current) => (append ? [...current, ...result.entries] : result.entries));
      setCursor(result.cursor);
    },
    [cursor, showHidden],
  );

  useEffect(() => {
    if (!visible) return;
    void controller.recentFolders().then(setRecent);
    void load(initialPath || '');
    // `load` intentionally not a dependency: a new visible session owns one
    // initial request; later navigation calls it explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const crumbs = canonical.split('/').filter(Boolean);
  const filteredEntries = query.trim()
    ? entries.filter((entry) => entry.name.toLowerCase().includes(query.trim().toLowerCase()))
    : entries;

  return (
    <BottomSheet visible={visible} onClose={onClose} accessibilityLabel="Folder on server">
      <View style={{ paddingHorizontal: space.lg }} testID="directory-browser">
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text variant="title" accessibilityRole="header">
              Folder on server
            </Text>
            <Text variant="caption" color="muted" numberOfLines={1}>
              {canonical || 'Choose an absolute folder'}
            </Text>
          </View>
          <TextAction label="Close" onPress={onClose} color="muted" />
        </View>

        <View style={styles.crumbs}>
          <TextAction label="/" onPress={() => void load(roots[0] ?? '/')} color="brand" />
          {crumbs.map((crumb, index) => {
            const target = `/${crumbs.slice(0, index + 1).join('/')}`;
            return (
              <View key={target} style={{ flexDirection: 'row', alignItems: 'center' }}>
                <ChevronRightIcon size={12} color={colors.muted} />
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Open ${target}`}
                  onPress={() => void load(target)}
                  style={styles.crumb}
                >
                  <Text variant="caption" color="brand" numberOfLines={1}>
                    {crumb}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        {error ? (
          <View style={[styles.error, { borderColor: colors.error }]} accessibilityLiveRegion="polite">
            <Text variant="small" color="error" style={{ flex: 1 }}>
              {error}
            </Text>
            <TextAction label="Retry" onPress={() => void load(path || '')} />
          </View>
        ) : null}

        <View style={[styles.manual, { borderColor: colors.control, backgroundColor: colors.surface }]}>
          <TextInput
            accessibilityLabel="Enter a server path"
            value={manual}
            onChangeText={setManual}
            placeholder="/home/you/project"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.manualInput, { color: colors.ink }]}
            testID="directory-path-input"
          />
          <TextAction
            label="Validate"
            onPress={() => {
              if (manual.trim()) void load(manual.trim());
            }}
          />
        </View>

        <View style={styles.tools}>
          <TextAction
            label={showHidden ? 'Hide hidden' : 'Show hidden'}
            onPress={() => {
              setShowHidden((value) => !value);
              setTimeout(() => void load(canonical || path || ''), 0);
            }}
            color={showHidden ? 'brand' : 'muted'}
          />
          {parent ? <TextAction label="Parent" onPress={() => void load(parent)} /> : null}
        </View>

        <View style={[styles.manual, { borderColor: colors.control, backgroundColor: colors.surface }]}>
          <TextInput
            accessibilityLabel="Search this folder"
            value={query}
            onChangeText={setQuery}
            placeholder="Search this folder"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            style={[styles.manualInput, { color: colors.ink }]}
            testID="directory-search"
          />
          {query ? <TextAction label="Clear" onPress={() => setQuery('')} color="muted" /> : null}
        </View>

        <View style={styles.tools}>
          <TextAction
            label={showNewFolder ? 'Cancel new folder' : 'New folder'}
            onPress={() => {
              setShowNewFolder((value) => !value);
              setCreateError(null);
            }}
            color="brand"
          />
        </View>
        {showNewFolder ? (
          <View>
            <View style={[styles.manual, { borderColor: colors.control, backgroundColor: colors.surface }]}>
              <TextInput
                accessibilityLabel="New folder name"
                value={newName}
                onChangeText={setNewName}
                placeholder="new-project"
                placeholderTextColor={colors.muted}
                autoCapitalize="none"
                autoCorrect={false}
                style={[styles.manualInput, { color: colors.ink }]}
                testID="directory-new-name"
              />
              <TextAction
                label={creating ? 'Creating…' : 'Create'}
                onPress={() => {
                  const name = newName.trim();
                  if (!name || !canonical || creating) return;
                  setCreating(true);
                  setCreateError(null);
                  void controller.createDirectory(canonical, name).then((result) => {
                    setCreating(false);
                    if (!result.ok) {
                      setCreateError(result.error);
                      return;
                    }
                    setNewName('');
                    setShowNewFolder(false);
                    setQuery('');
                    void load(result.path);
                  });
                }}
                color="brand"
              />
            </View>
            {createError ? (
              <Text variant="small" color="error" style={{ marginTop: space.xxs }}>
                {createError}
              </Text>
            ) : null}
          </View>
        ) : null}

        <Divider />
        <ScrollView style={{ maxHeight: 320 }} keyboardShouldPersistTaps="handled">
          {loading ? (
            <Text variant="small" color="muted" style={{ paddingVertical: space.md }}>
              Reading {path || 'the first folder'}…
            </Text>
          ) : filteredEntries.length === 0 ? (
            <Text variant="small" color="muted" style={{ paddingVertical: space.md }}>
              {query
                ? `No folder matches “${query}”.`
                : 'No subfolders here. Use this folder, create one, or enter a path.'}
            </Text>
          ) : (
            filteredEntries.map((entry) => (
              <Pressable
                key={entry.path}
                accessibilityRole="button"
                accessibilityLabel={`${entry.name}${entry.readable === false ? ', not readable' : ''}`}
                onPress={() => void load(entry.path)}
                style={[styles.entry, { borderBottomColor: colors.line }]}
                testID={`directory-entry-${entry.name}`}
              >
                <FolderIcon size={20} color={entry.readable === false ? colors.muted : colors.brand} />
                <Text variant="body" numberOfLines={1} style={{ flex: 1, marginLeft: space.sm }}>
                  {entry.name}
                </Text>
                {entry.readable === false ? (
                  <Text variant="caption" color="error">
                    Not permitted
                  </Text>
                ) : null}
                <ChevronRightIcon size={16} color={colors.muted} />
              </Pressable>
            ))
          )}
          {cursor ? (
            <TextAction
              label="Load more folders"
              onPress={() => void load(canonical, true)}
              align="center"
            />
          ) : null}
        </ScrollView>

        {recent.length ? (
          <View style={{ marginTop: space.sm }}>
            <Text variant="caption" color="muted">
              Recent folders
            </Text>
            {recent.slice(0, 4).map((item) => (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityLabel={`Recent folder ${item}`}
                onPress={() => void load(item)}
                style={styles.recent}
              >
                <Text variant="code" numberOfLines={1}>
                  {item}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <Button
          label="Use this folder"
          fullWidth
          disabled={!canonical}
          reason={!canonical ? 'Choose a readable folder first.' : undefined}
          onPress={() => {
            if (canonical) onSelect(canonical);
          }}
          style={{ marginTop: space.md }}
          testID="directory-use"
        />
        <View style={{ height: space.lg }} />
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  crumbs: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', marginTop: space.xs },
  crumb: { minHeight: target, justifyContent: 'center', paddingHorizontal: 2 },
  error: {
    borderWidth: 1,
    borderRadius: radius.control,
    padding: space.sm,
    marginTop: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
  },
  manual: {
    minHeight: target,
    borderWidth: 1,
    borderRadius: radius.control,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.sm,
    marginTop: space.sm,
    gap: space.xs,
  },
  manualInput: { flex: 1, minHeight: target, fontSize: 16, fontFamily: 'HankenGrotesk-Regular' },
  tools: { flexDirection: 'row', justifyContent: 'space-between', marginTop: space.xs },
  entry: {
    minHeight: target,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: StyleSheet.hairlineWidth,
    gap: space.xxs,
  },
  recent: { minHeight: 40, justifyContent: 'center' },
});
