import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import * as Clipboard from 'expo-clipboard';

import { CopyIcon } from '../../design/icons';
import { useTheme } from '../../design/theme';
import { space, target } from '../../design/tokens';
import { Text } from '../../design/typography';
import { markdownToText } from './markdown/parse';

/**
 * Explicit Copy actions cover platform text-selection boundaries. Copy text
 * uses readable projection; Copy Markdown preserves the exact source.
 */
export function MessageActions({
  content,
  role,
  testID,
}: {
  content: string;
  role: 'user' | 'assistant';
  testID?: string;
}) {
  const { colors } = useTheme();
  const [copied, setCopied] = useState<'text' | 'markdown' | null>(null);

  const copy = async (kind: 'text' | 'markdown') => {
    const value = kind === 'markdown' ? content : markdownToText(content);
    try {
      await Clipboard.setStringAsync(value);
      setCopied(kind);
      setTimeout(() => setCopied(null), 1200);
    } catch {
      setCopied(null);
    }
  };

  return (
    <View style={styles.row} testID={testID}>
      <CopyAction
        label={copied === 'text' ? 'Copied' : 'Copy'}
        accessibilityLabel={role === 'user' ? 'Copy message' : 'Copy message text'}
        onPress={() => void copy('text')}
        color={copied === 'text' ? colors.success : colors.muted}
      />
      {role === 'assistant' ? (
        <Text variant="caption" color="muted" style={styles.separator}>
          ·
        </Text>
      ) : null}
      {role === 'assistant' ? (
        <CopyAction
          label={copied === 'markdown' ? 'Copied Markdown' : 'Copy Markdown'}
          accessibilityLabel="Copy message Markdown"
          onPress={() => void copy('markdown')}
          color={copied === 'markdown' ? colors.success : colors.muted}
        />
      ) : null}
    </View>
  );
}

function CopyAction({
  label,
  accessibilityLabel,
  onPress,
  color,
}: {
  label: string;
  accessibilityLabel: string;
  onPress: () => void;
  color: string;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
      style={({ pressed }) => [styles.action, pressed && { opacity: 0.7 }]}
    >
      <CopyIcon size={14} color={color} />
      <Text variant="caption" style={{ color, marginLeft: 4 }}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginTop: space.xxs, gap: space.xxs },
  action: {
    minHeight: target,
    minWidth: target,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: space.xxs,
  },
  separator: { paddingHorizontal: 2 },
});
