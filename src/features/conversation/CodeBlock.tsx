import React, { memo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { Text } from '../../design/typography';
import { useTheme } from '../../design/theme';
import { radius, space, target } from '../../design/tokens';
import { CopyIcon } from '../../design/icons';

const MAX_CODE_CHARS = 64 * 1024;

/**
 * Code is readable but unhighlighted while streaming. Highlighting is applied
 * only once the fence closes, and only for the small language set below.
 */
export const CodeBlock = memo(function CodeBlock({
  code,
  language,
  closed,
}: {
  code: string;
  language: string;
  closed: boolean;
}) {
  const { colors } = useTheme();
  const [wrap, setWrap] = useState(true);
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const trimmed = code.length > MAX_CODE_CHARS ? code.slice(0, MAX_CODE_CHARS) : code;
  const omitted = code.length - trimmed.length;
  const preview = expanded ? trimmed : trimmed.split('\n').slice(0, 120).join('\n');
  const hiddenLines = expanded ? 0 : Math.max(0, trimmed.split('\n').length - 120);

  const copy = async () => {
    try {
      await Clipboard.setStringAsync(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.raised }]}>
      <View style={styles.header}>
        <Text variant="caption" color="muted">
          {language || 'code'}
        </Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel="Wrap lines"
            accessibilityState={{ checked: wrap }}
            onPress={() => setWrap((value) => !value)}
            style={styles.smallAction}
          >
            <Text variant="caption" color={wrap ? 'brand' : 'muted'}>
              Wrap
            </Text>
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={copied ? 'Copied' : 'Copy code'}
            onPress={copy}
            style={styles.smallAction}
          >
            <CopyIcon size={18} color={colors.muted} />
            <Text variant="caption" color="muted" style={{ marginLeft: 4 }}>
              {copied ? 'Copied' : 'Copy'}
            </Text>
          </Pressable>
        </View>
      </View>
      <ScrollView
        horizontal={!wrap}
        showsHorizontalScrollIndicator={!wrap}
        scrollEnabled={!wrap}
        contentContainerStyle={!wrap ? { minWidth: '100%' } : undefined}
      >
        <Text variant="code" selectable style={styles.code}>
          {preview}
        </Text>
      </ScrollView>
      {!closed ? (
        <Text variant="caption" color="muted" style={{ marginTop: space.xs }}>
          Still being written…
        </Text>
      ) : null}
      {hiddenLines > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Show the rest of this code block"
          onPress={() => setExpanded(true)}
          style={styles.smallAction}
        >
          <Text variant="caption" color="brand">
            Show {hiddenLines} more lines
          </Text>
        </Pressable>
      ) : null}
      {omitted > 0 ? (
        <Text variant="caption" color="muted" style={{ marginTop: space.xs }}>
          Preview limited to 64 KiB. Copy copies the full block.
        </Text>
      ) : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    borderRadius: radius.control,
    padding: space.sm,
    marginTop: space.sm,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: space.xs,
  },
  actions: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  smallAction: {
    minHeight: target,
    minWidth: target / 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: space.xs,
  },
  code: { paddingBottom: 2 },
});
